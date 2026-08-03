import sys
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import CorporateMetrics
from apps.api.models.schema_parts.corporate import BridgeInputMeta, BridgeSource
from apps.api.services import db as db_service
from apps.api.services.acquisition.sources.quote_facts import QuoteFacts
from apps.api.services.acquisition.sources.statements import StatementRow
from apps.api.services.acquisition.state import record_success
from apps.api.services.acquisition.store import save_quote_facts, save_statements
from apps.api.services.corporate_comparison import (
    METRIC_SCHEMA_VERSION,
    _comparison_universe_key,
    _dcf_snapshot,
    acquire_comparison_datasets,
    build_corporate_comparison_response,
    load_company_universe_data,
    load_corporate_comparison_history,
    load_corporate_comparison_snapshot_version,
    save_corporate_comparison_snapshot,
)
from apps.api.services.equity_bridge import EquityBridge


def _stub_metrics_loader(ticker: str) -> CorporateMetrics:
    return CorporateMetrics(
        ticker=ticker, growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74,
        esg_penalty=22,
    )


def _seed_fresh_acquisition(tickers: list[str], *, now: datetime) -> None:
    for ticker in tickers:
        record_success("statements", ticker, now=now, covered_from=now.date(), covered_to=now.date())
        record_success("market_cap", ticker, now=now, covered_from=now.date(), covered_to=now.date())


def _seed_watchlist() -> None:
    with db_service.get_db() as conn:
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("AAPL", "Apple", "Technology", "core", 0.4),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("MSFT", "Microsoft", "Technology", "core", 0.2),
        )
        conn.execute(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            ("GOOGL", "Alphabet", "Communication Services", "watch", 0.0),
        )


def _patch_comparison_sources(monkeypatch):
    from apps.api.routes import corporate as corporate_route

    def fake_metrics(ticker: str, **_: object) -> CorporateMetrics:
        base = {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "GOOGL": CorporateMetrics(ticker="GOOGL", growth=8, roic=20, wacc=9.5, debt_ratio=8, unlevered_beta=1.0, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "NVDA": CorporateMetrics(ticker="NVDA", growth=16, roic=32, wacc=12, debt_ratio=10, unlevered_beta=1.55, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "TSLA": CorporateMetrics(ticker="TSLA", growth=12, roic=13, wacc=13, debt_ratio=22, unlevered_beta=1.7, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
            "^IXIC": CorporateMetrics(ticker="^IXIC", growth=6, roic=11, wacc=8.5, debt_ratio=0, unlevered_beta=1.05, crp=0.0, reinvestment=20, fcff=92, innovation=45, market_share=100, governance=70, esg_penalty=10),
        }
        return base[ticker]

    monkeypatch.setattr(corporate_route, "_metrics_for_ticker", fake_metrics)
    monkeypatch.setattr(corporate_route, "_latest_market_price", lambda ticker: 100.0 if ticker else 0.0)


def _meta(value, quality="ok", source=BridgeSource.TOTAL_DEBT_LESS_CASH):
    return BridgeInputMeta(value=value, source=source, quality=quality, as_of="2025-09-30")


def _resolved_bridge(net_debt=60.0, non_op=0.0, shares=15.0):
    return EquityBridge(
        net_debt=_meta(net_debt),
        non_operating_assets=_meta(non_op, source=BridgeSource.INVESTMENTS_ADVANCES),
        diluted_shares_outstanding=_meta(shares, source=BridgeSource.DILUTED_AVERAGE_SHARES),
    )


def _starved_bridge():
    absent = BridgeInputMeta(value=None, source=BridgeSource.UNAVAILABLE, quality="missing")
    return EquityBridge(absent, absent, absent)


def _snapshot(bridge, *, price=100.0):
    return _dcf_snapshot(
        ticker="AAPL",
        metrics=_stub_metrics_loader("AAPL"),
        price_loader=lambda _t: price,
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        bridge_loader=lambda _t: bridge,
    )


# The fixture's own numbers, computed independently of _dcf_snapshot: _stub_metrics_loader
# gives fcff=92, growth=6%, wacc=10%, which the same five-year-plus-terminal-value formula
# in _dcf_snapshot turns into one fixed enterprise value. Held here as a named constant so
# every exact-value assertion below is traceable to arithmetic done once, by hand, rather
# than re-derived ad hoc per test (and rather than re-importing _dcf_snapshot's own DCF
# math, which would make the assertion tautological against the code it is checking).
# base_fcff=92; growth=0.06; wacc=0.10; terminal_growth=min(0.06, 0.095)=0.06
# projected = [92*1.06**y for y in 1..5]; pv_fcff = sum(cf / 1.10**y)
# terminal_value = projected[-1]*1.06 / (0.10-0.06); pv_terminal = terminal_value / 1.10**5
_FIXTURE_ENTERPRISE_VALUE = 2438.0  # round(pv_fcff + pv_terminal, 2)


def test_a_resolved_bridge_produces_a_per_share_value_not_an_enterprise_value():
    # net_debt was hardcoded 0.0 at line 372, so estimated_value was enterprise value
    # under a per-share label and status was permanently "Bridge Incomplete". A bound of
    # "< 1000.0" passes whether or not net_debt is actually subtracted (162.5 ignoring it
    # vs. 158.53 applying it), so the exact value is asserted instead: (2438 - 60) / 15.
    dcf = _snapshot(_resolved_bridge(net_debt=60.0, non_op=0.0, shares=15.0))
    assert dcf["bridge_quality"] == "ok"
    # _dcf_snapshot's "status" is internal: CorporateComparisonRow has no status field,
    # so this verdict is not surfaced by the comparison table. Asserted because it is
    # real behaviour of this function, not because a user can see it.
    assert dcf["status"] in {"Undervalued", "Overvalued"}
    assert dcf["estimated_value"] == pytest.approx(158.53, abs=0.01)


def test_an_unresolved_bridge_reports_missing_and_falls_back_to_enterprise_value():
    dcf = _snapshot(_starved_bridge())
    assert dcf["bridge_quality"] == "missing"
    # Internal only, as above: not surfaced by CorporateComparisonRow.
    assert dcf["status"] == "Bridge Incomplete"
    # The unbridged enterprise value itself, not merely "some large number" -- pins the
    # fallback to the one value it is supposed to be, not to anything above a threshold.
    assert dcf["estimated_value"] == pytest.approx(_FIXTURE_ENTERPRISE_VALUE, abs=0.01)


def test_the_dcf_implied_return_is_no_longer_pinned_at_zero():
    # _dcf_snapshot passed intrinsic_value=current_price, so dcf_implied_return was
    # f(price, price) = 0. stock_expected_return is assigned from it and
    # expected_return_spread derived from that, so three columns were constant.
    few_shares = _snapshot(_resolved_bridge(shares=1.0))
    many_shares = _snapshot(_resolved_bridge(shares=1000.0))
    assert few_shares["dcf_implied_return"] != many_shares["dcf_implied_return"]
    assert few_shares["dcf_implied_return"] != 0.0
    assert few_shares["stock_expected_return"] == few_shares["dcf_implied_return"]
    # Exact values: per_share = (2438 - 60) / shares; dcf_implied_return =
    # (per_share / current_price - 1) * 100, current_price = 100.0 (the _snapshot default).
    assert few_shares["dcf_implied_return"] == pytest.approx(2278.0, abs=0.01)
    assert many_shares["dcf_implied_return"] == pytest.approx(-97.62, abs=0.01)


def test_an_estimated_bridge_still_produces_a_value():
    bridge = EquityBridge(
        net_debt=_meta(60.0),
        non_operating_assets=BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="estimated"
        ),
        diluted_shares_outstanding=_meta(15.0, source=BridgeSource.DILUTED_AVERAGE_SHARES),
    )
    dcf = _snapshot(bridge)
    assert dcf["bridge_quality"] == "estimated"
    # Internal only, as above: not surfaced by CorporateComparisonRow.
    assert dcf["status"] in {"Undervalued", "Overvalued"}
    # Same net_debt and shares as the "ok" resolved-bridge fixture above, with
    # non_operating_assets absent. Asserting the same 158.53 here is the actual test of
    # the deliberate "sums as 0.0 when estimated" exception -- without it, an
    # implementation that instead treated an estimated-but-absent non_operating_assets as
    # disqualifying (falling back to enterprise value, ~2438) would still pass this test
    # on the status/quality checks alone.
    assert dcf["estimated_value"] == pytest.approx(158.53, abs=0.01)


def _insert_snapshot_rows(rows: list[tuple[str, str, float, float]]) -> str:
    """Write snapshot rows directly, bypassing the builder, so the aggregate SQL is what
    is under test rather than the row construction that feeds it.

    Each row is (ticker, bridge_quality, dcf_value, expected_return_spread) -- both of the
    aggregate columns the 'missing' exclusion is supposed to filter, not just one of them.
    """
    universe_key = _comparison_universe_key(
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
    )
    taken_at = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc).isoformat()
    with db_service.get_db() as conn:
        for ticker, bridge_quality, dcf_value, expected_return_spread in rows:
            conn.execute(
                """INSERT INTO corporate_comparison_snapshots_v3 (
                       snapshot_version, snapshot_date, universe_key, comparison_universe,
                       benchmark_ticker, custom_tickers, snapshot_taken_at, snapshot_source,
                       risk_free_rate, equity_risk_premium, stock_expected_return_method,
                       ticker, name, sector, group_name, weight, roic, wacc, roic_minus_wacc,
                       dcf_value, current_price, dcf_implied_return, capm_expected_return,
                       stock_expected_return, market_expected_return, expected_return_spread,
                       stock_expected_return_source, has_price_data, metric_schema_version,
                       bridge_quality
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                             ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                ("v1", "2026-08-03", universe_key, "portfolio_plus_benchmark", "^GSPC", "",
                 taken_at, "manual", 4.2, 5.5, "dcf_implied_upside", ticker, ticker,
                 "Technology", "core", 0.1, 18.0, 10.0, 8.0, dcf_value, 100.0, 5.0, 9.0,
                 5.0, 9.0, expected_return_spread, "dcf_implied_upside", 1, 2, bridge_quality),
            )
    return universe_key


def _history_point():
    history = load_corporate_comparison_history(
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
    )
    return history.points[0]


def _history_average_dcf_value():
    return _history_point().average_dcf_value


def test_missing_rows_are_excluded_from_the_aggregates_but_estimated_rows_are_not(
    tmp_path, monkeypatch
):
    # The exclusion rule must be "bridge_quality = 'missing'", never "!= 'ok'". An
    # estimated row carries a defensible number and the label that says so. The missing
    # row's spread (12345.0) is far enough from the other two that its inclusion could not
    # round to the same two-decimal average by coincidence.
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([
        ("AAA", "ok", 100.0, 3.0),
        ("BBB", "estimated", 200.0, 5.0),
        ("CCC", "missing", 999999.0, 12345.0),
    ])
    point = _history_point()
    assert point.average_dcf_value == pytest.approx(150.0)
    assert point.average_expected_return_spread == pytest.approx(4.0)


def test_an_all_missing_snapshot_reports_no_average_rather_than_zero(tmp_path, monkeypatch):
    # The ordinary state on any install where statement acquisition has never run: every
    # non-benchmark row is 'missing', so both bridge-dependent aggregates average zero
    # rows and SQL AVG returns NULL. Coercing that to 0.0 printed $0.0 as a real average
    # and styled a 0.00% spread as a signal. stock_count still reports the full row count,
    # so it cannot distinguish "average of nothing" from "average happens to be zero".
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "missing", 100.0, 3.0), ("BBB", "missing", 200.0, 5.0)])
    point = _history_point()
    assert point.average_dcf_value is None
    assert point.average_expected_return_spread is None
    # Not bridge-dependent: its NULL semantics are unchanged, and both rows are non-benchmark.
    assert point.average_roic_minus_wacc == pytest.approx(8.0)
    assert point.stock_count == 2


def test_legacy_rows_with_an_empty_bridge_quality_stay_in_the_aggregates(
    tmp_path, monkeypatch
):
    # Rows written before the column existed carry ''. Every historical average must read
    # exactly as it does today, not be reinterpreted as missing.
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "", 100.0, -4.0), ("BBB", "", 200.0, -4.0)])
    assert _history_average_dcf_value() == pytest.approx(150.0)


def test_the_metric_schema_version_is_bumped():
    # Metric semantics changed, so snapshots from before and after must never compare as
    # like-for-like.
    assert METRIC_SCHEMA_VERSION == 2


def test_a_resolved_bridge_quality_survives_persistence_and_read_back(tmp_path, monkeypatch):
    """The four _dcf_snapshot tests above inject a fake bridge_loader directly and never
    touch the database. Every other test in this file that goes through
    save_corporate_comparison_snapshot runs against an empty statement store, where the
    bridge always resolves to "missing" -- so nothing before this test exercised a
    resolved bridge_quality surviving INSERT -> SELECT -> _rows_to_response. A SELECT that
    forgot to list bridge_quality would read every row back as "missing" regardless of
    what was written, and no existing test would notice.

    Monkeypatching corporate_comparison.load_equity_bridge does not exercise this: it is
    captured as _dcf_snapshot's `bridge_loader=load_equity_bridge` default argument value
    once, at module-import time, and reassigning the module attribute afterward has no
    effect on a default already bound into the function object. Verified directly:
    `def f(loader=real): ...; real = patched; f()` still calls the original `real`, not
    `patched`, because the default is resolved to the function object at def time, not
    looked up by name at call time. So this test instead seeds real statement rows for one
    ticker, which makes the actual (unpatched) load_equity_bridge resolve a genuine "ok"
    bridge through the same local-store path production uses.
    """
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()

    save_statements("AAPL", [
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Total Debt", 5_000_000_000.0),
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Cash And Cash Equivalents", 1_000_000_000.0),
        StatementRow("AAPL", "balance", "annual", "2025-12-31", "Investments And Advances", 500_000_000.0),
        StatementRow("AAPL", "income", "annual", "2025-12-31", "Diluted Average Shares", 2_000_000_000.0),
    ])

    saved = save_corporate_comparison_snapshot(
        snapshot_source="manual",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=_stub_metrics_loader,
        price_loader=lambda ticker: 100.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    reloaded = load_corporate_comparison_snapshot_version(
        snapshot_version=saved.snapshot.snapshot_version
    )
    aapl = next(row for row in reloaded.rows if row.ticker == "AAPL")
    assert aapl.bridge_quality == "ok"
    assert aapl.bridge_quality != "missing"


def test_corporate_comparison_defaults_to_portfolio_plus_benchmark_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    # Reads never write (Task 8): a snapshot must be created explicitly before a
    # snapshot-mode read has anything to return.
    from apps.api.services import corporate_comparison as comparison_service

    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **_: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["market_expected_return"] == 9.7
    assert payload["risk_free_rate"] == 4.2
    assert payload["equity_risk_premium"] == 5.5
    assert payload["stock_expected_return_method"] == "dcf_implied_upside"
    assert payload["comparison_reference_return_method"] == "capm_beta_reference"
    assert payload["snapshot"]["mode"] == "snapshot"
    assert payload["snapshot"]["snapshot_source"] == "scheduled_kst_daily"
    assert payload["snapshot"]["snapshot_available"] is True
    assert payload["snapshot"]["snapshot_cadence"] == "daily_kst_0000"
    assert payload["snapshot"]["snapshot_retention_days"] == 365
    assert payload["snapshot"]["comparison_universe"] == "portfolio_plus_benchmark"
    assert payload["snapshot"]["benchmark_ticker"] == "^GSPC"
    assert payload["snapshot"]["custom_tickers"] == []
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT"]

    benchmark = payload["rows"][0]
    assert benchmark["group_name"] == "benchmark"
    assert benchmark["weight"] == 0.0

    aapl = next(row for row in payload["rows"] if row["ticker"] == "AAPL")
    assert aapl["weight"] == 0.4
    assert aapl["roic_minus_wacc"] == 8.0
    assert aapl["market_expected_return"] == 9.7
    assert aapl["stock_expected_return_source"] == "dcf_implied_upside"
    assert aapl["dcf_value"] > 0
    assert aapl["dcf_implied_return"] == aapl["stock_expected_return"]
    assert aapl["capm_expected_return"] > 0
    assert aapl["stock_expected_return"] == pytest.approx(
        aapl["expected_return_spread"] + aapl["market_expected_return"],
        abs=1e-6,
    )

    with db_service.get_db() as conn:
        snapshot_rows = conn.execute(
            """SELECT snapshot_source, comparison_universe, benchmark_ticker, ticker
               FROM corporate_comparison_snapshots_v3
               ORDER BY ticker"""
        ).fetchall()
    assert set((row["snapshot_source"], row["comparison_universe"], row["benchmark_ticker"], row["ticker"]) for row in snapshot_rows) == {
        ("scheduled_kst_daily", "portfolio_plus_benchmark", "^GSPC", "^GSPC"),
        ("scheduled_kst_daily", "portfolio_plus_benchmark", "^GSPC", "AAPL"),
        ("scheduled_kst_daily", "portfolio_plus_benchmark", "^GSPC", "MSFT"),
    }


def test_corporate_comparison_watchlist_plus_benchmark_includes_zero_weight_watchlist_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    client = TestClient(app)
    # Reads never write (Task 8): a snapshot must be created explicitly before a
    # snapshot-mode read has anything to return.
    # The button now acquires stale datasets before computing (Task 9); seed every
    # ticker in this universe as fresh so the acquisition step is a no-op and the
    # test does not depend on the network.
    _seed_fresh_acquisition(["AAPL", "MSFT", "GOOGL", "^GSPC"], now=datetime.now(timezone.utc))
    refresh = client.post("/api/v1/corporate/comparison/snapshot?comparison_universe=watchlist_plus_benchmark")
    assert refresh.status_code == 200

    response = client.get("/api/v1/corporate/comparison?comparison_universe=watchlist_plus_benchmark")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["comparison_universe"] == "watchlist_plus_benchmark"
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT", "GOOGL"]
    googl = next(row for row in payload["rows"] if row["ticker"] == "GOOGL")
    assert googl["weight"] == 0.0


def test_corporate_comparison_custom_universe_persists_snapshot_metadata(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    client = TestClient(app)
    # The button now acquires stale datasets before computing (Task 9); seed every
    # ticker in this universe as fresh so the acquisition step is a no-op and the
    # test does not depend on the network.
    _seed_fresh_acquisition(["NVDA", "TSLA", "^IXIC"], now=datetime.now(timezone.utc))
    response = client.post(
        "/api/v1/corporate/comparison/snapshot"
        "?comparison_universe=custom&benchmark_ticker=%5EIXIC&custom_tickers=NVDA,TSLA"
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["mode"] == "snapshot"
    assert payload["snapshot"]["snapshot_source"] == "manual_refresh"
    assert payload["snapshot"]["comparison_universe"] == "custom"
    assert payload["snapshot"]["benchmark_ticker"] == "^IXIC"
    assert payload["snapshot"]["custom_tickers"] == ["NVDA", "TSLA"]
    assert [row["ticker"] for row in payload["rows"]] == ["^IXIC", "NVDA", "TSLA"]

    with db_service.get_db() as conn:
        snapshot_rows = conn.execute(
            """SELECT DISTINCT comparison_universe, benchmark_ticker, custom_tickers
               FROM corporate_comparison_snapshots_v3"""
        ).fetchall()
    assert len(snapshot_rows) == 1
    row = snapshot_rows[0]
    assert row["comparison_universe"] == "custom"
    assert row["benchmark_ticker"] == "^IXIC"
    assert row["custom_tickers"] == "NVDA,TSLA"


def test_corporate_comparison_live_mode_returns_live_rows_without_overwriting_snapshot(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    client = TestClient(app)
    # The button now acquires stale datasets before computing (Task 9); seed every
    # ticker in this universe as fresh so the acquisition step is a no-op and the
    # test does not depend on the network.
    _seed_fresh_acquisition(["AAPL", "MSFT", "^GSPC"], now=datetime.now(timezone.utc))
    refresh = client.post("/api/v1/corporate/comparison/snapshot")
    assert refresh.status_code == 200

    response = client.get("/api/v1/corporate/comparison?mode=live")
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["mode"] == "live"
    assert payload["snapshot"]["snapshot_available"] is True
    assert payload["snapshot"]["snapshot_source"] == "manual_refresh"
    assert payload["snapshot"]["comparison_universe"] == "portfolio_plus_benchmark"
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT"]


def test_corporate_comparison_history_returns_timeline_points(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 9, 15, 1, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison/history?comparison_universe=portfolio_plus_benchmark&limit=10")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["comparison_universe"] == "portfolio_plus_benchmark"
    assert payload["benchmark_ticker"] == "^GSPC"
    assert len(payload["points"]) == 2
    assert payload["points"][0]["as_of_date"] == "2026-04-11"
    assert payload["points"][0]["snapshot_source"] == "manual_refresh"
    assert payload["points"][0]["stock_count"] == 2
    assert payload["points"][0]["market_expected_return"] == 9.7


def test_corporate_comparison_snapshot_version_returns_selected_saved_rows(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 9, 15, 1, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    first = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/corporate/comparison/snapshot-version?snapshot_version={first.snapshot.snapshot_version}")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["snapshot_version"] == first.snapshot.snapshot_version
    assert payload["snapshot"]["as_of_date"] == "2026-04-10"
    assert [row["ticker"] for row in payload["rows"]] == ["^GSPC", "AAPL", "MSFT"]


def test_corporate_comparison_snapshot_version_can_be_deleted(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    saved = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.delete(
        f"/api/v1/corporate/comparison/snapshot-version?snapshot_version={saved.snapshot.snapshot_version}"
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot_version"] == saved.snapshot.snapshot_version
    assert payload["deleted_rows"] == 3

    with db_service.get_db() as conn:
        remaining = conn.execute(
            "SELECT COUNT(*) AS count FROM corporate_comparison_snapshots_v3"
        ).fetchone()
    assert remaining["count"] == 0


def test_corporate_comparison_stock_history_returns_saved_metric_timeline(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 9, 15, 1, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 10, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison/stock-history?ticker=AAPL&comparison_universe=portfolio_plus_benchmark&limit=10")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["ticker"] == "AAPL"
    assert len(payload["points"]) == 2
    assert payload["points"][0]["as_of_date"] == "2026-04-11"
    assert payload["points"][0]["snapshot_source"] == "manual_refresh"
    assert payload["points"][0]["roic_minus_wacc"] == 8.0


def test_corporate_bulk_dcf_reports_returns_full_reports_for_requested_tickers(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.routes import corporate as corporate_route

    def fake_full_report(
        ticker: str,
        params,
        *,
        current_price_loader,
        metrics_loader,
        risk_free_rate,
        equity_risk_premium,
        country_risk_premium,
    ):
        metrics = metrics_loader(ticker)
        current_price = current_price_loader(ticker)
        assumptions = params
        report_id = f"bulk-{ticker.lower()}"
        return {
            "summary": {
                "report_id": report_id,
                "ticker": ticker,
                "estimated_value": current_price + 25.0,
                "intrinsic_value_per_share": current_price + 25.0,
                "enterprise_value": 1462.4,
                "equity_value": 1250.0,
                "valuation_method": "intrinsic_equity_per_share",
                "bridge_quality": "ok",
                "current_price": current_price,
                "upside_pct": 25.0,
                "status": "Undervalued",
                "generated_at": "2026-04-11T12:00:00Z",
            },
            "assumptions": {
                "report_id": report_id,
                "ticker": ticker,
                "generated_at": "2026-04-11T12:00:00Z",
                "wacc_used": assumptions.wacc,
                "margin_used": 0.18,
                "growth_used": assumptions.revenue_growth_rate,
                "fcff_used": assumptions.fcff,
                "esg_penalty_used": assumptions.esg_penalty,
                "terminal_growth_used": assumptions.terminal_growth_rate,
                "enterprise_value_index": 250.0,
            },
            "projection_rows": [
                {"year": 1, "projected_fcff": 97.5, "discount_factor": 1.1, "present_value": 88.6},
            ],
            "wacc_breakdown": {
                "risk_free_rate": risk_free_rate,
                "unlevered_beta": metrics.unlevered_beta,
                "debt_ratio": metrics.debt_ratio,
                "tax_rate": 0.25,
                "equity_risk_premium": equity_risk_premium,
                "country_risk_premium": country_risk_premium,
            },
            "terminal_cash_flow": 133.2,
            "terminal_value": 1665.0,
            "present_value_of_terminal": 1034.1,
            "present_value_of_fcff": 428.3,
            "enterprise_value": 1462.4,
            "equity_value": 1250.0,
            "intrinsic_value_per_share": 125.0,
            "net_debt": 250.0,
            "non_operating_assets": 37.6,
            "diluted_shares_outstanding": 10.0,
            "valuation_method": "intrinsic_equity_per_share",
            "bridge_quality": "ok",
            "agency_discount": 0.945,
            "dcf_multiple": 15.9,
            "baseline_multiple": 12.5,
            "fcff_scale": 1.0,
        }

    monkeypatch.setattr(corporate_route, "build_dcf_full_report", fake_full_report)

    client = TestClient(app)
    response = client.post("/api/v1/corporate/dcf/reports/bulk", json={"tickers": ["AAPL", "MSFT"]})

    assert response.status_code == 200
    payload = response.json()["data"]
    assert [report["summary"]["ticker"] for report in payload] == ["AAPL", "MSFT"]
    assert payload[0]["summary"]["report_id"] == "bulk-aapl"
    assert payload[1]["summary"]["report_id"] == "bulk-msft"
    assert payload[0]["summary"]["estimated_value"] == 125.0


def test_corporate_comparison_snapshot_uses_kst_business_date_and_365_day_retention(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 11, 14, 59, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 11, 15, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    first = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    assert first.snapshot.as_of_date == "2026-04-11"
    assert first.snapshot.snapshot_retention_days == 365
    assert first.snapshot.snapshot_cadence == "daily_kst_0000"

    with db_service.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO corporate_comparison_snapshots_v3
               (snapshot_version, snapshot_date, universe_key, comparison_universe, benchmark_ticker,
                custom_tickers, snapshot_taken_at, snapshot_source, risk_free_rate, equity_risk_premium,
                stock_expected_return_method, ticker, name, sector, group_name, weight, roic, wacc,
                roic_minus_wacc, dcf_value, current_price, dcf_implied_return, capm_expected_return,
                stock_expected_return, market_expected_return, expected_return_spread,
                stock_expected_return_source, has_price_data)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "2025-04-11|portfolio_plus_benchmark|^GSPC||2026-04-11T14:59:00+00:00",
                "2025-04-11",
                "portfolio_plus_benchmark|^GSPC|",
                "portfolio_plus_benchmark",
                "^GSPC",
                "",
                first_now.isoformat(),
                "scheduled_kst_daily",
                4.2,
                5.5,
                "dcf_implied_upside",
                "OLD",
                "Old",
                "Legacy",
                "legacy",
                0.0,
                1.0,
                1.0,
                0.0,
                1.0,
                1.0,
                0.0,
                0.0,
                9.7,
                9.7,
                -9.7,
                "dcf_implied_upside",
                1,
            ),
        )

    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    second = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="scheduled_kst_daily",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )
    assert second.snapshot.as_of_date == "2026-04-12"

    with db_service.get_db() as conn:
        remaining_dates = [
            row["snapshot_date"]
            for row in conn.execute(
                "SELECT DISTINCT snapshot_date FROM corporate_comparison_snapshots_v3 ORDER BY snapshot_date"
            ).fetchall()
        ]
    assert "2025-04-11" not in remaining_dates
    assert "2026-04-11" in remaining_dates
    assert "2026-04-12" in remaining_dates


def test_manual_refresh_keeps_multiple_intraday_versions_for_same_kst_day(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()
    _patch_comparison_sources(monkeypatch)

    from apps.api.services import corporate_comparison as comparison_service

    first_now = datetime(2026, 4, 11, 0, 30, tzinfo=timezone.utc)
    second_now = datetime(2026, 4, 11, 1, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(comparison_service, "_now_utc", lambda: first_now)
    first = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    monkeypatch.setattr(comparison_service, "_now_utc", lambda: second_now)
    second = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: {
            "AAPL": CorporateMetrics(ticker="AAPL", growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "MSFT": CorporateMetrics(ticker="MSFT", growth=7, roic=22, wacc=9, debt_ratio=15, unlevered_beta=0.95, crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64, governance=74, esg_penalty=22),
            "^GSPC": CorporateMetrics(ticker="^GSPC", growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0, crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100, governance=70, esg_penalty=10),
        }[ticker],
        price_loader=lambda _ticker: 100.0,
        default_companies={"AAPL": {"name": "Apple", "sector": "Technology"}, "MSFT": {"name": "Microsoft", "sector": "Technology"}},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert first.snapshot.as_of_date == second.snapshot.as_of_date == "2026-04-11"
    assert first.snapshot.snapshot_version != second.snapshot.snapshot_version

    with db_service.get_db() as conn:
        version_count = conn.execute(
            """SELECT COUNT(DISTINCT snapshot_version) AS version_count
               FROM corporate_comparison_snapshots_v3
               WHERE snapshot_date = ? AND universe_key = ?""",
            ("2026-04-11", "portfolio_plus_benchmark|^GSPC|"),
        ).fetchone()
    assert int(version_count["version_count"]) == 2


@pytest.mark.virgin_db
def test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)

    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE corporate_comparison_snapshots (
                snapshot_date TEXT NOT NULL,
                snapshot_taken_at TEXT NOT NULL,
                snapshot_source TEXT DEFAULT 'auto_daily',
                risk_free_rate REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom',
                weight REAL DEFAULT 0.0,
                roic REAL NOT NULL DEFAULT 0.0,
                wacc REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc REAL NOT NULL DEFAULT 0.0,
                dcf_value REAL NOT NULL DEFAULT 0.0,
                current_price REAL NOT NULL DEFAULT 0.0,
                stock_expected_return REAL NOT NULL DEFAULT 0.0,
                market_expected_return REAL NOT NULL DEFAULT 0.0,
                expected_return_spread REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_date, ticker)
            );

            CREATE TABLE corporate_comparison_snapshots_v2 (
                snapshot_date TEXT NOT NULL,
                universe_key TEXT NOT NULL,
                snapshot_taken_at TEXT NOT NULL,
                snapshot_source TEXT DEFAULT 'auto_daily',
                risk_free_rate REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom',
                weight REAL DEFAULT 0.0,
                roic REAL NOT NULL DEFAULT 0.0,
                wacc REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc REAL NOT NULL DEFAULT 0.0,
                dcf_value REAL NOT NULL DEFAULT 0.0,
                current_price REAL NOT NULL DEFAULT 0.0,
                stock_expected_return REAL NOT NULL DEFAULT 0.0,
                market_expected_return REAL NOT NULL DEFAULT 0.0,
                expected_return_spread REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_date, universe_key, ticker)
            );

            CREATE TABLE corporate_comparison_snapshots_v3 (
                snapshot_version TEXT NOT NULL,
                snapshot_date TEXT NOT NULL,
                universe_key TEXT NOT NULL,
                snapshot_taken_at TEXT NOT NULL,
                snapshot_source TEXT DEFAULT 'auto_daily',
                risk_free_rate REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker TEXT NOT NULL,
                name TEXT DEFAULT '',
                sector TEXT DEFAULT '',
                group_name TEXT DEFAULT 'custom',
                weight REAL DEFAULT 0.0,
                roic REAL NOT NULL DEFAULT 0.0,
                wacc REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc REAL NOT NULL DEFAULT 0.0,
                dcf_value REAL NOT NULL DEFAULT 0.0,
                current_price REAL NOT NULL DEFAULT 0.0,
                dcf_implied_return REAL NOT NULL DEFAULT 0.0,
                capm_expected_return REAL NOT NULL DEFAULT 0.0,
                stock_expected_return REAL NOT NULL DEFAULT 0.0,
                market_expected_return REAL NOT NULL DEFAULT 0.0,
                expected_return_spread REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_version, ticker)
            );
            """
        )

        # A row computed before metric_schema_version existed, to check what it migrates to.
        conn.execute(
            """INSERT INTO corporate_comparison_snapshots_v3
                   (snapshot_version, snapshot_date, universe_key, snapshot_taken_at, ticker)
               VALUES ('legacy|key', '2026-07-01', 'key', '2026-07-01T00:00:00+00:00', 'AAPL')"""
        )

    db_service.init_db()

    with db_service.get_db() as conn:
        legacy_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots)")}
        v2_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v2)")}
        v3_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v3)")}
        v3_indexes = {row["name"] for row in conn.execute("PRAGMA index_list(corporate_comparison_snapshots_v3)")}
        legacy_schema_version = conn.execute(
            "SELECT metric_schema_version FROM corporate_comparison_snapshots_v3 WHERE ticker = 'AAPL'"
        ).fetchone()["metric_schema_version"]

    assert "comparison_universe" in legacy_columns
    assert {"universe_key", "comparison_universe", "benchmark_ticker", "custom_tickers"}.issubset(v2_columns)
    assert {"universe_key", "comparison_universe", "benchmark_ticker", "custom_tickers"}.issubset(v3_columns)
    # metric_schema_version is new in Task 9; this legacy v3 table was created without it,
    # so its presence here proves the guarded ALTER TABLE migration actually ran.
    assert "metric_schema_version" in v3_columns
    # Rows predating the column migrate to 0, not to the current version. Stamping them
    # with METRIC_SCHEMA_VERSION would make pre- and post-change snapshots compare as like
    # for like, which is the one thing the column exists to prevent.
    assert legacy_schema_version == 0
    assert {
        "idx_corporate_comparison_snapshots_v3_universe_date",
        "idx_corporate_comparison_snapshots_v3_ticker_universe_date",
    }.issubset(v3_indexes)


@pytest.mark.virgin_db
def test_init_db_migrates_legacy_rows_to_an_empty_bridge_quality_not_missing(tmp_path, monkeypatch):
    """The '' default is the constraint this task cared most about: it is what stops every
    historical average being silently rewritten when the column is introduced. A test that
    only ever inserts '' explicitly (as the other legacy-rows test in this file does) would
    pass unchanged even if the guarded ALTER TABLE defaulted to 'missing' instead -- this
    test instead exercises the ALTER itself, on a table that predates the column, the same
    way test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables above
    exercises the metric_schema_version migration."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)

    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE corporate_comparison_snapshots_v3 (
                snapshot_version             TEXT NOT NULL,
                snapshot_date                TEXT NOT NULL,
                universe_key                 TEXT NOT NULL,
                comparison_universe          TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark',
                benchmark_ticker             TEXT DEFAULT '^GSPC',
                custom_tickers               TEXT DEFAULT '',
                snapshot_taken_at            TEXT NOT NULL,
                snapshot_source              TEXT DEFAULT 'auto_daily',
                risk_free_rate               REAL NOT NULL DEFAULT 0.0,
                equity_risk_premium          REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
                ticker                       TEXT NOT NULL,
                name                         TEXT DEFAULT '',
                sector                       TEXT DEFAULT '',
                group_name                   TEXT DEFAULT 'custom',
                weight                       REAL DEFAULT 0.0,
                roic                         REAL NOT NULL DEFAULT 0.0,
                wacc                         REAL NOT NULL DEFAULT 0.0,
                roic_minus_wacc              REAL NOT NULL DEFAULT 0.0,
                dcf_value                    REAL NOT NULL DEFAULT 0.0,
                current_price                REAL NOT NULL DEFAULT 0.0,
                dcf_implied_return           REAL NOT NULL DEFAULT 0.0,
                capm_expected_return         REAL NOT NULL DEFAULT 0.0,
                stock_expected_return        REAL NOT NULL DEFAULT 0.0,
                market_expected_return       REAL NOT NULL DEFAULT 0.0,
                expected_return_spread       REAL NOT NULL DEFAULT 0.0,
                stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
                has_price_data               INTEGER NOT NULL DEFAULT 1,
                metric_schema_version        INTEGER NOT NULL DEFAULT 1,
                PRIMARY KEY (snapshot_version, ticker)
            );
            """
        )

        # A row computed before bridge_quality existed, to check what it migrates to.
        conn.execute(
            """INSERT INTO corporate_comparison_snapshots_v3
                   (snapshot_version, snapshot_date, universe_key, snapshot_taken_at, ticker)
               VALUES ('legacy|key', '2026-07-01', 'key', '2026-07-01T00:00:00+00:00', 'AAPL')"""
        )

    db_service.init_db()

    with db_service.get_db() as conn:
        v3_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v3)")}
        legacy_bridge_quality = conn.execute(
            "SELECT bridge_quality FROM corporate_comparison_snapshots_v3 WHERE ticker = 'AAPL'"
        ).fetchone()["bridge_quality"]

    # bridge_quality is new here; its presence proves the guarded ALTER TABLE ran.
    assert "bridge_quality" in v3_columns
    # Rows predating the column migrate to '', not 'missing'. Defaulting them to 'missing'
    # would flip the aggregate exclusion rule (bridge_quality != 'missing') on every
    # historical row at once, silently rewriting every average computed before this task.
    assert legacy_bridge_quality == ""


def test_reading_a_comparison_never_writes_a_snapshot():
    """The deleted fallback: a read used to compute and persist a snapshot when today's
    was missing -- a multi-minute sweep inside a request the user never asked for."""
    with db_service.get_db() as conn:
        before = conn.execute("SELECT COUNT(*) AS n FROM corporate_comparison_snapshots_v3").fetchone()["n"]

    build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        after = conn.execute("SELECT COUNT(*) AS n FROM corporate_comparison_snapshots_v3").fetchone()["n"]
    assert after == before


def test_reading_with_no_snapshot_returns_an_empty_state():
    response = build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert response.rows == []
    assert response.snapshot.snapshot_available is False


def test_the_lifespan_starts_no_snapshot_cycle():
    import apps.api.main as api_main

    assert not hasattr(api_main, "corporate_snapshot_cycle")


def test_a_snapshot_from_an_earlier_date_is_returned_and_is_not_marked_stale():
    """Manual-only snapshots have no cadence to be late for. Under the old daily cadence a
    snapshot not taken today meant a missed refresh; now it means the user last asked then,
    which is exactly what a snapshot is for."""
    from apps.api.services import corporate_comparison as comparison_service

    # Build one via save_corporate_comparison_snapshot, then age it by moving its
    # snapshot_date to an earlier day directly in SQLite -- the same seeding style the
    # other snapshot tests in this file already use.
    saved = comparison_service.save_corporate_comparison_snapshot(
        snapshot_source="manual_refresh",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker: CorporateMetrics(
            ticker=ticker, growth=5, roic=10, wacc=8, debt_ratio=0, unlevered_beta=1.0,
            crp=0.0, reinvestment=20, fcff=92, innovation=40, market_share=100,
            governance=70, esg_penalty=10,
        ),
        price_loader=lambda _ticker: 100.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        conn.execute(
            "UPDATE corporate_comparison_snapshots_v3 SET snapshot_date = ? WHERE snapshot_version = ?",
            ("2020-01-01", saved.snapshot.snapshot_version),
        )

    response = build_corporate_comparison_response(
        mode="snapshot",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=lambda ticker, **kwargs: pytest.fail("a read must not compute metrics"),
        price_loader=lambda ticker: 0.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    assert response.rows != []
    assert response.snapshot.snapshot_is_stale is False


def test_a_snapshot_records_the_metric_schema_version():
    """Snapshots are immutable and comparable. Two computed by different metric code are
    not like for like, and without this field that difference is invisible -- the
    comparison feature would blame the company for a change in the code."""
    save_corporate_comparison_snapshot(
        snapshot_source="manual",
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        metrics_loader=_stub_metrics_loader,
        price_loader=lambda ticker: 10.0,
        default_companies={},
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
    )

    with db_service.get_db() as conn:
        row = conn.execute(
            "SELECT metric_schema_version, snapshot_version FROM corporate_comparison_snapshots_v3 LIMIT 1"
        ).fetchone()

    assert row["metric_schema_version"] == METRIC_SCHEMA_VERSION
    assert "|" in row["snapshot_version"]


def test_snapshots_are_immutable_a_second_save_adds_rather_than_updates():
    """A newer snapshot is a new observation, never an update to the old one.

    Counting rows would only prove multiplicity. This saves twice at different prices,
    then re-reads the FIRST snapshot's stored rows and asserts they are byte-identical
    to what was written -- the earlier observation survives as evidence. The assertion
    that the second snapshot's values actually differ keeps the first assertion honest:
    without it, both snapshots could be identical and the test would pass vacuously.
    """

    def _save(price: float):
        return save_corporate_comparison_snapshot(
            snapshot_source="manual",
            comparison_universe="portfolio_plus_benchmark",
            benchmark_ticker="^GSPC",
            custom_tickers=[],
            metrics_loader=_stub_metrics_loader,
            price_loader=lambda ticker: price,
            default_companies={},
            risk_free_rate=0.042,
            equity_risk_premium=0.055,
        )

    def _rows_for(version: str) -> list[tuple]:
        with db_service.get_db() as conn:
            return [
                tuple(row)
                for row in conn.execute(
                    "SELECT * FROM corporate_comparison_snapshots_v3"
                    " WHERE snapshot_version = ? ORDER BY ticker",
                    (version,),
                ).fetchall()
            ]

    first_version = _save(10.0).snapshot.snapshot_version
    first_rows = _rows_for(first_version)
    assert first_rows != []

    second_version = _save(20.0).snapshot.snapshot_version
    assert second_version != first_version

    assert _rows_for(first_version) == first_rows
    assert _rows_for(second_version) != first_rows


def test_the_button_acquires_nothing_when_every_dataset_is_fresh(tmp_path, monkeypatch):
    """Idempotence, stated in the spec: re-running acquisition within the freshness boundary
    performs no network work and does not modify local state."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()

    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    _seed_fresh_acquisition(["AAPL", "MSFT", "^GSPC"], now=now)

    company_data = load_company_universe_data({})
    calls = []
    acquire_comparison_datasets(
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        company_registry=company_data.registry,
        watchlist_payload=company_data.watchlist_rows,
        now=now,
        statements_fetcher=lambda ticker: calls.append(ticker) or [],
        quote_facts_fetcher=lambda ticker: calls.append(ticker) or None,
    )
    assert calls == []


def test_the_button_acquires_a_stale_ticker(tmp_path, monkeypatch):
    """The other half: fresh means skip, stale means fetch. Without this, a boundary that
    never expires would pass the idempotence test and silently freeze the data."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()

    now = datetime(2026, 7, 30, 12, 0, tzinfo=timezone.utc)
    # AAPL and ^GSPC are fresh; MSFT was never acquired, so it is stale.
    _seed_fresh_acquisition(["AAPL", "^GSPC"], now=now)

    company_data = load_company_universe_data({})
    calls = []

    def fake_statements_fetcher(ticker: str) -> list[StatementRow]:
        calls.append(("statements", ticker))
        return [
            StatementRow(
                ticker=ticker, statement_type="income", frequency="annual",
                period_end="2025-12-31", line_item="revenue", value=100.0,
            )
        ]

    def fake_quote_facts_fetcher(ticker: str) -> QuoteFacts:
        calls.append(("market_cap", ticker))
        return QuoteFacts(ticker=ticker, market_cap=1000.0, shares_outstanding=10.0, currency="USD")

    acquire_comparison_datasets(
        comparison_universe="portfolio_plus_benchmark",
        benchmark_ticker="^GSPC",
        custom_tickers=[],
        company_registry=company_data.registry,
        watchlist_payload=company_data.watchlist_rows,
        now=now,
        statements_fetcher=fake_statements_fetcher,
        quote_facts_fetcher=fake_quote_facts_fetcher,
    )

    assert calls == [("statements", "MSFT"), ("market_cap", "MSFT")]


def test_a_live_comparison_computes_with_no_network_at_all(tmp_path, monkeypatch):
    """The architectural invariant, end to end and unstubbed.

    Every other test in this file injects _metrics_for_ticker and _latest_market_price,
    which leaves the suite's network guard silent at exactly the boundary a violation
    would live at -- and one did live there until 2026-07-31: the price loader fetched a
    live quote per ticker inside metric computation. Nothing is patched here except the
    database, so if any part of the metric path reaches out, _forbid_network fails this.
    """
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist()

    for ticker in ("AAPL", "MSFT", "^GSPC"):
        rows = []
        for year, revenue in ((2024, 1_000_000.0), (2025, 1_100_000.0)):
            period = f"{year}-12-31"
            for item, value in (
                ("Total Revenue", revenue),
                ("Operating Income", revenue * 0.1),
                ("Pretax Income", revenue * 0.1),
                ("Tax Provision", revenue * 0.025),
            ):
                rows.append(StatementRow(ticker, "income", "annual", period, item, value))
            for item, value in (("Total Debt", 2_000_000.0), ("Stockholders Equity", 8_000_000.0)):
                rows.append(StatementRow(ticker, "balance", "annual", period, item, value))
        save_statements(ticker, rows)
        save_quote_facts(ticker, QuoteFacts(ticker, 9_000_000.0, 1_000.0, "USD", beta=1.1))

    with db_service.get_db() as conn:
        for ticker in ("AAPL", "MSFT"):
            conn.execute(
                """INSERT INTO stocks (ticker, date, open, high, low, close, volume)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (ticker, "2026-07-30", 120.0, 130.0, 119.0, 123.45, 1_000),
            )

    client = TestClient(app)
    response = client.get("/api/v1/corporate/comparison?mode=live")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["snapshot"]["mode"] == "live"
    # The stored close, not a live quote.
    aapl = next(row for row in payload["rows"] if row["ticker"] == "AAPL")
    assert aapl["current_price"] == 123.45
