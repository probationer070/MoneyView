"""The committed seed is a neutral starter list, and swapping it never touches local rows (spec §3)."""

import json

from apps.api.services import watchlist_seed
from apps.api.services.db import get_db

NEUTRAL = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"]


def test_the_committed_seed_is_exactly_the_neutral_starter_list():
    data = json.loads(watchlist_seed.SEED_JSON.read_text(encoding="utf-8"))
    assert set(data) == {"custom", "total"}
    assert [t["ticker"] for t in data["custom"]["targets"]] == NEUTRAL
    assert data["total"] == {"targets": []}
    assert all(set(t) == {"ticker", "name", "sector", "weight"} and t["weight"] == 0.0 for t in data["custom"]["targets"])


def test_swapping_the_seed_leaves_existing_local_rows_untouched(tmp_path, monkeypatch):
    monkeypatch.delenv("MONEYVIEW_SYNC_DIR", raising=False)
    with get_db() as conn:
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES ('ZZLOCAL', 'Local Only', 'Other', 'custom', 0.3)")
        conn.execute("INSERT INTO watchlist (ticker, name, sector, group_name, weight) VALUES ('AAPL', 'My Apple', 'Tech', 'total', 0.7)")

    watchlist_seed.ensure_watchlist_bootstrapped(watchlist_seed.SEED_JSON)
    watchlist_seed.merge_missing_watchlist_items(watchlist_seed.SEED_JSON)

    with get_db() as conn:
        rows = {r["ticker"]: (r["name"], r["group_name"], r["weight"]) for r in conn.execute("SELECT * FROM watchlist")}
    assert rows["ZZLOCAL"] == ("Local Only", "custom", 0.3), "a local ticker absent from the new seed is never deleted"
    assert rows["AAPL"] == ("My Apple", "total", 0.7), "a curated row is never overwritten by the seed"
