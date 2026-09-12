"""`merge_missing_watchlist_items` closes the one-shot-bootstrap gap additively.

`ensure_watchlist_bootstrapped` returns early forever once a machine holds any watchlist
row, so a ticker added to `stock_targets.json` afterwards never reaches a machine that was
set up before it. The merge fixes that WITHOUT the destructiveness of
`resync_watchlist_from_json`, which DELETEs the table -- so the tests that matter most here
are the ones asserting what the merge leaves alone, not the ones asserting what it adds.
"""

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schema_parts.market import StockOHLCV
from apps.api.routes import portfolio as portfolio_routes
from apps.api.services import db as db_service
from apps.api.services.watchlist_seed import merge_missing_watchlist_items


def _write_seed(path: Path, groups: dict[str, list[dict]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({group: {"targets": targets} for group, targets in groups.items()}, indent=2),
        encoding="utf-8",
    )


def _init_db(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()


def _insert(ticker: str, name: str, sector: str, group_name: str, weight: float) -> None:
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            (ticker, name, sector, group_name, weight),
        )


def _rows() -> list[tuple]:
    with db_service.get_db() as conn:
        return [
            tuple(row)
            for row in conn.execute(
                "SELECT id, ticker, name, sector, group_name, weight FROM watchlist ORDER BY ticker"
            ).fetchall()
        ]


def test_a_machine_seeded_before_a_ticker_was_added_picks_it_up(tmp_path, monkeypatch):
    """The reported symptom: SPCX is committed in the seed but absent on the second PC,
    because that machine seeded before SPCX was added and the bootstrap never runs again."""
    _init_db(tmp_path, monkeypatch)
    seed = tmp_path / "stock_targets.json"
    _write_seed(
        seed,
        {
            "custom": [
                {"ticker": "CRCL", "name": "Circle", "sector": "Financials", "weight": 0.0},
                {"ticker": "SPCX", "name": "SpaceX ETF", "sector": "Aerospace", "weight": 0.0},
            ]
        },
    )
    # The older, smaller seed this machine bootstrapped from.
    _insert("CRCL", "Circle", "Financials", "custom", 0.0)

    added = merge_missing_watchlist_items(seed)

    assert added == ["SPCX"]
    assert [row[1] for row in _rows()] == ["CRCL", "SPCX"]


def test_an_existing_rows_weight_and_group_survive_the_merge(tmp_path, monkeypatch):
    """The difference between this and the destructive resync, and the reason the additive
    option was chosen: curation done on THIS machine is not replaced by the seed's values.

    A merge built on INSERT OR REPLACE, or on DELETE-then-insert, passes every other test
    in this file and fails this one."""
    _init_db(tmp_path, monkeypatch)
    seed = tmp_path / "stock_targets.json"
    _write_seed(
        seed,
        {
            "custom": [
                # Deliberately disagrees with the stored row on all three mutable columns.
                {"ticker": "AAPL", "name": "Apple Inc.", "sector": "Technology", "weight": 0.1},
                {"ticker": "NVDA", "name": "NVIDIA", "sector": "Semiconductors", "weight": 0.2},
            ]
        },
    )
    _insert("AAPL", "My Apple", "Consumer Tech", "manual", 0.9)

    added = merge_missing_watchlist_items(seed)

    assert added == ["NVDA"]
    with db_service.get_db() as conn:
        aapl = conn.execute(
            "SELECT name, sector, group_name, weight FROM watchlist WHERE ticker = 'AAPL'"
        ).fetchone()
    assert tuple(aapl) == ("My Apple", "Consumer Tech", "manual", 0.9)


def test_a_db_ticker_absent_from_the_seed_is_never_deleted(tmp_path, monkeypatch):
    """`resync_watchlist_from_json` would drop this row. The merge must not: a ticker
    followed only on this machine is exactly the curation the additive design protects."""
    _init_db(tmp_path, monkeypatch)
    seed = tmp_path / "stock_targets.json"
    _write_seed(seed, {"custom": [{"ticker": "MP", "name": "MP Materials", "sector": "Materials", "weight": 0.0}]})
    _insert("LOCAL", "Local Only", "Industrials", "manual", 0.4)

    added = merge_missing_watchlist_items(seed)

    assert added == ["MP"]
    assert [row[1] for row in _rows()] == ["LOCAL", "MP"]


def test_a_seed_the_db_already_agrees_with_is_a_no_op(tmp_path, monkeypatch):
    _init_db(tmp_path, monkeypatch)
    seed = tmp_path / "stock_targets.json"
    _write_seed(
        seed,
        {
            "custom": [
                {"ticker": "SLV", "name": "iShares Silver", "sector": "Materials", "weight": 0.3},
                {"ticker": "SNDK", "name": "SanDisk", "sector": "Technology", "weight": 0.2},
            ]
        },
    )
    _insert("SLV", "iShares Silver", "Materials", "custom", 0.3)
    _insert("SNDK", "SanDisk", "Technology", "custom", 0.2)
    before = _rows()

    added = merge_missing_watchlist_items(seed)

    assert added == []
    # Same ids as well as same values: a row that was rewritten in place rather than
    # ignored would keep its ticker and lose its identity.
    assert _rows() == before


def test_a_missing_or_unreadable_seed_leaves_the_table_alone(tmp_path, monkeypatch):
    """The merge runs on every watchlist request, so a machine with no seed file must not
    have its watchlist touched -- and must not raise on the way past."""
    _init_db(tmp_path, monkeypatch)
    _insert("AAPL", "Apple", "Technology", "custom", 0.5)
    before = _rows()

    assert merge_missing_watchlist_items(tmp_path / "no-such-seed.json") == []
    assert _rows() == before


def test_the_watchlist_endpoint_merges_so_a_second_machine_self_heals(tmp_path, monkeypatch):
    """The call site is the fix. Nothing wires the merge at startup: it runs on the
    endpoint the portfolio page already hits, so the other PC repairs itself the first
    time that page loads."""
    bars = [
        StockOHLCV(date=f"2026-09-{day:02d}", open=10.0, high=11.0, low=9.0, close=10.0 + day, volume=1_000)
        for day in range(1, 21)
    ]
    monkeypatch.setattr(portfolio_routes._mkt, "get_stock_ohlcv", lambda *args, **kwargs: bars)

    _init_db(tmp_path, monkeypatch)
    seed = tmp_path / "stock_targets.json"
    _write_seed(
        seed,
        {
            "custom": [
                {"ticker": "NRG", "name": "NRG Energy", "sector": "Utilities", "weight": 0.0},
                {"ticker": "SCCO", "name": "Southern Copper", "sector": "Materials", "weight": 0.0},
            ]
        },
    )
    monkeypatch.setattr(portfolio_routes, "_WATCHLIST_JSON", seed)
    # Any row at all is enough to make `ensure_watchlist_bootstrapped` return early.
    _insert("NRG", "NRG Energy", "Utilities", "custom", 0.0)

    response = TestClient(app).get("/api/v1/portfolio/watchlist")

    assert response.status_code == 200
    assert sorted(row["ticker"] for row in response.json()) == ["NRG", "SCCO"]
