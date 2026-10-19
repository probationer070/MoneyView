"""Surge components per theme and day (spec §3.1).

Pure pandas: no DB, no network. Each indicator runs on its series' own non-NaN rows
(so "5 rows", the 60/250 windows and the EMA count valid days only) and is reindexed
back to the input calendar. Matches docs/superpowers/specs/2026-10-19-surge-signal-evidence/surge.py.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd

from .config import RiskRules, Surge
from .indices import _members_by_theme

SOX = "^SOX"
_TOL = 1e-12


@dataclass(frozen=True)
class SurgeComponents:
    """Index = the levels' dates; columns = trigger themes plus "^SOX"."""

    magnitude_z: pd.DataFrame  # window-row return / (stdev of daily returns ending window rows back * sqrt(window))
    accel_pct: pd.DataFrame  # slope(t) - slope(t-lag), slope = EMA(t)/EMA(t-1)-1 in percent
    accel_rank: pd.DataFrame  # 0..1 position of accel among the previous quantile_window rows' values
    breadth_pct: pd.DataFrame  # percent of members with data whose window-row return is > 0
    rsi: pd.DataFrame  # Wilder RSI
    magnitude_on: pd.DataFrame
    accel_on: pd.DataFrame
    breadth_on: pd.DataFrame
    rsi_on: pd.DataFrame
    on: pd.DataFrame  # all four on
    overheated: pd.DataFrame  # RSI above rsi.overheated
    ema: pd.DataFrame
    high_new: pd.DataFrame  # level >= max of the last high_window valid rows


def _trailing_rank(acc: np.ndarray, window: int, min_count: int) -> np.ndarray:
    """Where acc[i] sits among the non-NaN values of the previous ``window`` rows, as the
    inverse of linear-interpolated quantiles: rank >= q exactly when acc[i] >= that window's
    q-quantile. NaN when acc[i] is NaN or fewer than ``min_count`` previous values exist."""
    out = np.full(len(acc), np.nan)
    for i, x in enumerate(acc):
        if np.isnan(x):
            continue
        w = acc[max(0, i - window) : i]
        w = np.sort(w[~np.isnan(w)])
        n = len(w)
        if n < min_count:
            continue
        k = int(np.searchsorted(w, x, side="right"))  # values <= x
        if k == n:
            out[i] = 1.0
        elif k == 0:
            out[i] = 0.0
        else:
            j = k - 1
            out[i] = (j + (x - w[j]) / (w[k] - w[j])) / (n - 1)
    return out


def _wilder_rsi(lv: pd.Series, period: int) -> pd.Series:
    d = lv.diff()
    gain = d.clip(lower=0).ewm(alpha=1 / period, adjust=False).mean()
    loss = (-d.clip(upper=0)).ewm(alpha=1 / period, adjust=False).mean()
    return 100 - 100 / (1 + gain / loss)


def _series(level: pd.Series, frac: pd.Series, s: Surge) -> dict[str, pd.Series]:
    idx = level.index
    lv = level.dropna()
    r = lv.pct_change()
    m = s.magnitude
    sd = r.rolling(m.std_window, min_periods=m.std_min).std().shift(m.window)
    z = (lv / lv.shift(m.window) - 1) / (sd * np.sqrt(m.window))

    ema = lv.ewm(span=s.ema, adjust=False).mean()
    slope = (ema / ema.shift(1) - 1) * 100
    acc = slope - slope.shift(s.accel_lag)
    rank = pd.Series(
        _trailing_rank(acc.to_numpy(), s.accel.quantile_window, s.accel.quantile_min), index=lv.index
    )

    p = s.rsi
    rsi = _wilder_rsi(lv, p.period)
    cross = (rsi.shift(1) < p.cross) & (rsi >= p.cross)
    recent = cross.astype(int).rolling(p.within, min_periods=1).max() > 0
    rsi_on = recent & (rsi >= p.cross) & (rsi <= p.overheated)

    hw = s.event.high_window
    high = lv >= lv.rolling(hw, min_periods=hw).max() - _TOL

    frac = frac.reindex(idx)
    floats = dict(magnitude_z=z, accel_pct=acc, accel_rank=rank, rsi=rsi, ema=ema)
    out = {k: v.reindex(idx) for k, v in floats.items()}
    flags = dict(
        magnitude_on=z >= m.z - _TOL,
        accel_on=rank >= s.accel.rank,
        rsi_on=rsi_on,
        overheated=rsi > p.overheated,
        high_new=high,
    )
    out.update({k: v.reindex(idx, fill_value=False).astype(bool) for k, v in flags.items()})
    out["breadth_pct"] = frac * 100
    out["breadth_on"] = (frac >= s.breadth.min_pct / 100 - _TOL) & level.notna()
    out["on"] = out["magnitude_on"] & out["accel_on"] & out["breadth_on"] & out["rsi_on"]
    return out


def _breadth(r5: pd.DataFrame, members: list[str]) -> pd.Series:
    x = r5[members]
    return (x > 0).sum(axis=1) / x.notna().sum(axis=1).replace(0, np.nan)


def surge_components(
    levels: pd.DataFrame,
    closes: pd.DataFrame,
    shares: Mapping[str, float],
    themes: Mapping[str, str],
    sox: pd.Series,
    rules: RiskRules,
) -> SurgeComponents:
    """Components for every trigger theme (has a level, not excluded) and ^SOX.

    Breadth counts members with a close column and a share count, the same members the
    theme index uses; ^SOX breadth uses the union of the semis themes' members.
    """
    s = rules.surge
    idx = levels.index
    r5 = closes.reindex(idx)
    r5 = r5 / r5.shift(s.breadth.window) - 1
    members = _members_by_theme(closes, shares, themes)
    trigger = [t for t in levels.columns if t not in rules.excluded_themes and levels[t].notna().any()]
    semis = sorted({t for th in rules.semis_themes for t in members.get(th, [])})

    per = {t: _series(levels[t], _breadth(r5, members.get(t, [])), s) for t in trigger}
    per[SOX] = _series(sox.reindex(idx), _breadth(r5, semis), s)
    fields = {
        f: pd.DataFrame({name: out[f] for name, out in per.items()}, index=idx)
        for f in SurgeComponents.__dataclass_fields__
    }
    return SurgeComponents(**fields)
