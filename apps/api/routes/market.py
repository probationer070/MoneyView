"""
Market routes — Tab 2: Market Overview.

GET /api/market/indices          → all index summary cards
GET /api/market/index/{ticker}   → single index OHLCV history
GET /api/market/events           → dated events drawn as vertical lines on price charts
GET /api/market/event-categories → resolved event categories (colour, visibility)
GET /api/market/spreads            → theme and policy relative-strength spreads
"""

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from apps.api.models.schemas import EventCategory, IndexQuote, MarketEvent, MarketIndexDetail, MarketSpread, StockOHLCV
from apps.api.services.events import EventDataError, default_registry, resolved_categories
from apps.api.services.events.validation import parse_iso_date
from apps.api.services.market_data import MarketDataService
from apps.api.services.market_spreads import build_spreads

router = APIRouter()
_svc   = MarketDataService()


@router.get("/spreads", response_model=List[MarketSpread])
def get_market_spreads(
    window_days: int = Query(default=90, ge=5, le=3650, description="Calendar days of history"),
):
    """Relative-strength spreads for the theme and policy pairs.

    `window_days` is CALENDAR days, not sessions. Each row reports the window it actually
    used alongside the one requested, so a short history is never presented as comparable
    to a full one.
    """
    return build_spreads(window_days)


@router.get("/events", response_model=List[MarketEvent])
def get_market_events(
    start: Optional[str] = Query(default=None, description="ISO date; events ending before it are left out"),
    end: Optional[str] = Query(default=None, description="ISO date; events starting after it are left out"),
):
    """Events from every registered source, with categories resolved.

    Built-in events are read from committed files on every request, so every machine has the
    same ones after a pull and there is nothing to seed.
    """
    try:
        start_day = parse_iso_date(start, what="start") if start else None
        end_day = parse_iso_date(end, what="end") if end else None
    except EventDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return default_registry().events(start_day, end_day)


@router.get("/event-categories", response_model=List[EventCategory])
def get_event_categories():
    """Categories after resolution: file defaults, saved overrides, user categories, visibility."""
    return list(resolved_categories().values())


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
