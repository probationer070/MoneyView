import pandas as pd

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.alerts import Confirmations, confirmations, run_alerts
from packages.core_finance.risk_signals.indices import Shapes

RULES = load_rules().rules
IDX = pd.bdate_range("2026-01-01", periods=40)
SEMI = RULES.semis_themes[0]
OTHER = "software_cloud"
BAD = -RULES.price.drop_pct / 100 - 0.01  # a dd that breaks the price test


def _series(v, dtype):
    if isinstance(v, dict):
        out = pd.Series(v["default"], index=IDX, dtype=dtype)
        for k, x in v.items():
            if k != "default":
                out.iloc[k] = x
        return out
    return pd.Series(v, index=IDX, dtype=dtype)


def _shapes(dd=0.0, down=0, low=False, valid=True):
    return Shapes(
        dd=_series(dd, float), down=_series(down, int), new_low=_series(low, bool), valid=_series(valid, bool)
    )


def _conf(fire, sox=None, themes=("a", "b")):
    """fire: {theme: set of positions}."""
    theme = pd.DataFrame(False, index=IDX, columns=list(themes))
    for t, pos in fire.items():
        theme.iloc[sorted(pos), list(themes).index(t)] = True
    via = theme.map(lambda b: "theme" if b else "")
    sx = pd.Series(False, index=IDX)
    for p in sox or []:
        sx.iloc[p] = True
    return Confirmations(theme, via, sx)


def _share(**cols):
    df = pd.DataFrame(0.0, index=IDX, columns=["a", "b"])
    for k, v in cols.items():
        df[k] = v
    return df


def _run(conf, share, shapes, a=0, b=39, state=None):
    dates = [IDX[i].date() for i in range(a, b + 1)]
    return run_alerts(dates, conf, share, shapes, RULES, state)


def _calm():
    return {"a": _shapes(dd=-0.5), "b": _shapes(dd=-0.5)}  # deep drawdown: recover test never passes


def _full_conf(sox_shapes, themes, on_count):
    return confirmations(themes, sox_shapes, pd.Series(on_count, index=IDX), RULES)


def _left(cur, theme):
    return [s.left for s in cur.stints if s.theme == theme]


def test_price_test_needs_both_drop_and_down_days():
    p = RULES.price
    drop = -p.drop_pct / 100 - 0.001
    shapes = {
        "t": _shapes(
            dd={"default": 0.0, 1: drop, 2: drop, 3: 0.0},
            down={"default": 0, 1: p.down_days, 2: p.down_days - 1, 3: p.down_days},
        )
    }
    c = _full_conf(_shapes(), shapes, 99)
    assert list(c.theme["t"].iloc[:4]) == [False, True, False, False]


def test_semis_via_sox_requires_own_index_valid():
    sox = _shapes(dd=BAD, down=RULES.price.down_days)
    themes = {SEMI: _shapes(valid={"default": True, 1: False}), OTHER: _shapes()}
    c = _full_conf(sox, themes, 99)
    assert c.theme[SEMI].iloc[0] and c.via[SEMI].iloc[0] == "sox"
    assert not c.theme[SEMI].iloc[1] and c.via[SEMI].iloc[1] == ""
    assert not c.theme[OTHER].iloc[0]  # non-semis never confirm via SOX
    assert c.sox.iloc[0]


def test_via_theme_when_own_test_passes_even_if_sox_also_passes():
    sox = _shapes(dd=BAD, down=RULES.price.down_days)
    themes = {SEMI: _shapes(dd=BAD, down=RULES.price.down_days)}
    assert _full_conf(sox, themes, 99).via[SEMI].iloc[0] == "theme"


def test_warning_count_gate():
    s = _shapes(dd=BAD, down=RULES.price.down_days)
    c = _full_conf(s, {SEMI: s, OTHER: s}, RULES.warnings_required - 1)
    assert not c.theme.any().any() and not c.sox.any()
    c = _full_conf(s, {SEMI: s, OTHER: s}, RULES.warnings_required)
    assert c.theme.all().all() and c.sox.all()


def test_excluded_theme_never_fires():
    s = _shapes(dd=BAD, down=RULES.price.down_days)
    c = _full_conf(s, {"defensives_other": s, OTHER: s}, 99)
    assert "defensives_other" not in c.theme.columns
    assert "defensives_other" not in c.via.columns


def test_open_by_cap_share():
    conf = _conf({"a": {5}})
    _, cur = _run(conf, _share(a=0.25), _calm(), 0, 5)
    assert cur is not None and cur.start == IDX[5].date() and cur.trigger == ("a",)
    rec, cur = _run(conf, _share(a=0.19), _calm(), 0, 5)
    assert cur is None and rec == []


def test_open_by_sox_ignores_cap_share():
    _, cur = _run(_conf({"a": {5}}, sox=[5]), _share(a=0.01), _calm(), 0, 5)
    assert cur is not None and cur.start == IDX[5].date()
    # SOX confirming with no firing theme opens nothing
    _, cur = _run(_conf({}, sox=[5]), _share(), _calm())
    assert cur is None


def test_open_day_has_no_exit_check():
    shapes = {"a": _shapes(dd=0.0), "b": _shapes(dd=0.0)}  # fully recovered
    _, cur = _run(_conf({"a": {5}}), _share(a=0.5), shapes, 0, 5)
    assert cur is not None and cur.stints[0].left is None


def test_join_and_rejoin_make_two_stints():
    shapes = {"a": _shapes(dd=0.0), "b": _shapes(dd=-0.5)}
    conf = _conf({"a": {5, 9}, "b": set(range(5, 11))})
    _, cur = _run(conf, _share(a=0.5), shapes, 0, 10)
    a = [s for s in cur.stints if s.theme == "a"]
    assert [(s.joined, s.left) for s in a] == [(IDX[5].date(), IDX[6].date()), (IDX[9].date(), IDX[10].date())]
    assert len([s for s in cur.stints if s.theme == "b"]) == 1


def _quiet_case(low_pos=()):
    low = {"default": False, **{p: True for p in low_pos}}
    return {"a": _shapes(dd=-0.5, low=low), "b": _shapes(dd=-0.5)}


def test_quiet_exit_at_five_days():
    q = RULES.theme_exit.quiet_days
    conf = _conf({"a": {10}, "b": set(range(10, 30))})
    shapes = _quiet_case()
    _, cur = _run(conf, _share(a=0.5), shapes, 0, 10 + q - 1)
    assert _left(cur, "a") == [None]
    _, cur = _run(conf, _share(a=0.5), shapes, 0, 10 + q)
    assert _left(cur, "a") == [IDX[10 + q].date()]


def test_new_low_resets_quiet_clock():
    q = RULES.theme_exit.quiet_days
    conf = _conf({"a": {10}, "b": set(range(10, 30))})
    shapes = _quiet_case(low_pos=[12])
    _, cur = _run(conf, _share(a=0.5), shapes, 0, 12 + q - 1)
    assert _left(cur, "a") == [None]
    _, cur = _run(conf, _share(a=0.5), shapes, 0, 12 + q)
    assert _left(cur, "a") == [IDX[12 + q].date()]


def test_recover_exit_strict():
    r = RULES.theme_exit.recover_within_pct / 100
    conf = _conf({"a": {5}, "b": set(range(5, 30))})
    stay = {"a": _shapes(dd=-r), "b": _shapes(dd=-0.5)}
    _, cur = _run(conf, _share(a=0.5), stay, 0, 6)
    assert _left(cur, "a") == [None]
    leave = {"a": _shapes(dd=-r + 0.0001), "b": _shapes(dd=-0.5)}
    _, cur = _run(conf, _share(a=0.5), leave, 0, 6)
    assert _left(cur, "a") == [IDX[6].date()]


def test_still_firing_never_leaves():
    shapes = {"a": _shapes(dd=0.0), "b": _shapes(dd=0.0)}
    _, cur = _run(_conf({"a": set(range(5, 30))}), _share(a=0.5), shapes, 0, 29)
    assert cur is not None and cur.stints[0].left is None


def test_close_then_reopen_next_day_not_same_day():
    shapes = {"a": _shapes(dd=0.0), "b": _shapes(dd=0.0)}
    # a fires 5 (open), 6 (still in, stays), not 7 (leaves, closes), fires 8 (reopens next day after close)
    rec, cur = _run(_conf({"a": {5, 6, 8}}), _share(a=0.5), shapes, 0, 8)
    assert [(r.start, r.release, r.reason) for r in rec] == [(IDX[5].date(), IDX[7].date(), "all_themes_out")]
    assert cur is not None and cur.start == IDX[8].date()
    # firing on the closing day itself does not start a second alert that day
    rec, cur = _run(_conf({"a": {5}, "b": {6}}), _share(a=0.5, b=0.5), shapes, 0, 6)
    assert rec == [] and cur is not None and cur.start == IDX[5].date()


def test_close_day_with_no_firing_leaves_nothing_open():
    shapes = {"a": _shapes(dd=0.0), "b": _shapes(dd=0.0)}
    rec, cur = _run(_conf({"a": {5}}), _share(a=0.5), shapes, 0, 6)
    assert [(r.start, r.release) for r in rec] == [(IDX[5].date(), IDX[6].date())]
    assert cur is None


def test_one_day_calls_agree_with_batch():
    shapes = {"a": _shapes(dd=-0.5, low={"default": False, 12: True}), "b": _shapes(dd=-0.5)}
    conf = _conf({"a": {5, 20, 38}, "b": {6, 7}})  # a quiet-exits between 5 and 20
    share = _share(a=0.5)
    batch = _run(conf, share, shapes)
    recs, state = [], None
    for i in range(40):
        r, state = _run(conf, share, shapes, i, i, state)
        recs += r
    assert (recs, state) == batch
    assert batch[0] and batch[1] is not None


def test_state_not_mutated():
    shapes = _calm()
    conf = _conf({"a": {5}, "b": {20}})
    _, cur = _run(conf, _share(a=0.5), shapes, 0, 5)
    snap = (cur.start, [(s.theme, s.left, s.last_ref) for s in cur.stints])
    _run(conf, _share(a=0.5), shapes, 6, 39, cur)
    assert snap == (cur.start, [(s.theme, s.left, s.last_ref) for s in cur.stints])


def test_own_index_invalid_day_does_not_confirm():
    p = RULES.price
    s = _shapes(dd=BAD, down=p.down_days, valid={"default": True, 1: False})
    c = _full_conf(_shapes(), {OTHER: s}, 99)
    assert list(c.theme[OTHER].iloc[:2]) == [True, False]
