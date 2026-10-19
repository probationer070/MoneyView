"""Acceptance of the risk engine on a fixed fixture (tests/fixtures/risk, from the research cache).

The research pick (report3.md, X4 Y2 K3 cap20 Q=5 W6 off) opens an alert on 2026-10-08 with all five
semis themes and has nothing up on 2026-10-01/02.
"""
from datetime import date
from functools import lru_cache
from pathlib import Path

import pandas as pd

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.evaluate import evaluate_range

RULES = load_rules().rules
FIX = Path(__file__).resolve().parents[1] / "fixtures" / "risk"
START, END = date(2026, 6, 1), date(2026, 10, 16)
OPEN_DAY = date(2026, 10, 8)
QUIET = (date(2026, 10, 1), date(2026, 10, 2))


@lru_cache(maxsize=1)
def _inputs():
    px = pd.read_csv(FIX / "closes.csv", index_col="date", parse_dates=True)
    sox, rsp = px.pop("^SOX"), px.pop("RSP")
    shares = pd.read_csv(FIX / "shares.csv").set_index("ticker")["shares"].to_dict()
    themes = pd.read_csv(FIX / "themes.csv").set_index("ticker")["theme"].to_dict()
    fred = {
        f.stem: pd.read_csv(f, index_col="date", parse_dates=True)["value"]
        for f in sorted((FIX / "fred").glob("*.csv"))
    }
    return px, sox, rsp, shares, themes, fred


@lru_cache(maxsize=1)
def _batch():
    px, sox, rsp, shares, themes, fred = _inputs()
    return evaluate_range(px, sox, rsp, shares, themes, fred, RULES, start=START, end=END)


def _day(res, d):
    return next(r for r in res.days if r.day == d)


def _alerts(res):
    out = [(a.start, a.release) for a in res.closed]
    if res.open is not None:
        out.append((res.open.start, None))
    return out


def test_alert_opens_2026_10_08():
    res = _batch()
    assert _day(res, OPEN_DAY).opened is True
    assert res.open is not None and res.open.start == OPEN_DAY
    assert set(RULES.semis_themes) <= set(res.open.trigger)


def test_nothing_up_on_10_01_and_10_02():
    res = _batch()
    for d in QUIET:
        assert _day(res, d).opened is False
        for start, release in _alerts(res):
            assert not (start <= d and (release is None or release >= d)), (d, start, release)


def test_warnings_on_10_08():
    w = _day(_batch(), OPEN_DAY).warnings
    assert {k: v[0] for k, v in w.items()} == {
        "W1": "on", "W2": "on", "W3": "on", "W4": "on", "W5": "off", "W7": "off",
    }


def test_day_by_day_equals_batch():
    px, sox, rsp, shares, themes, fred = _inputs()
    batch = _batch()
    closed, state, confirming = [], None, {}
    for d in [r.day for r in batch.days]:
        ts = pd.Timestamp(d)
        res = evaluate_range(
            px.loc[:ts], sox.loc[:ts], rsp.loc[:ts], shares, themes,
            {k: v.loc[:ts] for k, v in fred.items()}, RULES, start=d, end=d, state=state,
        )
        assert [r.day for r in res.days] == [d]
        confirming[d] = res.days[0].confirming
        closed += res.closed
        state = res.open
    assert closed == batch.closed
    assert state == batch.open
    assert confirming == {r.day: r.confirming for r in batch.days}
    assert any(confirming.values())  # the walk saw confirmations, so the equality is not vacuous


CLOSE_START = date(2026, 3, 2)  # a full window that holds the 2026-03-27 alert's release on 2026-04-07


def test_day_by_day_equals_batch_through_a_close():
    """The walk above never closes an alert. This one does (2026-03-27 open, 2026-04-07 release), and
    compares closed alerts (release, reason and stints), the open alert, and every day's warnings,
    on_count and confirming. Catches a live continuation that loses stint state across days (e.g.
    last_ref reset to joined), closes on a different day, or computes warnings from untruncated inputs."""
    px, sox, rsp, shares, themes, fred = _inputs()
    batch = evaluate_range(px, sox, rsp, shares, themes, fred, RULES, start=CLOSE_START, end=END)
    closed, state, per_day = [], None, {}
    for d in [r.day for r in batch.days]:
        ts = pd.Timestamp(d)
        res = evaluate_range(
            px.loc[:ts], sox.loc[:ts], rsp.loc[:ts], shares, themes,
            {k: v.loc[:ts] for k, v in fred.items()}, RULES, start=d, end=d, state=state,
        )
        [day] = res.days
        per_day[d] = (day.warnings, day.on_count, day.confirming)
        closed += res.closed
        state = res.open
    assert [(a.start, a.release) for a in batch.closed] == [(date(2026, 3, 27), date(2026, 4, 7))]
    assert closed == batch.closed
    assert state == batch.open
    assert per_day == {r.day: (r.warnings, r.on_count, r.confirming) for r in batch.days}
    assert any(v[1] for v in per_day.values())  # warnings were on somewhere, so on_count is compared
