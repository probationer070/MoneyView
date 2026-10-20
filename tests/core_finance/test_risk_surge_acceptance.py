"""Acceptance of surge and movers in evaluate_range on the long fixture (tests/fixtures/risk_long).

Expected starts come from docs/superpowers/specs/2026-10-19-surge-signal-evidence/report_surge_pick4.md
("2026 semis"): ^SOX 2026-04-08 (shown); chip_equipment_design 2026-01-06, 2026-04-10 (shown),
2026-06-15; no semis start in Sep/Oct 2026.
"""
import math
from dataclasses import astuple
from datetime import date
from functools import lru_cache

import pandas as pd

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.evaluate import evaluate_range
from packages.core_finance.risk_signals.surge import SOX
from tests.core_finance._fixture import load_long

RULES = load_rules().rules
CHIP = "chip_equipment_design"


@lru_cache(maxsize=1)
def _batch():
    px, sox, rsp, shares, themes, fred = load_long()
    return evaluate_range(px, sox, rsp, shares, themes, fred, RULES,
                          start=px.index[0].date(), end=px.index[-1].date())


def _starts(res, series, year=2026):
    return [(d.day, d.surge_shown.get(series)) for d in res.days
            if d.day.year == year and series in d.surge_started]


def test_no_semis_surge_around_2026_10_08():
    days = [d for d in _batch().days if date(2026, 10, 1) <= d.day <= date(2026, 10, 16)]
    assert len(days) == 12
    watched = set(RULES.semis_themes) | {SOX}
    assert len(watched) == 6
    assert all(not (watched & set(d.surge_started)) for d in days)
    # starts are reported in this window (power_producers, evidence), so the check above is not vacuous
    assert any(d.surge_started == ["power_producers"] for d in days if d.day == date(2026, 10, 6))


def test_april_2026_starts_match_evidence():
    res = _batch()
    assert _starts(res, SOX) == [(date(2026, 4, 8), True)]
    assert _starts(res, CHIP) == [
        (date(2026, 1, 6), False), (date(2026, 4, 10), True), (date(2026, 6, 15), False),
    ]
    # the same events, closed, with the evidence's end dates
    ends = {(e.theme, e.start): e.end for e in res.surge_closed}
    assert ends[(SOX, date(2026, 4, 8))] == date(2026, 5, 18)
    assert ends[(CHIP, date(2026, 4, 10))] == date(2026, 4, 28)


# Window holds the ^SOX event (2026-04-08..05-18) and chip_equipment_design's (2026-04-10..04-28).
DBD_START, DBD_END = date(2026, 4, 6), date(2026, 5, 20)


def _cut(ts, px, sox, rsp, fred):
    return px.loc[:ts], sox.loc[:ts], rsp.loc[:ts], {k: v.loc[:ts] for k, v in fred.items()}


def _surge_view(d):
    return (d.surge, d.surge_banner, d.surge_cap_share, d.surge_started, d.surge_shown,
            [astuple(m) for m in d.movers])


def _same(a, b):
    """Spec §5 equality: flags, names and dates exact; numbers within relative 1e-9."""
    if isinstance(a, float) and isinstance(b, float):
        return math.isclose(a, b, rel_tol=1e-9, abs_tol=0.0)
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return type(a) is type(b) and len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return type(a) is type(b) and a == b


def test_surge_day_by_day_equals_batch():
    px, sox, rsp, shares, themes, fred = load_long()
    before = px.index[px.index < pd.Timestamp(DBD_START)][-1]
    p, s, r, f = _cut(before, px, sox, rsp, fred)
    prior = evaluate_range(p, s, r, shares, themes, f, RULES, start=px.index[0].date(), end=before.date())
    batch = evaluate_range(px, sox, rsp, shares, themes, fred, RULES, start=DBD_START, end=DBD_END,
                           state=prior.open, surge_state=prior.surge_state)
    assert 30 <= len(batch.days) <= 40

    closed, state, surge_state, per_day = [], prior.open, prior.surge_state, {}
    for d in [r.day for r in batch.days]:
        p, s, r, f = _cut(pd.Timestamp(d), px, sox, rsp, fred)
        res = evaluate_range(p, s, r, shares, themes, f, RULES, start=d, end=d,
                             state=state, surge_state=surge_state)
        [day] = res.days
        per_day[d] = _surge_view(day)
        closed += res.surge_closed
        state, surge_state = res.open, res.surge_state

    want = {r.day: _surge_view(r) for r in batch.days}
    assert per_day.keys() == want.keys()
    assert [d for d in want if not _same(per_day[d], want[d])] == []
    assert closed == batch.surge_closed
    assert surge_state == batch.surge_state
    # not vacuous: the window starts and ends events, shows the banner, and has movers every day
    assert any(v[3] for v in per_day.values()) and len(closed) >= 2
    assert {(e.theme, e.start, e.end) for e in closed} >= {
        (SOX, date(2026, 4, 8), date(2026, 5, 18)), (CHIP, date(2026, 4, 10), date(2026, 4, 28)),
    }
    assert any(v[1] for v in per_day.values()) and not all(v[1] for v in per_day.values())
    assert all(len(v[5]) == RULES.movers.count for v in per_day.values())
    assert all(v[0] for v in per_day.values())


def test_crash_results_unchanged():
    """Crash fields on the long fixture, pinned from bbf6cbd (before surge was wired in). The short
    fixture's crash acceptance lives, unchanged, in test_risk_acceptance.py."""
    res = _batch()
    assert [(a.start, a.release, a.reason) for a in res.closed] == [
        (date(2023, 2, 17), date(2023, 7, 14), "all_themes_out"),
        (date(2023, 7, 27), date(2023, 8, 25), "all_themes_out"),
        (date(2026, 2, 6), date(2026, 2, 23), "all_themes_out"),
        (date(2026, 3, 27), date(2026, 4, 7), "all_themes_out"),
    ]
    assert res.open is not None and res.open.start == date(2026, 10, 8) and len(res.open.stints) == 16
    assert len(res.days) == 951
    assert sum(d.opened for d in res.days) == 5
    assert sum(len(d.confirming) for d in res.days) == 408
    assert sum(d.on_count for d in res.days) == 1139
