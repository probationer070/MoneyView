"""Daily top movers (spec §4)."""
import numpy as np
import pandas as pd
import pytest

from apps.api.services.risk.rules import load_rules
from packages.core_finance.risk_signals.movers import Mover, top_movers

RULES = load_rules().rules


def _wilder(lv, period=14):
    """Independent loop: seeded by the first diff, then Wilder smoothing."""
    a = 1 / period
    g = lo = None
    for i in range(1, len(lv)):
        d = lv[i] - lv[i - 1]
        up, dn = max(d, 0.0), max(-d, 0.0)
        g = up if g is None else (1 - a) * g + a * up
        lo = dn if lo is None else (1 - a) * lo + a * dn
    return 100 - 100 / (1 + g / lo)


def _closes(n=30, seed=1):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-02", periods=n)
    cols = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"]
    px = pd.DataFrame(100 * np.cumprod(1 + rng.normal(0, 0.02, (n, len(cols))), axis=0), index=idx, columns=cols)
    t = n - 1
    # day returns on the last row: BBB and AAA tie, HHH has no close the day before
    for col, r in {"AAA": 0.05, "BBB": 0.05, "CCC": 0.08, "DDD": -0.01, "EEE": 0.02, "FFF": 0.03, "GGG": 0.01}.items():
        px.iloc[t, px.columns.get_loc(col)] = px.iloc[t - 1, px.columns.get_loc(col)] * (1 + r)
    px.loc[px.index[t - 1:], ["AAA", "BBB"]] = [[100.0, 100.0], [105.0, 105.0]]  # an exact tie
    px.iloc[t - 1, px.columns.get_loc("HHH")] = np.nan
    px.iloc[t, px.columns.get_loc("HHH")] = px.iloc[t - 2, px.columns.get_loc("HHH")] * 1.5
    px.iloc[t - 3, px.columns.get_loc("CCC")] = np.nan  # CCC's 5-row return skips the gap
    return px


def test_movers_order_and_ties():
    px = _closes()
    day = px.index[-1].date()
    got = top_movers(px, day, RULES)
    assert [(m.rank, m.ticker) for m in got] == [(1, "CCC"), (2, "AAA"), (3, "BBB"), (4, "FFF"), (5, "EEE")]
    ccc = got[0]
    s = px["CCC"].dropna()
    assert ccc.return_pct == pytest.approx(8.0, rel=1e-12)
    assert ccc.close == s.iloc[-1]
    assert ccc.return5_pct == pytest.approx((s.iloc[-1] / s.iloc[-6] - 1) * 100, rel=1e-12)
    assert ccc.rsi == pytest.approx(_wilder(s.to_numpy()), rel=1e-12)
    assert isinstance(ccc, Mover)


def test_movers_fewer_than_five():
    px = _closes()
    t = len(px) - 1
    px.iloc[t - 1, :5] = np.nan  # only FFF and GGG keep both closes (HHH lacks the day before)
    got = top_movers(px, px.index[t].date(), RULES)
    assert [(m.rank, m.ticker) for m in got] == [(1, "FFF"), (2, "GGG")]


def _rules(count, window, period):
    sg = RULES.surge
    surge = sg.model_copy(update={"magnitude": sg.magnitude.model_copy(update={"window": window}),
                                  "rsi": sg.rsi.model_copy(update={"period": period})})
    return RULES.model_copy(update={"movers": RULES.movers.model_copy(update={"count": count}), "surge": surge})


def test_movers_read_count_and_windows_from_rules():
    px = _closes()
    got = top_movers(px, px.index[-1].date(), _rules(count=3, window=4, period=9))
    assert [m.ticker for m in got] == ["CCC", "AAA", "BBB"]
    s = px["CCC"].dropna()
    assert got[0].return5_pct == pytest.approx((s.iloc[-1] / s.iloc[-5] - 1) * 100, rel=1e-12)
    assert got[0].rsi == pytest.approx(_wilder(s.to_numpy(), 9), rel=1e-12)
