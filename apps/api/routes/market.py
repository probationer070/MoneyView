"""
Market routes — Tab 2: Market Overview.

GET /api/market/indices          → all index summary cards
GET /api/market/index/{ticker}   → single index OHLCV history
GET /api/market/events           → dated events drawn as vertical lines on price charts
"""

from fastapi import APIRouter, Query
from typing import List

from apps.api.models.schemas import IndexQuote, MarketEvent, MarketIndexDetail, StockOHLCV
from apps.api.services.market_data import MarketDataService
from apps.api.services.market_events import load_market_events

router = APIRouter()
_svc   = MarketDataService()


@router.get("/events", response_model=List[MarketEvent])
def get_market_events():
    """Return the committed market events charts draw as vertical lines.

    Read from a committed JSON file on every request rather than a table: the events are
    asserted facts that travel with the repository, so every machine has the same ones after
    a pull and there is nothing to seed or merge.
    """
    return load_market_events()


@router.get("/indices", response_model=List[IndexQuote])
def get_all_indices():
    """
    Return summary cards for all 9 market indices.
    Each card includes: name, ticker, last_close, delta badge, 30-day sparkline.
    """
    return _svc.get_all_indices()


@router.get("/index/{ticker}", response_model=List[StockOHLCV])
def get_index_history(
    ticker: str,
    period: str = Query(default="5y", description="1w | 1mo | 3mo | 6mo | 1y | 2y | 5y"),
):
    """Return full OHLCV history for a single market index."""
    return _svc.get_stock_ohlcv(ticker, period=period, table="indices")


@router.get("/index/{ticker}/detail", response_model=MarketIndexDetail)
def get_index_detail(
    ticker: str,
    period: str = Query(default="5y", description="1w | 1mo | 3mo | 6mo | 1y | 2y | 5y"),
):
    """Return expanded Market Overview detail including daily volume plus daily and monthly indicators."""
    return _svc.get_index_detail(ticker, period=period)
