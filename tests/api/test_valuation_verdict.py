import pytest

from apps.api.services.db import get_db
from apps.api.services.valuation_verdict import DIRECTION, build_verdict


def _facts(ticker, industry="Semiconductors"):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )


def _bars(ticker, rows):
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(ticker, d, c, c, c, c, v) for d, c, v in rows],
        )


_SERIES = [("2025-01-0%d" % i, float(100 + i * 10), 100 * i) for i in range(1, 6)]


def test_the_panel_always_states_the_direction_being_tested():
    """Mandated by the industry-relative spec: benchmarking against the top of a
    sector is conservative for undervaluation and anti-conservative for the
    opposite, and the verdict layer must say which it is testing."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    assert panel["direction"] == DIRECTION
    assert "anti-conservative" in DIRECTION


def test_drawdown_and_volume_compute_from_stored_bars():
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, _SERIES)
    _bars("TGT", [("2025-01-06", 120.0, 900)])
    panel = build_verdict("TGT")
    assert panel["rows"]["drawdown"]["value"] == pytest.approx((120.0 - 150.0) / 150.0)
    assert panel["rows"]["drawdown"]["reason"] is None
    assert panel["rows"]["volume"]["value"] is not None


def test_a_thin_peer_set_refuses_only_the_peer_rows():
    """Refusal is per-signal: a missing peer comparison must not take the whole
    panel down with it."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["drawdown"]["reason"] == "peer_set_too_thin: 0 peers"
    assert panel["rows"]["drawdown"]["value"] is None
    assert panel["rows"] != {}


def test_a_ticker_with_no_case_refuses_only_the_dcf_row():
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["dcf_gap"]["reason"] == "no_case: TGT"
    assert panel["rows"]["drawdown"]["value"] is not None


def test_the_pe_row_refuses_when_the_vintage_has_no_trailing_pe():
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["trailing_pe"]["reason"].startswith("no_sector_pe")


def test_every_row_names_its_source():
    """A reader must never have to guess whether 'the sector' meant Damodaran's
    census or the handful of tickers this installation happens to store."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    for name, row in panel["rows"].items():
        assert row["source"], f"{name} has no source"


def test_the_service_reaches_no_network():
    """bars_loader is injected, so a missed wire is visible rather than silently
    reaching market_data.get_stock_ohlcv, which refreshes live when stale."""
    _facts("TGT")
    for t in ("P1", "P2", "P3"):
        _facts(t)
    calls = []

    def loader(ticker, limit=None):
        calls.append(ticker)
        return [{"date": d, "close": c, "volume": v} for d, c, v in _SERIES]

    build_verdict("TGT", bars_loader=loader)
    assert set(calls) == {"TGT", "P1", "P2", "P3"}


def test_a_null_close_in_the_subject_bars_does_not_crash_the_panel():
    """Finding 1, path :55. `load_price_bars` documents that NULL close passes
    through as stored and the caller must handle it."""
    _facts("TGT")
    panel = build_verdict(
        "TGT",
        bars_loader=lambda t, limit=None: [
            {"date": "2025-01-01", "close": None, "volume": 100}
        ],
    )
    assert panel["direction"] == DIRECTION
    assert panel["rows"]["drawdown"]["reason"] is not None
    assert panel["rows"]["drawdown"]["value"] is None


def test_a_null_close_among_peer_bars_does_not_crash_the_panel():
    """Finding 1, path :69. One bad peer must not kill the subject's own row."""
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
    _bars("TGT", _SERIES)
    _bars("P2", _SERIES)
    _bars("P3", _SERIES)

    def loader(ticker, limit=None):
        if ticker == "P1":
            return [{"date": "2025-01-01", "close": None, "volume": 100}]
        return [{"date": d, "close": c, "volume": v} for d, c, v in _SERIES]

    panel = build_verdict("TGT", bars_loader=loader)
    assert panel["rows"]["drawdown"]["value"] is not None
    assert panel["rows"]["drawdown"]["reason"] is None


def test_a_stored_case_that_fails_to_run_refuses_only_the_dcf_row(monkeypatch):
    """Finding 1, path :115. `run_stored_case` documents raising ValueError on
    any model-invalid input; that must become this row's reason, not a crash."""
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, _SERIES)
    monkeypatch.setattr(
        "apps.api.services.valuation_verdict.find_conservative_case_id",
        lambda ticker: 999,
    )

    def broken_run(case_id):
        raise ValueError("case is not valuable: bad wacc")

    monkeypatch.setattr(
        "apps.api.services.valuation_verdict.run_stored_case", broken_run
    )

    panel = build_verdict("TGT")
    assert "999" in panel["rows"]["dcf_gap"]["reason"]
    assert panel["rows"]["dcf_gap"]["value"] is None
    assert panel["rows"]["drawdown"]["value"] is not None


def test_a_non_positive_last_close_refuses_the_dcf_row_without_dividing(monkeypatch):
    """Finding 1, path :118. `[0.0]` is truthy, so the `not closes` guard
    misses it; the row must refuse instead of raising ZeroDivisionError, and
    must never even call `run_stored_case`."""
    _facts("TGT")
    monkeypatch.setattr(
        "apps.api.services.valuation_verdict.find_conservative_case_id",
        lambda ticker: 999,
    )

    def unexpected_run(case_id):
        raise AssertionError("run_stored_case must not be called for a non-positive price")

    monkeypatch.setattr(
        "apps.api.services.valuation_verdict.run_stored_case", unexpected_run
    )

    panel = build_verdict(
        "TGT",
        bars_loader=lambda t, limit=None: [
            {"date": "2025-01-01", "close": 0.0, "volume": 100}
        ],
    )
    assert panel["rows"]["dcf_gap"]["reason"] is not None
    assert panel["rows"]["dcf_gap"]["value"] is None


def test_volume_computes_and_names_its_source_even_with_a_thin_peer_set():
    """Finding 2/3: volume is computed purely from the subject's own bars, so a
    thin peer set must not refuse it, and its source must name the window and
    that it came from the subject's own bars, not the peer count."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    volume = panel["rows"]["volume"]
    assert volume["reason"] is None
    assert volume["value"] is not None
    assert volume["source"].startswith("own bars:")


def test_a_falsy_recent_ratio_is_not_discarded_by_the_fallback():
    """Finding 3: volume_ratio can legitimately return 0.0 for a dead recent
    window; `or` would treat that as failure and fall through to a different,
    unlabeled window. Using `is None` keeps the real 0.0 reading."""
    _facts("TGT")
    # Oldest-first, as `bars_loader` contracts: 162 older bars with real
    # volume, then the most recent 90 bars dead at volume 0.
    volumes = [100] * 162 + [0] * 90
    bars = [
        {"date": f"2025-{i:04d}-01", "close": 10.0, "volume": v}
        for i, v in enumerate(volumes, start=1)
    ]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)
    volume = panel["rows"]["volume"]
    assert volume["value"] == pytest.approx(0.0)
    assert volume["source"] == "own bars: 90d/252d"


def test_a_thin_peer_set_that_resolves_with_no_bars_keeps_the_value(monkeypatch):
    """Finding 4: when peers resolve but none has bars, the row must keep the
    subject's own drawdown value while its source says no comparison was
    possible, rather than dressing an absolute number as `peers: 0 stored`."""
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
    _bars("TGT", _SERIES)

    def loader(ticker, limit=None):
        if ticker == "TGT":
            return [{"date": d, "close": c, "volume": v} for d, c, v in _SERIES]
        return []

    panel = build_verdict("TGT", bars_loader=loader)
    drawdown = panel["rows"]["drawdown"]
    assert drawdown["value"] is not None
    assert drawdown["comparison"] is None
    assert drawdown["reason"] is None
    assert "0" in drawdown["source"]
    assert drawdown["source"] != "peers: 0 stored"
