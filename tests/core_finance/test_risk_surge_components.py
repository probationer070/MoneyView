"""Surge components (spec §3.1): magnitude z, slope acceleration and its rank, breadth, RSI."""
import importlib.util
import sys
import types
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.indices import theme_indices
from packages.core_finance.risk_signals.surge import SOX, surge_components
from tests.core_finance._fixture import load_long

RULES = load_rules().rules
S = RULES.surge
EVIDENCE = (
    Path(__file__).resolve().parents[2]
    / "docs/superpowers/specs/2026-10-19-surge-signal-evidence/surge.py"
)


def _run(level, members=None, sox=None):
    """One theme "t1". Members default to three tickers that track the level."""
    level = np.asarray(level, dtype=float)
    idx = pd.bdate_range("2020-01-01", periods=len(level))
    levels = pd.DataFrame({"t1": level}, index=idx)
    if members is None:
        members = {f"m{i}": level for i in range(3)}
    closes = pd.DataFrame(members, index=idx)
    themes = {t: "t1" for t in members}
    shares = {t: 1.0 for t in members}
    sox = pd.Series(level if sox is None else sox, index=idx)
    return surge_components(levels, closes, shares, themes, sox, RULES)


def _walk(n, seed=0):
    rng = np.random.default_rng(seed)
    return 100 * np.cumprod(1 + rng.normal(0.0005, 0.01, n))


def _wilder(lv):
    """Independent loop: average gain/loss seeded by the first diff, then Wilder smoothing."""
    a = 1 / S.rsi.period
    out = np.full(len(lv), np.nan)
    g = lo = None
    for i in range(1, len(lv)):
        d = lv[i] - lv[i - 1]
        up, dn = max(d, 0.0), max(-d, 0.0)
        g = up if g is None else (1 - a) * g + a * up
        lo = dn if lo is None else (1 - a) * lo + a * dn
        with np.errstate(divide="ignore"):
            out[i] = 100 - 100 / (1 + np.float64(g) / lo)
    return out


def test_magnitude_window_excludes_the_move():
    rets = [0.0] + [0.01, -0.01] * 35 + [0.03] * 5
    level = 100 * np.cumprod(1 + np.array(rets))
    c = _run(level)
    t = len(level) - 1
    window = np.array(rets[t - 4 - S.magnitude.std_window : t - 4])  # 60 returns ending 5 rows back
    expected = (level[t] / level[t - 5] - 1) / (window.std(ddof=1) * np.sqrt(5))
    assert c.magnitude_z["t1"].iloc[t] == pytest.approx(expected, rel=1e-9)
    assert bool(c.magnitude_on["t1"].iloc[t])


def test_magnitude_needs_40_values():
    c = _run(_walk(80))
    z = c.magnitude_z["t1"]
    # returns start at row 1; the window ends 5 rows back, so row t has t-5 returns
    assert np.isnan(z.iloc[44])
    assert np.isfinite(z.iloc[45])


def test_accel_rank_uses_only_past_values():
    level = _walk(320, seed=3)
    c = _run(level)
    ema = pd.Series(level).ewm(span=S.ema, adjust=False).mean()
    slope = (ema / ema.shift(1) - 1) * 100
    acc = (slope - slope.shift(S.accel_lag)).to_numpy()
    np.testing.assert_allclose(c.accel_pct["t1"].to_numpy(), acc, rtol=1e-12, equal_nan=True)
    rank = c.accel_rank["t1"].to_numpy()
    for i in range(124, len(level)):
        w = acc[max(0, i - S.accel.quantile_window) : i]
        w = np.sort(w[~np.isnan(w)])
        assert rank[i] == pytest.approx(np.interp(acc[i], w, np.linspace(0, 1, len(w))), abs=1e-12)
        thr = np.quantile(w, S.accel.rank)
        assert bool(c.accel_on["t1"].iloc[i]) == bool(acc[i] >= thr)
    # changing the future leaves every rank up to row 200 alone
    bumped = level.copy()
    bumped[201:] *= 1.3
    np.testing.assert_array_equal(_run(bumped).accel_rank["t1"].to_numpy()[:201], rank[:201])


def test_accel_needs_120_values():
    c = _run(_walk(200, seed=1))
    assert np.isnan(c.accel_pct["t1"].iloc[3]) and np.isfinite(c.accel_pct["t1"].iloc[4])
    # first accel at row 4, so row i has i-4 previous values
    assert np.isnan(c.accel_rank["t1"].iloc[123])
    assert np.isfinite(c.accel_rank["t1"].iloc[124])
    assert not c.accel_on["t1"].iloc[:124].any()


def test_breadth_counts_members_with_data():
    n = 12
    up = 100 + np.arange(n, dtype=float)
    down = 100 - np.arange(n, dtype=float)
    gap_now, gap_back = down.copy(), down.copy()
    gap_now[-1] = np.nan  # no close today
    gap_back[-6] = np.nan  # no close 5 rows back
    members = {"u1": up, "u2": up, "d1": down, "g1": gap_now, "g2": gap_back, "noshares": down}
    idx = pd.bdate_range("2020-01-01", periods=n)
    closes = pd.DataFrame(members, index=idx)
    themes = {t: "t1" for t in members}
    shares = {t: 1.0 for t in members if t != "noshares"}
    levels = pd.DataFrame({"t1": up}, index=idx)
    c = surge_components(levels, closes, shares, themes, pd.Series(up, index=idx), RULES)
    assert c.breadth_pct["t1"].iloc[-1] == pytest.approx(200 / 3)
    assert bool(c.breadth_on["t1"].iloc[-1])


def test_rsi_cross_within_5_and_band():
    rets = [0.0] + [0.01, -0.02] * 20 + [0.02, -0.01] * 15
    level = 100 * np.cumprod(1 + np.array(rets))
    c = _run(level)
    rsi = _wilder(level)
    np.testing.assert_allclose(c.rsi["t1"].to_numpy(), rsi, rtol=1e-10, equal_nan=True)
    cross = np.r_[False, (rsi[:-1] < S.rsi.cross) & (rsi[1:] >= S.rsi.cross)]
    expected = np.array([
        cross[max(0, i - S.rsi.within + 1) : i + 1].any() and S.rsi.cross <= rsi[i] <= S.rsi.overheated
        for i in range(len(rsi))
    ])
    got = c.rsi_on["t1"].to_numpy()
    np.testing.assert_array_equal(got, expected)
    first = int(np.argmax(cross))
    assert got[first]
    # a day in band whose only cross is 5+ rows old is off
    stale = [i for i in range(len(rsi)) if not expected[i] and S.rsi.cross <= rsi[i] <= S.rsi.overheated]
    assert stale


def test_overheated_above_80():
    # starts down so the first rows are not RSI 100; the final jump crosses 60 and then passes 80
    rets = [0.0] + [-0.02, 0.01] * 20 + [0.10] * 4
    level = 100 * np.cumprod(1 + np.array(rets))
    c = _run(level)
    rsi = c.rsi["t1"]
    hot = rsi > S.rsi.overheated
    assert hot.to_numpy().tolist() == [False] * (len(level) - 1) + [True]
    assert rsi.iloc[-4] < S.rsi.cross <= rsi.iloc[-3]  # the cross is 2 rows back, inside the 5-row window
    np.testing.assert_array_equal(c.overheated["t1"].to_numpy(), hot.to_numpy())
    assert not c.rsi_on["t1"][hot].any()


@pytest.fixture(scope="module")
def long_components():
    px, sox, _rsp, shares, themes, _fred = load_long()
    levels = theme_indices(px, shares, themes, RULES.min_members)
    return px, sox, shares, themes, levels, surge_components(levels, px, shares, themes, sox, RULES)


def test_on_requires_all_four(long_components):
    *_, c = long_components
    parts = [c.magnitude_on, c.accel_on, c.breadth_on, c.rsi_on]
    count = sum(p.astype(int) for p in parts)
    pd.testing.assert_frame_equal(c.on, count == 4)
    assert (count == 3).to_numpy().any()
    assert c.on.to_numpy().any()
    assert RULES.excluded_themes[0] not in c.on.columns
    assert SOX in c.on.columns


def test_sox_breadth_union_of_semis():
    n = 12
    up = 100 + np.arange(n, dtype=float)
    down = 100 - np.arange(n, dtype=float)
    semis_a, semis_b = RULES.semis_themes[:2]
    members = {"a1": up, "b1": down, "b2": down, "x1": up, "x2": up}
    themes = {"a1": semis_a, "b1": semis_b, "b2": semis_b, "x1": "other", "x2": "other"}
    idx = pd.bdate_range("2020-01-01", periods=n)
    closes = pd.DataFrame(members, index=idx)
    levels = pd.DataFrame({semis_a: up, semis_b: down, "other": up}, index=idx)
    c = surge_components(levels, closes, {t: 1.0 for t in members}, themes, pd.Series(up, index=idx), RULES)
    assert c.breadth_pct[SOX].iloc[-1] == pytest.approx(100 / 3)


def _evidence_module(monkeypatch):
    # surge.py imports backtest for its cache loaders only; the pure indicator functions never use it.
    monkeypatch.setitem(sys.modules, "backtest", types.ModuleType("backtest"))
    spec = importlib.util.spec_from_file_location("surge_evidence", EVIDENCE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_parity_with_evidence_surge_py(long_components, monkeypatch):
    sg = _evidence_module(monkeypatch)
    px, sox, shares, themes, levels, c = long_components
    s = dict(n=10, k=3, Z=2.0, P=5, U=3, B=60, R=60)
    # members and breadth exactly as surge.build() forms them
    r5 = px / px.shift(5) - 1
    mem = {}
    for t in px.columns:
        if themes.get(t) is not None and pd.notna(shares.get(t)):
            mem.setdefault(themes[t], []).append(t)

    def bfrac(m):
        x = r5[m]
        return (x > 0).sum(axis=1) / x.notna().sum(axis=1).replace(0, np.nan)

    semis_m = sorted({t for th in RULES.semis_themes for t in mem.get(th, [])})
    series = {
        "ai_semis": (levels["ai_semis"], bfrac(mem["ai_semis"])),
        "gold_silver": (levels["gold_silver"], bfrac(mem["gold_silver"])),  # has a ticker without shares
        "crypto": (levels["crypto"], bfrac(mem["crypto"])),
        SOX: (sox, bfrac(semis_m)),
    }
    signals = 0
    for name, (lv, frac) in series.items():
        ind = sg.indicators(lv, lv.notna(), frac)
        f = sg.comp_flags(ind, s)
        np.testing.assert_allclose(c.magnitude_z[name].to_numpy(), ind["z"], rtol=1e-12, equal_nan=True)
        np.testing.assert_allclose(c.ema[name].to_numpy(), ind["ema"][10], rtol=1e-12, equal_nan=True)
        np.testing.assert_allclose(c.breadth_pct[name].to_numpy() / 100, ind["breadth"], rtol=1e-12, equal_nan=True)
        np.testing.assert_allclose(c.rsi[name].to_numpy(), ind["rsi"], rtol=1e-12, equal_nan=True)
        np.testing.assert_array_equal(c.magnitude_on[name].to_numpy(), f["mag"])
        np.testing.assert_array_equal(c.accel_on[name].to_numpy(), f["accel"])
        np.testing.assert_array_equal(c.breadth_on[name].to_numpy(), f["breadth"] & lv.notna().to_numpy())
        np.testing.assert_array_equal(c.rsi_on[name].to_numpy(), f["rsi"])
        np.testing.assert_array_equal(c.high_new[name].to_numpy(), ind["newhigh"])
        sig = sg.signal(ind, s, drop="pers", M=4)
        np.testing.assert_array_equal(c.on[name].to_numpy(), sig)
        signals += int(sig.sum())
    assert signals > 0  # the comparison saw surge days, not only all-False arrays
