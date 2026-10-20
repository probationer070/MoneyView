"""Surge event lifecycle and banner gate (spec §3.2-§3.3)."""
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.indices import theme_cap_share, theme_indices
from packages.core_finance.risk_signals.surge import (
    SOX,
    SurgeComponents,
    run_surge,
    surge_components,
)
from tests.core_finance._fixture import load_long

RULES = load_rules().rules
EV = RULES.surge.event
PICK4 = (
    Path(__file__).resolve().parents[2]
    / "docs/superpowers/specs/2026-10-19-surge-signal-evidence/report_surge_pick4.md"
)


def _case(n, cols, caps=None):
    """Blank inputs: level 100 above EMA 99, nothing on. Tests set the cells they need."""
    idx = pd.bdate_range("2021-01-04", periods=n)
    zeros = pd.DataFrame(0.0, index=idx, columns=cols)
    false = pd.DataFrame(False, index=idx, columns=cols)
    c = {f: zeros.copy() if f in ("magnitude_z", "accel_pct", "accel_rank", "breadth_pct", "rsi") else false.copy()
         for f in SurgeComponents.__dataclass_fields__}
    c["ema"] = pd.DataFrame(99.0, index=idx, columns=cols)
    levels = pd.DataFrame(100.0, index=idx, columns=cols)
    cap = pd.DataFrame({t: (caps or {}).get(t, 0.0) for t in cols if t != SOX}, index=idx)
    return idx, c, levels, cap


def _go(idx, c, levels, cap, state=None, dates=None):
    return run_surge(list(idx.date) if dates is None else dates, SurgeComponents(**c), levels, cap, RULES, state)


def _d(idx, i):
    return idx[i].date()


def test_event_starts_after_gap():
    idx, c, lv, cap = _case(30, ["t1"])
    for i in (0, EV.gap, 2 * EV.gap + 1):  # rows 0, 10, 21
        c["on"].iloc[i, 0] = True
    lv.iloc[2, 0] = 98.0  # ends the first event below EMA
    closed, state, _ = _go(idx, c, lv, cap)
    assert [(e.start, e.end) for e in closed] == [(_d(idx, 0), _d(idx, 2))]
    # row 10 is exactly gap rows after row 0: no start; row 21 is gap+1 after row 10: start
    assert state.open["t1"].start == _d(idx, 2 * EV.gap + 1)
    assert state.last_confirm["t1"] == _d(idx, 2 * EV.gap + 1)


def test_confirmations_inside_event_push_gap():
    idx, c, lv, cap = _case(30, ["t1"])
    c["on"].iloc[0:6, 0] = True  # starts row 0, confirms again on rows 1..5
    lv.iloc[8, 0] = 98.0
    c["on"].iloc[12, 0] = True  # 7 rows after row 5: no start, but it confirms
    c["on"].iloc[23, 0] = True  # 11 rows after row 12: start
    closed, state, _ = _go(idx, c, lv, cap)
    assert [(e.start, e.end) for e in closed] == [(_d(idx, 0), _d(idx, 8))]
    assert state.open["t1"].start == _d(idx, 23)


def test_end_below_ema():
    idx, c, lv, cap = _case(20, ["t1"])
    c["on"].iloc[0, 0] = True
    c["high_new"].iloc[:, 0] = True
    lv.iloc[3, 0] = 99.0  # equal to EMA: not below
    lv.iloc[5, 0] = 98.9
    closed, state, _ = _go(idx, c, lv, cap)
    (e,) = closed
    assert (e.start, e.end, e.end_reason, e.last_high) == (_d(idx, 0), _d(idx, 5), "below_ema", _d(idx, 5))
    assert state.open == {}


def test_end_stalled_counts_from_start():
    idx, c, lv, cap = _case(30, ["t1", "t2"])
    c["on"].iloc[0, :] = True  # neither start day is a 20-row high
    c["high_new"].iloc[3, 1] = True
    closed, state, _ = _go(idx, c, lv, cap)
    got = {e.theme: (e.end, e.end_reason, e.last_high) for e in closed}
    assert got == {
        "t1": (_d(idx, EV.stall), "stalled", _d(idx, 0)),
        "t2": (_d(idx, 3 + EV.stall), "stalled", _d(idx, 3)),
    }


def test_end_then_start_same_day():
    idx, c, lv, cap = _case(20, ["t1"])
    c["on"].iloc[0, 0] = True
    c["high_new"].iloc[5, 0] = True  # keeps the event alive past row 10
    day = EV.gap + 1
    lv.iloc[day, 0] = 98.0
    c["on"].iloc[day, 0] = True
    closed, state, days = _go(idx, c, lv, cap)
    assert [(e.start, e.end, e.end_reason) for e in closed] == [(_d(idx, 0), _d(idx, day), "below_ema")]
    assert state.open["t1"].start == _d(idx, day)
    assert days[_d(idx, day)].started == ["t1"]


def test_banner_includes_end_day():
    idx, c, lv, cap = _case(20, ["a", "b"], caps={"a": 0.15, "b": 0.10})
    c["on"].iloc[0, 0] = True
    c["high_new"].iloc[:, :] = True
    lv.iloc[5, 0] = 98.0  # a ends on row 5
    c["on"].iloc[5, 1] = True  # b starts on row 5
    _, _, days = _go(idx, c, lv, cap)
    assert [days[_d(idx, i)].banner for i in range(7)] == [False] * 5 + [True, False]
    d5 = days[_d(idx, 5)]
    assert d5.in_event == ["a", "b"]
    assert d5.cap_share == pytest.approx(0.25)
    assert d5.started == ["b"]  # b's start day has the banner up: b is shown
    assert days[_d(idx, 6)].in_event == ["b"]


def test_sox_event_always_shown():
    idx, c, lv, cap = _case(10, ["t1", SOX], caps={"t1": 0.01})
    c["on"].iloc[2, :] = True
    c["high_new"].iloc[:, :] = True
    _, state, days = _go(idx, c, lv, cap)
    d = days[_d(idx, 2)]
    assert (d.banner, d.started, d.cap_share) == (True, ["t1", SOX], pytest.approx(0.01))
    assert not days[_d(idx, 1)].banner
    assert state.open[SOX].start == _d(idx, 2)


def test_overheated_on_first_day_over_80():
    idx, c, lv, cap = _case(20, ["t1"])
    c["on"].iloc[2, 0] = True
    c["high_new"].iloc[:, 0] = True
    for i in (1, 4, 6, 9):  # row 1 is before the start, row 9 after the end
        c["overheated"].iloc[i, 0] = True
    lv.iloc[7, 0] = 98.0
    closed, _, _ = _go(idx, c, lv, cap)
    (e,) = closed
    assert (e.end, e.overheated_on) == (_d(idx, 7), _d(idx, 4))


def _random_case(seed=7, n=160):
    cols = ["a", "b", "c", SOX]
    idx, c, lv, cap = _case(n, cols, caps={"a": 0.12, "b": 0.09, "c": 0.05})
    rng = np.random.default_rng(seed)
    c["on"] = pd.DataFrame(rng.random((n, 4)) < 0.08, index=idx, columns=cols)
    c["high_new"] = pd.DataFrame(rng.random((n, 4)) < 0.25, index=idx, columns=cols)
    c["overheated"] = pd.DataFrame(rng.random((n, 4)) < 0.1, index=idx, columns=cols)
    lv = lv - 1.5 * (rng.random((n, 4)) < 0.08)
    return idx, c, lv, cap


def test_state_carry_one_day_equals_batch():
    idx, c, lv, cap = _random_case()
    start = 40  # the one-day calls begin mid-range, carrying the batch state from before
    closed_b, state_b, days_b = _go(idx, c, lv, cap)
    head, state, _ = _go(idx, c, lv, cap, dates=list(idx.date[:start]))
    closed, days = list(head), {}
    for d in idx.date[start:]:
        cl, state, dd = _go(idx, c, lv, cap, state=state, dates=[d])
        closed += cl
        days.update(dd)
    assert closed == closed_b
    assert state == state_b
    assert days == {d: v for d, v in days_b.items() if d >= idx[start].date()}
    reasons = {e.end_reason for e in closed_b}
    assert len(closed_b) >= 5 and reasons == {"below_ema", "stalled"}
    assert any(v.banner for v in days_b.values()) and not all(v.banner for v in days_b.values())


def _pick4_events():
    reasons = {"ema_break": "below_ema", "quiet10": "stalled"}
    rows = []
    for line in PICK4.read_text(encoding="utf-8").splitlines():
        cells = [x.strip() for x in line.strip("|").split("|")]
        if len(cells) == 9 and cells[1][:2] == "20" and cells[3] in reasons:
            rows.append((cells[0], cells[1], cells[2], reasons[cells[3]], cells[4] == "yes"))
    return rows


# The fixture starts 2023-01-03, so the 250-row accel window and the 20-row high are warm-up
# early on; the cut is row 400 of the fixture (the live window, surge.live_window_rows).
# Over the whole fixture the only differences are evidence events starting before 2023-06-07 and
# three warm-up-only starts (gold_silver 2023-07-13, ai_servers_network 2023-09-01,
# chip_equipment_design 2023-11-03); 58 events (17 shown) start from the cut on.
CUT = "2024-08-07"


def test_long_fixture_events_match_evidence():
    px, sox, _rsp, shares, themes, _fred = load_long()
    levels = theme_indices(px, shares, themes, RULES.min_members)
    comps = surge_components(levels, px, shares, themes, sox, RULES)
    cap = theme_cap_share(px, shares, themes)
    closed, state, days = run_surge(list(levels.index.date), comps, levels.assign(**{SOX: sox}), cap, RULES)
    assert state.open == {}  # the evidence list has no event still open on 2026-10-16
    got = sorted(
        (e.theme, str(e.start), str(e.end), e.end_reason, days[e.start].banner)
        for e in closed
        if str(e.start) >= CUT
    )
    want = sorted(r for r in _pick4_events() if r[1] >= CUT)
    assert len(want) == 58 and sum(r[4] for r in want) == 17
    assert got == want


def test_banner_treats_missing_cap_share_as_zero():
    idx, c, lv, cap = _case(5, ["a", "b"], caps={"a": 0.25, "b": 0.10})
    c["on"].iloc[1, :] = True
    c["high_new"].iloc[:, :] = True
    cap.iloc[1, 1] = np.nan  # b has no cap share that day; a alone holds 25%
    _, _, days = _go(idx, c, lv, cap)
    d = days[_d(idx, 1)]
    assert (d.banner, d.cap_share) == (True, pytest.approx(0.25))
