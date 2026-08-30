from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.db import get_db
from apps.api.services.peer_set import MIN_PEERS, resolve_peers


def _seed_facts(ticker, industry="Semiconductors"):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )


def _seed_bars(ticker, rows):
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(ticker, d, c, c, c, c, v) for d, c, v in rows],
        )


def test_load_price_bars_reads_the_local_store_oldest_first():
    _seed_bars("AAA", [("2025-01-02", 11.0, 200), ("2025-01-01", 10.0, 100)])
    bars = load_price_bars("AAA")
    assert [b["date"] for b in bars] == ["2025-01-01", "2025-01-02"]
    assert [b["close"] for b in bars] == [10.0, 11.0]
    assert [b["volume"] for b in bars] == [100, 200]


def test_load_price_bars_returns_empty_for_an_unknown_ticker():
    assert load_price_bars("NOPE") == []


def test_load_price_bars_limit_keeps_the_most_recent():
    _seed_bars("BBB", [(f"2025-01-0{i}", float(i), i * 10) for i in range(1, 6)])
    bars = load_price_bars("BBB", limit=2)
    assert [b["date"] for b in bars] == ["2025-01-04", "2025-01-05"]


def test_load_price_bars_passes_through_a_null_close():
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES ('NULLC', '2025-01-01', 1.0, 1.0, 1.0, NULL, 100)"
        )
    bars = load_price_bars("NULLC")
    assert bars[0]["close"] is None


def test_peers_are_same_industry_tickers_excluding_self():
    for t in ("TGT", "P1", "P2", "P3"):
        _seed_facts(t)
    _seed_facts("OTHER", industry="Software (System & Application)")
    peers, reason = resolve_peers("TGT")
    assert reason is None
    assert sorted(peers) == ["P1", "P2", "P3"]


def test_a_thin_peer_set_refuses_rather_than_averaging_over_too_few():
    """MIN_PEERS matches resolve_benchmark's own `minimum=3`, so the two layers
    cannot disagree about what 'enough' means."""
    assert MIN_PEERS == 3
    for t in ("TGT", "P1", "P2"):
        _seed_facts(t)
    peers, reason = resolve_peers("TGT")
    assert peers == []
    assert reason == "peer_set_too_thin: 2 peers"


def test_a_ticker_with_no_stored_industry_refuses():
    peers, reason = resolve_peers("GHOST")
    assert peers == []
    assert reason == "no_industry: GHOST"


def test_a_ticker_with_empty_string_industry_refuses():
    """`industry` is back-filled to '' by an ALTER TABLE migration (db.py),
    so a pre-migration ticker has a row present with industry == '', not
    absent. That must refuse exactly like the no-row case, not fall through
    to WHERE industry = '' and match every other pre-migration ticker."""
    _seed_facts("BLANK", industry="")
    peers, reason = resolve_peers("BLANK")
    assert peers == []
    assert reason == "no_industry: BLANK"
