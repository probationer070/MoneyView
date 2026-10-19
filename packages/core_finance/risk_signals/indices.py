"""Cap-weighted theme indices and the price shapes the alert lifecycle reads.

Pure pandas: no DB, no network. Inputs are wide frames, index = trading dates,
columns = tickers, NaN where a ticker has no bar.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd

_LOW_TOLERANCE = 1e-12


def _members_by_theme(
    closes: pd.DataFrame, shares: Mapping[str, float], themes: Mapping[str, str]
) -> dict[str, list[str]]:
    """Theme id -> tickers that have a close column and a share count."""
    out: dict[str, list[str]] = {}
    for ticker in closes.columns:
        theme = themes.get(ticker)
        if theme is None or pd.isna(shares.get(ticker)):
            continue
        out.setdefault(theme, []).append(ticker)
    return out


def _share_series(closes: pd.DataFrame, shares: Mapping[str, float]) -> pd.Series:
    return pd.Series({t: shares.get(t) for t in closes.columns}, dtype=float)


def theme_indices(
    closes: pd.DataFrame,
    shares: Mapping[str, float],
    themes: Mapping[str, str],
    min_members: int,
) -> pd.DataFrame:
    """Chain-linked cap-weighted index per theme, 100.0 on its first valid day.

    The day-t return is the average of member returns weighted by share * close(t-1),
    over members with closes on both t-1 and t, so entries, exits and splits never
    move the level. Days with fewer than ``min_members`` such members are NaN and the
    return across the gap is skipped: the level resumes from the last valid one.
    Themes with no member that has shares are omitted.
    """
    returns = closes.pct_change(fill_method=None)
    prev_cap = closes.shift(1) * _share_series(closes, shares)
    levels: dict[str, pd.Series] = {}
    for theme, members in _members_by_theme(closes, shares, themes).items():
        r = returns[members]
        w = prev_cap[members].where(r.notna())
        enough = (r.notna().sum(axis=1) >= min_members).to_numpy()
        day_return = ((w * r).sum(axis=1) / w.sum(axis=1)).to_numpy()
        level = np.full(len(closes), np.nan)
        current = None
        for i, ok in enumerate(enough):
            if not ok:
                continue
            current = 100.0 if current is None else current * (1.0 + day_return[i])
            level[i] = current
        levels[theme] = pd.Series(level, index=closes.index)
    return pd.DataFrame(levels, index=closes.index)


def theme_cap_share(
    closes: pd.DataFrame, shares: Mapping[str, float], themes: Mapping[str, str]
) -> pd.DataFrame:
    """Each theme's cap (share * close that day) over the total cap of every ticker
    with shares and a close that day. Excluded themes stay in the denominator.
    Days with no cap give 0.0."""
    caps = closes * _share_series(closes, shares)
    total = caps.sum(axis=1, min_count=1)
    theme_caps = {
        theme: caps[members].sum(axis=1)
        for theme, members in _members_by_theme(closes, shares, themes).items()
    }
    return pd.DataFrame(theme_caps, index=closes.index).div(total, axis=0).fillna(0.0)


@dataclass(frozen=True)
class Shapes:
    dd: pd.Series  # fraction <= 0 versus the rolling max (including the day); NaN until window valid rows
    down: pd.Series  # int, consecutive down closes ending that day
    new_low: pd.Series  # bool, close <= rolling min
    valid: pd.Series  # bool, level is not NaN


def price_shapes(level: pd.Series, window: int) -> Shapes:
    """Drawdown, down-run and new-low shapes of a level series.

    Rolling max/min need ``window`` consecutive non-NaN rows, so dd is NaN and new_low
    False until then, and again after any gap until ``window`` rows have refilled.
    A NaN diff (first row, or either side missing) resets the down run to 0.
    """
    rolling = level.rolling(window, min_periods=window)
    dd = level / rolling.max() - 1.0
    new_low = level <= rolling.min() + _LOW_TOLERANCE
    down = np.zeros(len(level), dtype=int)
    run = 0
    for i, is_down in enumerate((level.diff() < 0).to_numpy()):
        run = run + 1 if is_down else 0
        down[i] = run
    return Shapes(
        dd=dd,
        down=pd.Series(down, index=level.index),
        new_low=new_low,
        valid=level.notna(),
    )
