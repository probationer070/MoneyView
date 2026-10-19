import numpy as np
import pandas as pd
from pandas.testing import assert_frame_equal, assert_series_equal

from packages.core_finance.risk_signals.indices import price_shapes, theme_cap_share, theme_indices

DAYS = pd.bdate_range("2026-01-05", periods=8)
SHARES = {"A": 1.0, "B": 2.0, "C": 3.0, "D": 4.0}
THEMES = {"A": "t", "B": "t", "C": "t", "D": "t"}


def frame(**cols):
    return pd.DataFrame(cols, index=DAYS[: len(next(iter(cols.values())))], dtype=float)


def weighted_return(prev, now, tickers):
    w = {k: SHARES[k] * prev[k] for k in tickers}
    return sum(w[k] * (now[k] / prev[k] - 1) for k in tickers) / sum(w.values())


def test_chain_link_member_enters():
    nan = np.nan
    px = frame(A=[10, 11, 12.1, 12], B=[20, 20, 22, 22], C=[30, 33, 33, 33], D=[nan, nan, 1000, 1100])
    lvl = theme_indices(px, SHARES, THEMES, 3)["t"]
    # Day 3 (index 2): D has no day-2 close, so only A, B, C count.
    exp2 = weighted_return(px.iloc[1], px.iloc[2], ["A", "B", "C"])
    assert abs(lvl.iloc[2] / lvl.iloc[1] - 1 - exp2) < 1e-12
    # Day 4: D now counts, weighted by its large day-3 cap.
    exp3 = weighted_return(px.iloc[2], px.iloc[3], ["A", "B", "C", "D"])
    assert abs(lvl.iloc[3] / lvl.iloc[2] - 1 - exp3) < 1e-12


def test_split_rescale_does_not_move_index():
    px = frame(A=[10, 11, 12, 11, 13], B=[20, 21, 19, 22, 23], C=[30, 29, 31, 33, 32])
    base = theme_indices(px, SHARES, THEMES, 3)["t"]
    scaled = px.copy()
    scaled["B"] = scaled["B"] * 10
    # A split multiplies the price and divides the share count: the cap is unchanged.
    scaled_shares = {**SHARES, "B": SHARES["B"] / 10}
    assert_series_equal(theme_indices(scaled, scaled_shares, THEMES, 3)["t"], base)


def test_below_min_members_is_nan_and_resumes():
    nan = np.nan
    px = frame(
        A=[10, 11, 12, 13, 14, 15, 16],
        B=[20, 21, 22, 23, nan, 25, 26],
        C=[30, 31, 32, 33, 34, 35, 36],
    )
    out = theme_indices(px, SHARES, THEMES, 3)["t"]
    assert out.iloc[0:1].isna().all()
    assert out.iloc[1] == 100.0
    # Day 5 lacks B; day 6 lacks B's day-5 close, so both are NaN.
    assert out.iloc[4:6].isna().all()
    exp = weighted_return(px.iloc[5], px.iloc[6], ["A", "B", "C"])
    assert abs(out.iloc[6] / out.iloc[3] - 1 - exp) < 1e-12


def test_no_shares_ticker_skipped():
    px = frame(A=[10, 11, 12], B=[20, 21, 22], C=[30, 31, 32], X=[5, 50, 5])
    themes = {**THEMES, "X": "t"}
    with_x = theme_indices(px, SHARES, themes, 3)
    without_x = theme_indices(px.drop(columns="X"), SHARES, THEMES, 3)
    assert_frame_equal(with_x, without_x)
    assert list(theme_indices(px[["X"]], SHARES, themes, 1).columns) == []


def test_cap_share_denominator_includes_excluded_theme():
    px = frame(A=[10, 10], B=[10, 10], D=[10, 10])
    shares = {"A": 1.0, "B": 1.0, "D": 2.0}
    themes = {"A": "t", "B": "t", "D": "defensives_other"}
    out = theme_cap_share(px, shares, themes)
    assert out["t"].tolist() == [0.5, 0.5]
    assert out["defensives_other"].tolist() == [0.5, 0.5]


def test_price_shapes_window():
    s = pd.Series([10, 9, 8, 8.5, 7], index=DAYS[:5], dtype=float)
    sh = price_shapes(s, 4)
    assert sh.dd.iloc[-1] == 7 / 9 - 1
    assert sh.down.tolist() == [0, 1, 2, 0, 1]
    assert bool(sh.new_low.iloc[-1]) is True
    assert not sh.new_low.iloc[:2].any()
    flat = price_shapes(pd.Series([10, 9, 9, 8, 8.5], index=DAYS[:5], dtype=float), 3)
    assert flat.down.tolist() == [0, 1, 0, 1, 0]
    assert flat.new_low.tolist() == [False, False, True, True, False]
    assert sh.valid.all()


def test_shapes_need_full_window_after_gap():
    s = pd.Series([10, 9, 8, np.nan, 7, 6, 5.5], index=DAYS[:7], dtype=float)
    sh = price_shapes(s, 3)
    assert sh.dd.iloc[2] == 8 / 10 - 1
    assert sh.dd.iloc[3:6].isna().all()
    assert not sh.new_low.iloc[3:6].any()
    assert sh.dd.iloc[6] == 5.5 / 7 - 1
    assert sh.down.tolist() == [0, 1, 2, 0, 0, 1, 2]
    assert not sh.valid.iloc[3]
