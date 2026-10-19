"""The six daily market warnings, using only what was knowable on each trading day.

Pure pandas: no DB, no network. Thresholds come from RiskRules.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd

from .config import RiskRules

WARNING_IDS = ["W1", "W2", "W3", "W4", "W5", "W7"]
_TOL = 1e-9
_MM_TOL = 1e-12


@dataclass(frozen=True)
class WarningFrame:
    state: pd.DataFrame
    value: pd.DataFrame
    observed_at: pd.DataFrame
    w1_proxy: pd.Series
    on_count: pd.Series


def _clean(series: pd.Series | None) -> pd.Series:
    if series is None:
        return pd.Series(dtype=float)
    return series.dropna().sort_index()


def _align(values: pd.Series, obs: pd.Series, release: pd.DatetimeIndex, cal: pd.DatetimeIndex):
    """Carry values (and their observation dates) forward from their release dates onto cal."""
    v = pd.Series(values.to_numpy(dtype=float), index=release)
    o = pd.Series(obs.to_numpy(dtype="datetime64[ns]"), index=release)
    keep = ~v.index.duplicated(keep="last")
    v, o = v[keep], o[keep]
    grid = cal.union(v.index)
    return v.reindex(grid).ffill().reindex(cal), o.reindex(grid).ffill().reindex(cal)


def daily_release(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """A daily FRED observation is known from the next business day."""
    return index + pd.tseries.offsets.BDay(1)


def cpi_release(month: pd.Timestamp, known_day: int) -> pd.Timestamp:
    """A CPI-type monthly figure is known from `known_day` of the following month."""
    return month + pd.DateOffset(months=1, days=known_day - 1)


def pce_release(month: pd.Timestamp) -> pd.Timestamp:
    """A PCE monthly figure is known from the last day of the following month."""
    return month + pd.DateOffset(months=2) - pd.Timedelta(days=1)


def _daily_known(series: pd.Series | None, cal: pd.DatetimeIndex):
    """Value known at trading day t = last observation dated <= t - 1 business day."""
    s = _clean(series)
    if s.empty:
        return pd.Series(np.nan, index=cal), pd.Series(pd.NaT, index=cal, dtype="datetime64[ns]")
    s.index = pd.DatetimeIndex(s.index)
    release = daily_release(s.index)
    return _align(s, pd.Series(s.index, index=s.index), release, cal)


def _monthly_known(series: pd.Series | None, cal: pd.DatetimeIndex, release_of):
    """m/m change of month M, known from release_of(M) on."""
    s = _clean(series)
    mm = s.pct_change().dropna() if not s.empty else s
    if mm.empty:
        return pd.Series(np.nan, index=cal), pd.Series(pd.NaT, index=cal, dtype="datetime64[ns]")
    mm.index = pd.DatetimeIndex(mm.index)
    release = pd.DatetimeIndex([release_of(d) for d in mm.index])
    return _align(mm, pd.Series(mm.index, index=mm.index), release, cal)


def _state(on: pd.Series, off: pd.Series) -> pd.Series:
    """on wins; else off where the test is decidable; else unknown."""
    out = pd.Series("unknown", index=on.index, dtype=object)
    out[off] = "off"
    out[on] = "on"
    return out


def market_warnings(
    cal: pd.DatetimeIndex,
    fred: Mapping[str, pd.Series],
    sox: pd.Series,
    rsp: pd.Series,
    rules: RiskRules,
) -> WarningFrame:
    cal = pd.DatetimeIndex(cal)
    nat = pd.Series(pd.NaT, index=cal, dtype="datetime64[ns]")
    state = pd.DataFrame(index=cal)
    value = pd.DataFrame(index=cal)
    observed = pd.DataFrame(index=cal)

    # W1: HY on/after hy_from, BAA proxy before.
    w1 = rules.w1
    hy, hy_obs = _daily_known(fred.get(w1.series), cal)
    baa, baa_obs = _daily_known(fred.get(w1.proxy.series), cal)
    use_hy = pd.Series(cal >= pd.Timestamp(w1.hy_from), index=cal)
    lvl = hy.where(use_hy, baa)
    obs = hy_obs.where(use_hy, baa_obs)
    chg = (hy.diff(w1.rise_window)).where(use_hy, baa.diff(w1.rise_window))
    rise = pd.Series(np.where(use_hy, w1.rise_pp, w1.proxy.rise_pp), index=cal)
    level_th = pd.Series(np.where(use_hy, w1.level, w1.proxy.level), index=cal)
    on = (lvl >= level_th - _TOL) | (chg >= rise - _TOL)
    state["W1"] = _state(on, lvl.notna())
    value["W1"] = lvl
    observed["W1"] = obs

    # W2: level, or rise over the window; level alone is enough when history is short.
    w2 = rules.w2
    dgs, dgs_obs = _daily_known(fred.get(w2.series), cal)
    chg = dgs.diff(w2.rise_window)
    on = (dgs >= w2.level - _TOL) | (chg >= w2.rise_pp - _TOL)
    state["W2"] = _state(on, dgs.notna() & chg.notna())
    value["W2"] = dgs
    observed["W2"] = dgs_obs

    # W3: percent change over the window.
    w3 = rules.w3
    brent, brent_obs = _daily_known(fred.get(w3.series), cal)
    pct = (brent / brent.shift(w3.window) - 1) * 100
    on = pct >= w3.rise_pct - _TOL * 100
    state["W3"] = _state(on, pct.notna())
    value["W3"] = pct
    observed["W3"] = brent_obs

    # W4: a policy-rate increase within the last N calendar days; no publication lag.
    ff = _clean(fred.get(rules.w4.series))
    if ff.empty:
        state["W4"] = "unknown"
        value["W4"] = np.nan
        observed["W4"] = nat
    else:
        hikes = pd.DatetimeIndex(ff.index[ff.diff() > 0])
        pos = hikes.searchsorted(cal, side="right") - 1
        last = pd.Series(
            [hikes[p] if p >= 0 else pd.NaT for p in pos], index=cal, dtype="datetime64[ns]"
        )
        since = (pd.Series(cal, index=cal) - last).dt.days.astype(float)
        state["W4"] = _state(since <= rules.w4.days, pd.Series(True, index=cal))
        value["W4"] = since
        observed["W4"] = last

    # W5: core CPI / core PCE month over month.
    w5 = rules.w5
    day = w5.cpi_known_day
    cpi, cpi_obs = _monthly_known(
        fred.get(w5.cpi_series), cal, lambda d: cpi_release(d, day)
    )
    pce, pce_obs = _monthly_known(fred.get(w5.pce_series), cal, pce_release)
    th = w5.mm_pct / 100
    on = (cpi >= th - _MM_TOL) | (pce >= th - _MM_TOL)
    state["W5"] = _state(on, cpi.notna() | pce.notna())
    value["W5"] = pd.concat([cpi, pce], axis=1).max(axis=1) * 100
    pce_wins = pce > cpi.fillna(-np.inf)
    observed["W5"] = pce_obs.where(pce_wins, cpi_obs).where(cpi.notna() | pce.notna())

    # W7: SOX/RSP ratio well below its max while SOX itself is not.
    w7 = rules.w7
    sox_c = sox.reindex(cal)
    rsp_c = rsp.reindex(cal)
    ratio = sox_c / rsp_c
    r_drop = 1 - ratio / ratio.rolling(w7.window, min_periods=w7.window).max()
    s_drop = 1 - sox_c / sox_c.rolling(w7.window, min_periods=w7.window).max()
    on = (r_drop >= w7.ratio_drop_pct / 100 - _MM_TOL) & (s_drop <= w7.sox_within_pct / 100 + _MM_TOL)
    state["W7"] = _state(on, r_drop.notna() & s_drop.notna())
    value["W7"] = r_drop * 100
    observed["W7"] = pd.Series(cal, index=cal).where(r_drop.notna() & s_drop.notna())

    state = state[WARNING_IDS]
    value = value[WARNING_IDS]
    observed = observed[WARNING_IDS]
    return WarningFrame(
        state=state,
        value=value,
        observed_at=observed,
        w1_proxy=pd.Series(~use_hy.to_numpy(), index=cal),
        on_count=(state == "on").sum(axis=1).astype(int),
    )
