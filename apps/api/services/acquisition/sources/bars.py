"""Daily bar acquisition from yfinance, by explicit date range.

`ticker_factory` is injected so tests never make a network call. Concurrent live
fetching earned a Yahoo rate limit during sub-project 1 that invalidated a day of
measurements, so this is a hard rule, not a convenience.
"""
from __future__ import annotations

from datetime import date
from typing import Callable

from apps.api.core.logger import setup_logger
from apps.api.models.schemas import StockOHLCV
from apps.api.services.acquisition.ranges import FetchRange

logger = setup_logger(__name__)


def _default_ticker_factory(symbol: str):
    import yfinance as yf

    return yf.Ticker(symbol)


def fetch_bars(
    ticker: str,
    fetch_range: FetchRange,
    *,
    ticker_factory: Callable[[str], object] | None = None,
) -> list[StockOHLCV]:
    factory = ticker_factory or _default_ticker_factory
    frame = factory(ticker).history(
        start=fetch_range.start.isoformat(),
        end=fetch_range.end_exclusive.isoformat(),
        auto_adjust=True,
    )
    if frame is None or frame.empty:
        return []
    if "Date" not in frame.columns:
        frame = frame.reset_index()
    rows: list[StockOHLCV] = []
    for record in frame.to_dict("records"):
        raw_date = record.get("Date")
        rows.append(
            StockOHLCV(
                date=str(raw_date)[:10],
                open=float(record.get("Open") or 0),
                high=float(record.get("High") or 0),
                low=float(record.get("Low") or 0),
                close=float(record.get("Close") or 0),
                volume=int(record.get("Volume") or 0),
            )
        )
    return rows


def latest_action_date(
    ticker: str, *, ticker_factory: Callable[[str], object] | None = None
) -> date | None:
    """Most recent split or dividend, or None.

    yfinance returns auto-adjusted prices, and every split and dividend rewrites the
    adjustment factor retroactively. Appending deltas onto an adjusted series therefore
    mixes pre- and post-adjustment prices and silently corrupts returns, volatility and
    every DCF input built on them. It degrades gradually and looks like data, not like
    an error -- which is why it is detected explicitly rather than hoped about.
    """
    factory = ticker_factory or _default_ticker_factory
    actions = factory(ticker).actions
    if actions is None or actions.empty:
        return None
    return max(entry.date() for entry in actions.index.to_pydatetime())
