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
    # The plain -25% shape `_SERIES` was built to produce (ND-F): the peer set
    # is drawn from the same series, so the window's own peak is the global
    # peak and this pins the exact value rather than merely "not None".
    assert panel["rows"]["drawdown"]["value"] == pytest.approx(_SERIES_DRAWDOWN)


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


def test_a_deep_drawdown_outside_the_window_is_still_disclosed():
    """ND-A: the 252-bar window keeps the subject comparable to its peers, but
    it also silently truncates the subject's OWN published number. A stock
    down 90% whose peak sits outside the window would otherwise publish `0.0`
    -- "at its peak, in line with peers" -- with the discarded history
    invisible. `source` must name the subject's own window and, since the
    true peak sits outside it here, the full-history drawdown too."""
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)

    def subject_bars():
        # Peak of 1000.0 at bar 10 of 600, flat at 100.0 for every bar after
        # -- a -90% full-history drawdown that the 252-bar window (the last
        # 252 of the 600, all flat) cannot see: within the window alone the
        # series never moves, so a naive read is "at its peak".
        closes = [100.0] * 10 + [1000.0] + [100.0] * 589
        return [{"date": _date(i), "close": c, "volume": 100} for i, c in enumerate(closes)]

    def peer_bars():
        # Flat throughout, so each peer's own 252-bar drawdown is exactly
        # 0.0% and the peer mean is unambiguous.
        return [{"date": _date(i), "close": 100.0, "volume": 100} for i in range(260)]

    def loader(ticker, limit=None):
        return subject_bars() if ticker == "TGT" else peer_bars()

    panel = build_verdict("TGT", bars_loader=loader)
    drawdown = panel["rows"]["drawdown"]
    assert drawdown["reason"] is None
    assert drawdown["value"] == pytest.approx(0.0)
    assert drawdown["comparison"] == "peer mean 0.0%"
    assert "own window: last 252 of 600 bars" in drawdown["source"]
    assert "full-history drawdown -90.0%" in drawdown["source"]
    assert "peak outside window" in drawdown["source"]
    assert "peers: 3 of 3 over 252 bars" in drawdown["source"]


def test_the_drawdown_source_names_a_window_not_usable_bars_when_full():
    """ND-B: `own bars: N of M bars usable` reported bars as unusable that
    were merely outside the 252-bar window (348 raw bars, 0 NULL closes ->
    `252 of 300 bars usable`, falsely implying 48 were bad). "usable" is
    reserved for NULL-filtering everywhere else in this panel (dcf_gap,
    volume); a full window must describe itself as a window instead."""
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
    _bars("TGT", _SERIES)  # 260 bars, no NULLs -- the window truncates 8 of them
    panel = build_verdict("TGT")
    source = panel["rows"]["drawdown"]["source"]
    assert "usable" not in source
    assert "own window: last 252 of 260 bars" in source


def test_the_pe_row_names_the_real_contributor_count():
    """ND-C: `resolve_benchmark` averages each column independently and keeps
    any column with >= 3 surviving contributors, so a `trailing_pe` average
    resting on 3 of the top-5-by-ROC basket is normal. Naming only the basket
    size ("top-5-by-ROC sector basket") claims all 5 fed the average when the
    real count -- held in `.industries` -- may be fewer."""
    import dataclasses

    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    # Ranked by after_tax_roc, the top 5 are: Computers/Peripherals, Software
    # (System & Application), Semiconductor Equip, Semiconductor, Computer
    # Services. Only 3 of them get a trailing_pe here.
    pe_by_name = {
        "Computers/Peripherals": 20.0,
        "Semiconductor Equip": 25.0,
        "Computer Services": 30.0,
    }
    rows = [
        dataclasses.replace(row, values={**row.values, "trailing_pe": pe_by_name.get(row.name)})
        for row in TECHNOLOGY_ROWS
    ]
    store_vintage("2026-01-01", rows)
    _facts("TGT")
    _bars("TGT", _SERIES)

    panel = build_verdict("TGT")
    pe = panel["rows"]["trailing_pe"]
    assert pe["comparison"] == "sector avg 25.0"
    assert "3 of 5 industries" in pe["source"]


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


def test_a_refusal_names_what_arrived_not_just_the_filtered_remainder():
    """ND-D: `insufficient_history: 0 of 252 bars needed for the drawdown
    window` was IDENTICAL whether zero bars were stored or five arrived and
    every close was NULL -- the only "5" in that string was the one inside
    "252", so a substring check on "5" passed by coincidence. The reason must
    actually distinguish "nothing arrived" from "something arrived, all
    unusable"."""
    _facts("TGT")
    empty_reason = build_verdict(
        "TGT", bars_loader=lambda t, limit=None: []
    )["rows"]["drawdown"]["reason"]
    null_bars = [{"date": f"2025-03-{i:02d}", "close": None, "volume": 5} for i in range(1, 6)]
    null_reason = build_verdict(
        "TGT", bars_loader=lambda t, limit=None: null_bars
    )["rows"]["drawdown"]["reason"]
    assert empty_reason != null_reason
    assert "0 bars stored" in empty_reason
    assert "5 bars stored" in null_reason


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


def test_a_non_positive_peak_over_a_full_window_does_not_raise():
    """The per-signal invariant on the branch that most needed its source.

    `_own_window_source` names the full-history drawdown when the window
    truncates, but `drawdown_from_peak` refuses a non-positive peak as well as
    an empty series -- so on THIS branch the full-history figure does not
    exist. Unpacking it unconditionally raised straight out of `build_verdict`,
    destroying every row and the direction statement, and no test covered it
    because it needs more than 252 bars AND a non-positive peak.
    """
    _facts("TGT")
    bars = [(_date(i), -5.0, 10) for i in range(300)]
    panel = build_verdict("TGT", bars_loader=lambda t, limit=None: [
        {"date": d, "close": c, "volume": v} for d, c, v in bars
    ])
    drawdown = panel["rows"]["drawdown"]
    assert drawdown["reason"] == "non_positive_peak: -5.0"
    assert drawdown["source"] == "own window: last 252 of 300 bars"
    # The whole panel survived, which is the point.
    assert set(panel["rows"]) == {"drawdown", "volume", "trailing_pe", "dcf_gap"}
    assert panel["direction"]


def test_a_tied_early_peak_is_not_reported_as_discarded():
    """ND-8: the disclosure was gated on the peak's FIRST index, and
    `drawdown_from_peak` reports the earliest bar attaining the max. So any
    series whose high is merely TIED early -- a perfectly flat one above all --
    claimed its peak had been discarded when an identical peak sat inside the
    window and the two figures were byte-identical. The gate is the fact
    (`max(closes) > max(window)`), not a proxy for it.
    """
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, [(_date(i), 100.0, 10) for i in range(260)])
    source = build_verdict("TGT")["rows"]["drawdown"]["source"]
    assert "peak outside window" not in source
    assert "own window: last 252 of 260 bars" in source


def test_a_null_sparse_window_names_its_dropped_bars_and_real_span():
    """ND-9/ND-10: 252 kept closes out of 600 stored bars read as
    `252 of 252 bars` -- "nothing discarded" -- and claimed a `252 bars` basis
    shared with peers while actually spanning twice their calendar time. The
    volume row already states its span for exactly this reason.
    """
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
    _bars("TGT", [(_date(i), (None if i % 2 else 100.0), 10) for i in range(600)])
    for t in ("P1", "P2", "P3"):
        _bars(t, [(_date(i), 100.0, 10) for i in range(300)])
    source = build_verdict("TGT")["rows"]["drawdown"]["source"]
    assert "300 of 600 stored bars have a close" in source
    assert "spans" in source
    # "usable" stays reserved for NULL-filtering on the sibling rows.
    assert "usable" not in source


def test_no_source_string_ever_claims_more_bars_than_its_span_can_hold():
    """A PROPERTY over the assembled sentence, not a case.

    `_own_window_source` concatenates four independently-gated clauses, and
    every one of the nine defects in this module's history was an interaction
    between clauses that were each individually true. Nothing asserted anything
    about the assembled string, so a span attached to the wrong noun shipped:
    `550 of 800 stored bars have a close (spans ... )` over 500 calendar days,
    which 550 daily bars cannot cover.

    This checks the invariant that catches that whole sub-class: any bar count
    the sentence names must fit inside any span it states.
    """
    import datetime as dt
    import re

    _facts("TGT")
    for peer in ("P1", "P2", "P3"):
        _facts(peer)

    def bars_for(n, null_from=None, step=2):
        return [
            {
                "date": _date(i),
                "close": (None if null_from is not None and i >= null_from and i % step else 100.0),
                "volume": 10,
            }
            for i in range(n)
        ]

    shapes = [
        (900, 300, 2), (800, 300, 2), (600, 0, 2), (600, 400, 3),
        (400, 100, 2), (300, None, 2), (260, 250, 2), (700, 1, 4),
    ]
    for total, null_from, step in shapes:
        subject = bars_for(total, null_from, step)
        panel = build_verdict(
            "TGT",
            bars_loader=lambda t, limit=None, s=subject: s if t == "TGT" else bars_for(300),
        )
        source = panel["rows"]["drawdown"]["source"]
        span = re.search(r"spans (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})", source)
        if span is None:
            continue
        days = (dt.date.fromisoformat(span.group(2)) - dt.date.fromisoformat(span.group(1))).days + 1
        # The count a reader attaches a span to is the one immediately before
        # it. That is precisely what went wrong: the span described the window
        # but sat after the stored-bars clause, so the sentence read as 550
        # bars across 500 days.
        preceding = re.findall(r"(\d+) of \d+ (?:stored )?bars", source[: span.start()])
        assert preceding, f"a span with no count before it: {source!r}"
        count = int(preceding[-1])
        assert count <= days, (
            f"the count immediately before the span claims {count} bars inside "
            f"a {days}-day span: {source!r}"
        )
