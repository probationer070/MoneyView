"""Trailing live window (surge spec section 5) and surge continuation from the store, on the long
fixture seeded into the test DB. Each docstring names the mutation its test catches. A live run must
equal one full-history evaluate_range: flags, dates and events exactly, numbers to rel 1e-9."""
from __future__ import annotations

import math
from datetime import UTC, date, datetime

import pandas as pd
import pytest

from apps.api.services.db import get_db
from apps.api.services.risk import evaluator, store, sweep
from apps.api.services.risk.inputs import load_inputs
from apps.api.services.risk.rules import LoadedRules, get_rules
from packages.core_finance.risk_signals.evaluate import evaluate_range
from packages.core_finance.risk_signals.indices import theme_indices
from tests.core_finance._fixture import load_long

NOW = datetime(2026, 10, 19, 1, 0, tzinfo=UTC)
V = "long0001"
EVAL_START = date(2026, 6, 1)
REL = 1e-9


@pytest.fixture(autouse=True)
def _no_sweeps(monkeypatch):
    monkeypatch.setattr(sweep, "ensure_deep_history", lambda tickers, **kw: sweep.SweepReport())
    monkeypatch.setattr(sweep, "ensure_quote_facts", lambda tickers, now, **kw: sweep.SweepReport())


def _seed(px: pd.DataFrame) -> None:
    _, sox, rsp, shares, themes, fred = load_long()
    wide = px.assign(**{"^SOX": sox, "RSP": rsp})
    long = wide.stack().reset_index()
    long.columns = ["date", "ticker", "close"]
    bars = list(zip(long["ticker"], long["date"].dt.strftime("%Y-%m-%d"), long["close"].astype(float)))
    with get_db() as conn:
        conn.executemany("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, ?)", bars)
        conn.executemany(
            "INSERT INTO corporate_quote_facts (ticker, shares_outstanding, fetched_at) VALUES (?, ?, 'fixture')",
            [(t, float(v)) for t, v in shares.items()])
        conn.executemany(
            "INSERT INTO watchlist (ticker, name, theme, group_name, weight) VALUES (?, ?, ?, 'custom', 0.0)",
            [(t, t, th) for t, th in themes.items()])
        for sid, series in fred.items():
            conn.executemany(
                "INSERT INTO fred_cache (series_id, obs_date, value, fetched_at) VALUES (?, ?, ?, 'fixture')",
                [(sid, d.strftime("%Y-%m-%d"), float(v)) for d, v in series.dropna().items()])


def _loaded() -> LoadedRules:
    return LoadedRules(get_rules().rules.model_copy(update={"eval_start": EVAL_START}), V)


def _same(a, b, path="") -> None:
    """Exact for flags, dates, strings and None; floats within rel 1e-9."""
    if isinstance(a, float) or isinstance(b, float):
        assert a is not None and b is not None and math.isclose(a, b, rel_tol=REL, abs_tol=0.0), (path, a, b)
    elif isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), (path, sorted(a), sorted(b))
        for k in a:
            _same(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b), (path, a, b)
        for i, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{path}[{i}]")
    else:
        assert a == b, (path, a, b)


def _run(px: pd.DataFrame, live_start: date, monkeypatch) -> tuple:
    """Backfill to live_start - 1, then live days to the end; return (inputs, rules, window lengths)."""
    _seed(px)
    L = _loaded()
    inp = load_inputs(fetch_fred=False, loaded=L)
    store.set_state(f"live_start:{V}", live_start.isoformat())
    evaluator.run_backfill(NOW, inputs=inp, loaded=L)
    assert store.get_state(f"backfill:{V}") == "done"
    rows: list[int] = []
    real = evaluator._evaluate

    def spy(inputs, rules, start, end, state=None, surge_state=None):
        rows.append(len(inputs.sox))
        return real(inputs, rules, start, end, state, surge_state)

    monkeypatch.setattr(evaluator, "_evaluate", spy)
    evaluator.evaluate_pending(NOW, inputs=inp, loaded=L)
    return inp, L, rows


def _assert_equals_full(inp, L, live_days: list[date]) -> None:
    batch = evaluate_range(inp.closes, inp.sox, inp.rsp, inp.shares, inp.themes, inp.fred, L.rules,
                           start=EVAL_START, end=live_days[-1])
    by_day = {d.day: d for d in batch.days}
    for day in live_days:
        want, got = by_day[day], store.get_day(V, day)
        assert got.origin == "live"
        _same(got.surge, want.surge, f"{day}.surge")
        assert got.surge_banner == want.surge_banner, day
        _same(got.surge_cap_share, want.surge_cap_share, f"{day}.surge_cap_share")
        assert (got.confirming, got.sox_confirming, got.on_count) == (want.confirming, want.sox_confirm,
                                                                      want.on_count), day
        _same(got.cap_share, want.cap_share, f"{day}.cap_share")
        _same({k: (s, v) for k, (s, v, _) in want.warnings.items()},
              {k: (w["state"], w["value"]) for k, w in got.warnings.items()}, f"{day}.warnings")
        movers = [(m.rank, m.ticker, m.return_pct, m.close, m.return5_pct, m.rsi)
                  for m in store.list_movers(V, day, day)]
        _same(movers, [(m.rank, m.ticker, m.return_pct, m.close, m.return5_pct, m.rsi) for m in want.movers],
              f"{day}.movers")
    events = [*batch.surge_closed, *batch.surge_state.open.values()]
    want_events = sorted((e.theme, e.start, e.end, e.end_reason, e.last_high, e.overheated_on,
                          by_day[e.start].surge_shown[e.theme]) for e in events)
    stored = store.list_surge(V, None, None, 500)
    assert sorted((e.theme, e.start_date, e.end_date, e.end_reason, e.last_high_date, e.overheated_on, e.shown)
                  for e in stored) == want_events
    for e in stored:
        _same(e.components, by_day[e.start_date].surge[e.theme], f"{e.theme}@{e.start_date}.components")
    assert store.last_confirms(V) == batch.surge_state.last_confirm
    alerts = [*batch.closed, *([batch.open] if batch.open else [])]
    assert sorted((a.start_date, a.release_date) for o in ("backfill", "live")
                  for a in store.list_alerts(V, o, 100)) == sorted(
        (a.start, getattr(a, "release", None)) for a in alerts)


def _tail(n: int) -> list[date]:
    return [ts.date() for ts in load_long()[1].index[-n:]]


def test_live_window_equals_full_history(monkeypatch):
    """The last 20 days evaluated live, each on a trailing window, equal one full-history pass.
    Catches a window too short for a 250-value quantile plus warm-up (half of live_window_rows), no
    trimming at all, open surge events not carried from the store, and live movers not stored.
    (A window 19 rows short of the rule still agrees to 1e-9: the margin is the warm-up decay.)"""
    days = _tail(20)
    inp, L, rows = _run(load_long()[0], days[0], monkeypatch)
    assert len(rows) == len(days) and max(rows) < len(inp.sox) - 400  # not vacuous: the window trims
    cal = inp.sox.index
    first = cal.get_loc(pd.Timestamp(days[0]))
    # Every theme has a level on each of the 400 rows to days[0] except big_tech: 26 rows of it have fewer
    # than min_members, so its 400th valid row (the binding bound) is 426 rows back, 2025-01-07.
    assert evaluator.live_window_start(inp, L.rules, days[0], None, []) == cal[first - 426].date() == date(2025, 1, 7)
    assert rows[0] == 427  # the first live day ran on exactly that window: 426 rows before it plus itself
    assert any(e.start_date >= days[0] for e in store.list_surge(V, None, None, 500))  # an event starts live
    _assert_equals_full(inp, L, days)


def test_live_continues_open_surge_from_store(monkeypatch):
    """Review Focus 2. power_producers' event starts 2026-10-06 in the backfill and ends 2026-10-14 live.
    Catches live days that do not rebuild the open event from the store (it stays open forever or a
    second event starts), or that restart it from its start instead of its stored last_high."""
    live_start = date(2026, 10, 8)
    inp, L, _ = _run(load_long()[0], live_start, monkeypatch)
    [event] = [e for e in store.list_surge(V, None, None, 500) if e.theme == "power_producers"
               and e.start_date == date(2026, 10, 6)]
    assert (event.origin, event.end_date, event.end_reason) == ("backfill", date(2026, 10, 14), "below_ema")
    assert not [e for e in store.list_surge(V, None, None, 500) if e.origin == "live" and
                e.theme == "power_producers" and e.start_date <= date(2026, 10, 14)]
    _assert_equals_full(inp, L, [d for d in _tail(10) if d >= live_start])


def test_live_window_with_member_gap_theme(monkeypatch):
    """Review Focus 1. One theme drops below min_members for 150 rows starting 300 rows back, so its
    400 valid rows reach back past 400 calendar rows. Catches live_window_start counting calendar rows
    (or rows of any theme) instead of each theme's own valid index rows: the gap theme's accel quantile
    then runs on a window without its warm-up and the live day differs from the full pass."""
    px, _, _, shares, themes, _ = load_long()
    px = px.copy()
    theme = "nuclear_uranium"
    members = sorted(t for t in px.columns if themes.get(t) == theme and t in shares)
    assert len(members) >= 4
    n = len(px)
    px.iloc[n - 300 : n - 150, [px.columns.get_loc(t) for t in members[2:]]] = float("nan")
    days = _tail(5)
    inp, L, rows = _run(px, days[0], monkeypatch)
    cal = inp.sox.index
    start = evaluator.live_window_start(inp, L.rules, days[0], None, [])
    levels = theme_indices(inp.closes.reindex(cal), inp.shares, inp.themes, L.rules.min_members)
    assert start == levels[theme].loc[: pd.Timestamp(days[0])].dropna().index[-400].date()
    assert start < cal[-(400 + 5)].date()  # the gap theme is the binding one
    assert max(rows) < len(inp.sox)  # still trimmed
    _assert_equals_full(inp, L, days)


def test_load_inputs_since_trims_bars_not_fred():
    """Catches `since` ignored, FRED trimmed, or a ticker with no bar since then dropped from the
    columns (it would change the coverage denominator against a full load)."""
    with get_db() as conn:
        conn.executemany("INSERT INTO watchlist (ticker, name, theme) VALUES (?, ?, ?)",
                         [("NVDA", "n", "ai_semis"), ("OLD", "o", "ai_semis")])
        conn.executemany("INSERT INTO stocks (ticker, date, close) VALUES (?, ?, ?)", [
            ("NVDA", "2026-01-05", 1.0), ("NVDA", "2026-10-16", 2.0), ("OLD", "2026-01-05", 3.0),
            ("^SOX", "2026-01-05", 5.0), ("^SOX", "2026-10-16", 6.0), ("RSP", "2026-01-05", 7.0),
            ("RSP", "2026-10-16", 8.0)])
        conn.execute("INSERT INTO fred_cache (series_id, obs_date, value, fetched_at) "
                     "VALUES ('DGS10', '2026-01-05', 4.0, 'x')")
    full = load_inputs(fetch_fred=False)
    got = load_inputs(fetch_fred=False, since=date(2026, 6, 1))
    assert list(got.closes.columns) == list(full.closes.columns) == ["NVDA", "OLD"]
    assert list(got.closes.index) == list(got.sox.index) == list(got.rsp.index) == [pd.Timestamp("2026-10-16")]
    assert got.closes["OLD"].isna().all()
    assert list(got.fred["DGS10"].index) == [pd.Timestamp("2026-01-05")]


def test_sox_leaders_are_semis_members():
    """Catches ^SOX leaders drawn from no members or from all tickers instead of the union of the semis
    themes' members (the backfill fixture has no ^SOX event). 2026-04-08 is a ^SOX start."""
    px, sox, rsp, shares, themes, fred = load_long()
    inp = evaluator.RiskInputs(px, sox, rsp, shares, themes, {}, fred, [])
    rules = get_rules().rules
    day = date(2026, 4, 8)
    cal = sox.index
    i = cal.get_loc(pd.Timestamp(day))
    semis = [t for t in px.columns if t in shares and themes.get(t) in set(rules.semis_themes)]
    r5 = (px.reindex(cal).iloc[i][semis] / px.reindex(cal).iloc[i - 5][semis] - 1).dropna()
    r5 = r5.sort_values(ascending=False)
    px_cal, members = evaluator._on_calendar(inp), evaluator._members(inp)
    got = evaluator._leaders(px_cal, members, "^SOX", day, rules)
    assert [x["ticker"] for x in got] == list(r5.index[:5])
    assert [x["return5_pct"] for x in got] == pytest.approx(list(r5.iloc[:5] * 100), rel=1e-12)
    three = rules.model_copy(update={"surge": rules.surge.model_copy(update={"leaders": 3})})
    assert [x["ticker"] for x in evaluator._leaders(px_cal, members, "^SOX", day, three)] == list(r5.index[:3])


def _stub_alert(start: date, joined: date, last_ref: date | None) -> store.StoredAlert:
    stint = store.StoredStint("ai_semis", "theme", joined, None, None, None, None, None, None, last_ref)
    return store.StoredAlert(1, "live", V, "open", start, None, None, "ai_semis", False, ("ai_semis",), "t",
                             [stint])


def _stub_surge(start: date) -> store.StoredSurge:
    return store.StoredSurge(1, V, "live", "ai_semis", start, None, None, True, {}, None, start, None, None,
                             None, None, [], "t")


def test_live_window_start_bounds_exact():
    """S10 (iii): each bound of live_window_start in isolation, on the long fixture with the last day
    pending. Catches dropping any one bounds.append: the theme rule (426 rows back: big_tech's 400th valid row), the
    alert's earliest last_ref (450 rows back), the alert start - price.window (430 + 20), and the surge
    start - high_window (420 + 20)."""
    px, sox, rsp, shares, themes, fred = load_long()
    inp = evaluator.RiskInputs(px, sox, rsp, shares, themes, {}, fred, [])
    rules = get_rules().rules
    cal = sox.index
    day = cal[-1].date()

    def back(n: int) -> date:
        return cal[-1 - n].date()

    # big_tech misses 26 rows in the window, so the theme bound alone is 426 rows back (see the 20-day test).
    assert evaluator.live_window_start(inp, rules, day, None, []) == back(426) == date(2025, 2, 5)
    assert evaluator.live_window_start(inp, rules, day, _stub_alert(back(300), back(300), back(450)), []) == back(450)
    assert evaluator.live_window_start(inp, rules, day, _stub_alert(back(430), back(430), back(300)), []) == back(450)
    assert evaluator.live_window_start(inp, rules, day, None, [_stub_surge(back(420))]) == back(440)


def _with_theme_only_last(theme: str, rows: int) -> tuple[evaluator.RiskInputs, pd.DatetimeIndex]:
    """The long fixture with `theme`'s members priced only on the last `rows` calendar rows."""
    px, sox, rsp, shares, themes, fred = load_long()
    px = px.copy()
    members = [t for t in px.columns if themes.get(t) == theme]
    px.iloc[: len(px) - rows, [px.columns.get_loc(t) for t in members]] = float("nan")
    return evaluator.RiskInputs(px, sox, rsp, shares, themes, {}, fred, []), sox.index


def test_dead_theme_check_reads_rows_up_to_first_day():
    """Minor 2. nuclear_uranium has a level only on the last 10 rows, all after first_day (20 rows back),
    so up to first_day it is dead and must be skipped. Catches the check reading the newest loaded rows
    (levels.iloc[-n:]) instead of the rows up to first_day: the theme then counts, has 0 valid rows,
    and the whole history is returned."""
    inp, cal = _with_theme_only_last("nuclear_uranium", 10)
    rules = get_rules().rules
    day = cal[-20].date()
    without = evaluator.RiskInputs(inp.closes, inp.sox, inp.rsp, inp.shares,
                                   {t: th for t, th in inp.themes.items() if th != "nuclear_uranium"},
                                   {}, inp.fred, [])
    got = evaluator.live_window_start(inp, rules, day, None, [])
    assert got > cal[0].date()
    assert got == evaluator.live_window_start(without, rules, day, None, [])


def test_young_theme_logs_full_read(monkeypatch):
    """Minor 3. nuclear_uranium has about 100 valid rows up to the last day, fewer than live_window_rows, so the
    whole history is read. Catches that fallback happening silently (no info line naming the theme)."""
    inp, cal = _with_theme_only_last("nuclear_uranium", 100)
    lines: list[str] = []
    monkeypatch.setattr(evaluator.logger, "info", lambda msg, *a: lines.append(msg % a))
    assert evaluator.live_window_start(inp, get_rules().rules, cal[-1].date(), None, []) == cal[0].date()
    [line] = lines
    prefix = "risk.live_window_young_theme theme=nuclear_uranium valid_rows="
    assert line.startswith(prefix) and int(line[len(prefix):]) < 400
