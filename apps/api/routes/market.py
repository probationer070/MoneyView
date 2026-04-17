"""
Market routes — Tab 2: Market Overview.

GET /api/market/indices          → all index summary cards
GET /api/market/index/{ticker}   → single index OHLCV history
"""

from fastapi import APIRouter, Query
from typing import List

from apps.api.models.schemas import IndexQuote, MarketIndexDetail, StockOHLCV
from apps.api.services.market_data import MarketDataService

router = APIRouter()
_svc   = MarketDataService()


@router.get("/indices", response_model=List[IndexQuote])
async def get_all_indices():
    """
    Return summary cards for all 9 market indices.
    Each card includes: name, ticker, last_close, delta badge, 30-day sparkline.
    """
    return _svc.get_all_indices()


@router.get("/index/{ticker}", response_model=List[StockOHLCV])
async def get_index_history(
    ticker: str,
    period: str = Query(default="5y", description="1w | 1mo | 3mo | 6mo | 1y | 2y | 5y"),
):
    """Return full OHLCV history for a single market index."""
    return _svc.get_stock_ohlcv(ticker, period=period, table="indices")


@router.get("/index/{ticker}/detail", response_model=MarketIndexDetail)
async def get_index_detail(
    ticker: str,
    period: str = Query(default="5y", description="1w | 1mo | 3mo | 6mo | 1y | 2y | 5y"),
):
    """Return expanded Market Overview detail including daily volume plus daily and monthly indicators."""
    return _svc.get_index_detail(ticker, period=period)
