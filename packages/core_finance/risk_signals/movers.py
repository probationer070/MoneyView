"""Daily top movers by one-day return (spec §4). Pure pandas: no DB, no network."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np
import pandas as pd

from .surge import _wilder_rsi

RSI_PERIOD = 14  # spec §4 "RSI": Wilder 14, the same as the surge RSI
RETURN_ROWS = 5  # spec §4 "5거래일 수익률", counted on the ticker's own valid rows


@dataclass(frozen=True)
class Mover:
    rank: int  # 1 = largest one-day return
    ticker: str
    return_pct: float  # close(day) / close(previous calendar row) - 1, in percent
    close: float
    return5_pct: float | None  # over RETURN_ROWS valid rows; None with fewer
    rsi: float | None  # Wilder RSI on the ticker's own closes up to the day; None before it exists


def top_movers(closes: pd.DataFrame, day: date, count: int) -> list[Mover]:
    """The ``count`` largest one-day returns on ``day`` among tickers with a close on that
    day and on the previous row of ``closes``. Ties go to the alphabetically first ticker.
    ``closes`` is watchlist tickers only (no benchmarks); fewer qualifying tickers give a
    shorter list, never padding."""
    i = closes.index.get_loc(pd.Timestamp(day))
    if i == 0:
        return []
    now, prev = closes.iloc[i], closes.iloc[i - 1]
    r = (now / prev - 1).dropna()
    ranked = sorted(r.items(), key=lambda kv: (-kv[1], kv[0]))[:count]
    out = []
    for rank, (ticker, ret) in enumerate(ranked, start=1):
        s = closes[ticker].iloc[: i + 1].dropna()
        r5 = float(s.iloc[-1] / s.iloc[-1 - RETURN_ROWS] - 1) * 100 if len(s) > RETURN_ROWS else None
        rsi = float(_wilder_rsi(s, RSI_PERIOD).iloc[-1])
        out.append(Mover(rank, str(ticker), float(ret) * 100, float(now[ticker]), r5, None if np.isnan(rsi) else rsi))
    return out
