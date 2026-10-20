"""Daily top movers by one-day return (spec §4). Pure pandas: no DB, no network."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from .config import RiskRules
from .surge import _wilder_rsi


@dataclass(frozen=True)
class Mover:
    rank: int  # 1 = largest one-day return
    ticker: str
    return_pct: float  # close(day) / close(previous calendar row) - 1, in percent
    close: float
    return5_pct: float | None  # over surge.magnitude.window valid rows; None with fewer
    rsi: float | None  # Wilder RSI on the ticker's own closes up to the day; None before it exists


def top_movers(closes: pd.DataFrame, day: date, rules: RiskRules) -> list[Mover]:
    """The ``movers.count`` largest one-day returns on ``day`` among tickers with a close on that
    day and on the previous row of ``closes``. Ties go to the alphabetically first ticker.
    ``closes`` is watchlist tickers only (no benchmarks); fewer qualifying tickers give a
    shorter list, never padding."""
    count, rows, period = rules.movers.count, rules.surge.magnitude.window, rules.surge.rsi.period
    i = closes.index.get_loc(pd.Timestamp(day))
    if i == 0:
        return []
    now, prev = closes.iloc[i], closes.iloc[i - 1]
    r = (now / prev - 1).dropna()
    ranked = sorted(r.items(), key=lambda kv: (-kv[1], kv[0]))[:count]
    out = []
    for rank, (ticker, ret) in enumerate(ranked, start=1):
        s = closes[ticker].iloc[: i + 1].dropna()
        r5 = float(s.iloc[-1] / s.iloc[-1 - rows] - 1) * 100 if len(s) > rows else None
        rsi = float(_wilder_rsi(s, period).iloc[-1])
        out.append(Mover(rank, str(ticker), float(ret) * 100, float(now[ticker]), r5, None if np.isnan(rsi) else rsi))
    return out
