import datetime as _dt

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


# 260 bars, so the 252-bar drawdown window is filled. The shape is deliberate
# and every expected value below derives from it rather than from a magic
# number: closes climb 100 -> 200 over the first 200 bars, then fall to 150,
# so the peak sits inside the window and the drawdown is exactly -25%.
def _date(i: int) -> str:
    return str(_dt.date(2024, 1, 1) + _dt.timedelta(days=i))


_PEAK_INDEX = 199
_SERIES_BARS = 260


def _series_close(i: int) -> float:
    if i <= _PEAK_INDEX:
        return 100.0 + i * (100.0 / _PEAK_INDEX)
    return 200.0 - (i - _PEAK_INDEX) * (50.0 / (_SERIES_BARS - 1 - _PEAK_INDEX))


_SERIES = [
    ((_date(i)), _series_close(i), 100)
    for i in range(_SERIES_BARS)
]
_SERIES_DRAWDOWN = (_series_close(_SERIES_BARS - 1) - 200.0) / 200.0


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
    _bars("TGT", [(_date(_SERIES_BARS), 120.0, 900)])
    panel = build_verdict("TGT")
    # Measured from the series' 200.0 peak to the appended close, not from the
    # series' own last bar -- the peak is what a drawdown is relative to.
    assert panel["rows"]["drawdown"]["value"] == pytest.approx((120.0 - 200.0) / 200.0)
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
    """A vintage IS loaded here, so `no_case` is the real cause. Without one the
    row refuses `no_vintage` instead -- a different fact about the server, not
    about this ticker -- and this test would pass for the wrong reason."""
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["dcf_gap"]["reason"] == "no_case: TGT has no stored conservative case"
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
    assert volume["source"] == "own bars: 90/252 bars"


def test_a_null_volume_is_dropped_rather_than_counted_as_zero():
    """Finding A: `int(b["volume"] or 0)` turned an unknown volume into "zero
    traded", dragging the baseline mean down and inflating the ratio. The two
    NULLs here must be dropped -- like `_closes_from_bars` already drops NULL
    closes -- not substituted with 0."""
    _facts("TGT")
    bars = [
        {"date": "2025-01-01", "close": 10.0, "volume": None},
        {"date": "2025-01-02", "close": 10.0, "volume": None},
        {"date": "2025-01-03", "close": 10.0, "volume": 100},
        {"date": "2025-01-04", "close": 10.0, "volume": 100},
    ]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)
    volume = panel["rows"]["volume"]
    # Buggy behaviour: NULLs -> 0, baseline mean (0+0+100+100)/4 = 50, recent
    # mean (100+100)/2 = 100, ratio 100/50 = 2.0, source "own bars: 2/4 bars".
    # Correct behaviour: NULLs dropped, only [100, 100] remain, so the
    # fallback window is 1/2 bars and the ratio is 1.0 -- no distortion at all.
    assert volume["value"] == pytest.approx(1.0)
    assert volume["source"] == (
        "own bars: 1/2 bars (baseline spans 2025-01-03 to 2025-01-04)"
    )


def test_a_genuine_zero_volume_is_kept_not_dropped():
    """The other half of Finding A: only `None` is a missing reading. A
    genuinely stored `0` is real data and must still be counted, so the fix
    must check `is not None` rather than falsiness (which `or 0` also gets
    wrong for a real `0`)."""
    _facts("TGT")
    bars = [
        {"date": "2025-01-01", "close": 10.0, "volume": 100},
        {"date": "2025-01-02", "close": 10.0, "volume": 100},
        {"date": "2025-01-03", "close": 10.0, "volume": 0},
        {"date": "2025-01-04", "close": 10.0, "volume": 0},
    ]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)
    volume = panel["rows"]["volume"]
    # All 4 bars have a real (non-NULL) volume, so the window stays 2/4 bars and
    # the real 0.0 recent mean must survive into the ratio.
    assert volume["source"] == "own bars: 2/4 bars"
    assert volume["value"] == pytest.approx(0.0)


def test_a_stale_price_carries_its_date_into_the_dcf_gap_and_drawdown_rows(monkeypatch):
    """Finding B: dropping the newest bar's NULL close makes `closes[-1]` an
    OLDER bar's price. Refusing outright would be too aggressive -- it is
    genuinely the last known price -- so its date must be visible in both
    rows that report it, not silently presented as "the" price."""
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
    monkeypatch.setattr(
        "apps.api.services.valuation_verdict.find_conservative_case_id",
        lambda ticker: 999,
    )
    monkeypatch.setattr(
        "apps.api.services.valuation_verdict.run_stored_case",
        lambda case_id: {"value_per_share_diluted": 200.0},
    )
    tgt_bars = [{"date": d, "close": c, "volume": v} for d, c, v in _SERIES]
    tgt_bars[-1] = {**tgt_bars[-1], "close": None}
    stale_date = tgt_bars[-2]["date"]
    newest_date = tgt_bars[-1]["date"]
    assert stale_date != newest_date

    def loader(ticker, limit=None):
        if ticker == "TGT":
            return tgt_bars
        return [{"date": d, "close": c, "volume": v} for d, c, v in _SERIES]

    panel = build_verdict("TGT", bars_loader=loader)

    dcf = panel["rows"]["dcf_gap"]
    assert dcf["value"] is not None
    assert stale_date in dcf["comparison"]
    assert newest_date not in dcf["comparison"]  # the row must not claim the newest date

    drawdown = panel["rows"]["drawdown"]
    assert drawdown["value"] is not None
    # The note lives in `source`, not `comparison`: it qualifies the subject's own
    # price, and `comparison` is the sector-comparison slot, which a sibling test
    # pins as None when no comparison was possible.
    assert stale_date in drawdown["source"]
    assert newest_date in drawdown["source"]
    assert "price as of" not in (drawdown["comparison"] or "")
    # The other half of the contract: the note leaving `comparison` must not
    # take the peer figure with it -- `comparison` still has to carry the
    # sector comparison it exists to report.
    assert drawdown["comparison"] is not None
    assert drawdown["comparison"].startswith("peer mean")


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


def test_the_volume_source_counts_bars_not_days(monkeypatch):
    """ND-1: the window is a position count in the NULL-filtered series, so
    labelling it `252d` is false whenever any volume was dropped.

    `load_price_bars` warns that filtering NULL rows "would silently shorten
    the series and change what 'the last n bars' means"; this module does that
    filtering, so it must re-establish the meaning. A contiguous series cannot
    catch this -- every other volume here is NULL, so 4 positions span 7 days.
    """
    _facts("TGT")
    bars = [
        {"date": f"2025-01-{i:02d}", "close": 10.0, "volume": (None if i % 2 == 0 else 100)}
        for i in range(1, 8)
    ]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)
    source = panel["rows"]["volume"]["source"]
    # Non-contiguous, so the span must be stated rather than implied.
    assert source == "own bars: 2/4 bars (baseline spans 2025-01-01 to 2025-01-07)"


def test_no_usable_volume_names_volume_as_the_cause_not_history():
    """ND-3: with bars present but every volume NULL, `insufficient_history`
    named the wrong cause -- history is plentiful, volume is what is absent --
    and the source read `1d/0d`, a zero-length window indistinguishable from
    the genuinely-empty panel."""
    _facts("TGT")
    bars = [{"date": f"2025-02-{i:02d}", "close": 10.0, "volume": None} for i in range(1, 20)]
    volume = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)["rows"]["volume"]
    assert volume["value"] is None
    assert volume["reason"] == "no_volume: 0 of 19 bars have volume"
    assert volume["source"] == "own bars: 0 of 19 bars have volume"


def test_a_refusal_counts_the_input_not_the_filtered_remainder():
    """ND-4: five bars whose closes are all NULL reported `0 bars`, identical
    to a genuinely empty panel. The count must describe what arrived."""
    _facts("TGT")
    bars = [{"date": f"2025-03-{i:02d}", "close": None, "volume": 5} for i in range(1, 6)]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)
    reason = panel["rows"]["drawdown"]["reason"]
    assert "5" in reason, f"reason must name the 5 bars that arrived: {reason}"
    assert reason != "insufficient_history: 0 bars"


def test_a_zero_baseline_names_the_baseline_not_history_as_the_cause():
    """N-1: `volume_ratio`'s length guard can never trip on the fallback call
    -- `fallback_baseline` is always `len(volumes)`, so `len(volumes) <
    fallback_baseline` is never true. The one remaining way the fallback call
    still returns None is `baseline_mean <= 0`: every stored volume is zero.
    `insufficient_history` blamed a shortage of data that was never short --
    the window fit comfortably inside 5 bars; the baseline was just flat."""
    _facts("TGT")
    bars = [{"date": f"2025-04-{i:02d}", "close": 10.0, "volume": 0} for i in range(1, 6)]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: bars)
    volume = panel["rows"]["volume"]
    assert volume["value"] is None
    assert volume["reason"] == "zero_volume: baseline mean 0 over 5 bars"
    assert volume["source"] == "own bars: 2/5 bars"


def test_an_empty_panel_names_no_bars_stored_not_no_volume():
    """N-3: with `bars == []`, the previous phrasing (`no_volume: 0 of 0 bars
    have volume`) asserted the bars carried no volume when no bars arrived at
    all, and its `source` was just the reason string with an `own bars:`
    prefix -- zero real provenance. The empty case needs its own reason and a
    source that actually describes the absence, distinguishable from the
    genuine "bars arrived, none carried volume" case covered above."""
    _facts("TGT")
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: [])
    volume = panel["rows"]["volume"]
    assert volume["value"] is None
    assert volume["reason"] == "insufficient_history: 0 of 0 bars usable"
    assert volume["source"] == "own bars: none stored"
