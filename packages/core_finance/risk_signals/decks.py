"""Crash deck, risk-candidate deck and forward outcomes after an alert.

Pure pandas: no DB, no network. Inputs are wide frames, index = trading dates,
columns = tickers, NaN where a ticker has no bar. Percent outputs are percent
numbers and unrounded (-18.6 means -18.6%).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Mapping, Sequence

import numpy as np
import pandas as pd

from .config import RiskRules

SOX = "^SOX"
_MIN_CORR_PAIRS = 40
_USEFUL_ROWS = 10
_USEFUL_DD_PCT = -5.0


@dataclass(frozen=True)
class CrashCard:
    ticker: str
    drawdown_pct: float
    high_date: date
    high_close: float
    close: float
    closes_30d: list[float]


@dataclass(frozen=True)
class CandidateCard:
    ticker: str
    pct_from_high63: float
    corr: float
    corr_with: str


def _upto(obj, day: date):
    return obj.loc[: pd.Timestamp(day)]


def _full_window(closes: pd.DataFrame, window: int) -> pd.DataFrame:
    """Last `window` rows, only the tickers with no gap in them."""
    tail = closes.iloc[-window:]
    if len(tail) < window:
        return tail.iloc[:, :0]
    return tail.loc[:, tail.notna().all()]


def crash_deck(closes: pd.DataFrame, day: date, rules: RiskRules) -> list[CrashCard]:
    """Tickers whose close is at least drop_pct below their window high (day included)."""
    upto = _upto(closes, day)
    win = _full_window(upto, rules.crash_deck.window)
    if win.empty:
        return []
    cards: list[CrashCard] = []
    limit = 1 - rules.crash_deck.drop_pct / 100
    for ticker in win.columns:
        col = win[ticker]
        high, close = float(col.max()), float(col.iloc[-1])
        if close > limit * high:
            continue
        # latest date on ties
        high_ts = col[col == high].index[-1]
        cards.append(
            CrashCard(
                ticker=ticker,
                drawdown_pct=(close / high - 1) * 100,
                high_date=high_ts.date(),
                high_close=high,
                close=close,
                closes_30d=[float(x) for x in upto[ticker].dropna().iloc[-30:]],
            )
        )
    return sorted(cards, key=lambda c: (c.drawdown_pct, c.ticker))


def candidates(
    closes: pd.DataFrame, sox: pd.Series, day: date, rules: RiskRules
) -> list[CandidateCard]:
    """Names still near their high that move with ^SOX or with already-crashed names."""
    cfg = rules.candidates
    upto = _upto(closes, day)
    win = _full_window(upto, cfg.high_window)
    if win.empty:
        return []
    high = win.max()
    last = win.iloc[-1]
    near = last >= (1 - cfg.within_high_pct / 100) * high
    crashed = last <= (1 - cfg.crashed_drop_pct / 100) * high

    rets = (upto / upto.shift(1) - 1).iloc[-cfg.corr_window :]
    sox_ret = _upto(sox, day).reindex(upto.index)
    rets_sox = (sox_ret / sox_ret.shift(1) - 1).iloc[-cfg.corr_window :]

    out: list[CandidateCard] = []
    for ticker in win.columns[near.to_numpy()]:
        partners: list[tuple[str, pd.Series]] = [(SOX, rets_sox)]
        partners += [(p, rets[p]) for p in win.columns[crashed.to_numpy()] if p != ticker]
        best: tuple[float, str] | None = None
        for name, series in partners:
            pair = pd.concat([rets[ticker], series], axis=1).dropna()
            if len(pair) < _MIN_CORR_PAIRS:
                continue
            corr = pair.iloc[:, 0].corr(pair.iloc[:, 1])
            if np.isnan(corr):
                continue
            if best is None or corr > best[0]:
                best = (float(corr), name)
        if best is not None and best[0] >= cfg.corr_min:
            out.append(
                CandidateCard(
                    ticker=ticker,
                    pct_from_high63=(float(last[ticker]) / float(high[ticker]) - 1) * 100,
                    corr=best[0],
                    corr_with=best[1],
                )
            )
    return sorted(out, key=lambda c: (-c.corr, c.ticker))


def _base_and_window(level: pd.Series, day: date) -> tuple[float, np.ndarray, int] | None:
    """(day close, values array, position of day), or None if day is absent or NaN."""
    ts = pd.Timestamp(day)
    if ts not in level.index:
        return None
    pos = level.index.get_loc(ts)
    v = level.to_numpy(dtype=float)
    if np.isnan(v[pos]):
        return None
    return float(v[pos]), v, pos


def forward_returns(
    level: pd.Series, day: date, horizons: Sequence[int] = (5, 10, 20)
) -> dict[str, float | None]:
    """Percent change from day's close to the close h calendar rows later, plus max_dd10.

    Rows are positions in the series after day. fwd<h> is None if that row is NaN
    or beyond the data. max_dd10 is the lowest non-NaN close among the next 10 rows
    relative to day's close, capped at 0 (None if there is none). All None if day
    is absent from the index or its close is NaN.
    """
    found = _base_and_window(level, day)
    if found is None:
        return {**{f"fwd{h}": None for h in horizons}, "max_dd10": None}
    base, v, pos = found
    res: dict[str, float | None] = {}
    for h in horizons:
        ok = pos + h < len(v) and not np.isnan(v[pos + h])
        res[f"fwd{h}"] = (float(v[pos + h]) - base) / base * 100 if ok else None
    win = v[pos + 1 : pos + 1 + 10]
    win = win[~np.isnan(win)]
    res["max_dd10"] = min((float(win.min()) - base) / base * 100, 0.0) if len(win) else None
    return res


def primary_theme(trigger: Sequence[str], dd_on_start: Mapping[str, float]) -> str:
    """The trigger theme with the deepest drawdown; ties go to the lower theme id."""
    return min(trigger, key=lambda t: (dd_on_start[t], t))


def is_useful(trigger: Sequence[str], levels: pd.DataFrame, start: date) -> bool | None:
    """True if any trigger theme fell 5% or more within 10 rows; None if still undecided."""
    undecided = False
    for theme in trigger:
        found = _base_and_window(levels[theme], start)
        if found is None:
            undecided = True
            continue
        _, v, pos = found
        dd = forward_returns(levels[theme], start)["max_dd10"]
        if dd is not None and dd <= _USEFUL_DD_PCT:
            return True
        win = v[pos + 1 : pos + 1 + _USEFUL_ROWS]
        if int((~np.isnan(win)).sum()) < _USEFUL_ROWS:
            undecided = True
    return None if undecided else False
