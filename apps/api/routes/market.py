"""
Market routes — Tab 2: Market Overview.

GET /api/market/indices          → all index summary cards
GET /api/market/index/{ticker}   → single index OHLCV history
GET /api/market/events           → dated events drawn as vertical lines on price charts
GET /api/market/event-categories → resolved event categories (colour, visibility)
GET /api/market/spreads            → theme and policy relative-strength spreads
POST   /api/market/events                        → create a user event
PUT    /api/market/events/{id}                    → edit a user event
DELETE /api/market/events/{id}                    → delete a user event
POST   /api/market/event-categories               → create a user category
PATCH  /api/market/event-categories/{id}           → edit a category or its visibility
DELETE /api/market/event-categories/{id}/override → restore a built-in category's file defaults
DELETE /api/market/event-categories/{id}           → delete a user category
"""

from contextlib import contextmanager
from typing import List, Optional

from fastapi import APIRouter, Body, HTTPException, Query, Response

from apps.api.models.schemas import (
    EventCategory,
    EventCategoryInput,
    EventCategoryPatch,
    IndexQuote,
    MarketEvent,
    MarketEventInput,
    MarketIndexDetail,
    MarketSpread,
    StockOHLCV,
)
from apps.api.services.events import EventDataError, default_registry, resolved_categories
from apps.api.services.events import service as event_service
from apps.api.services.events.validation import parse_iso_date
from apps.api.services.market_data import MarketDataService
from apps.api.services.market_spreads import build_spreads
from apps.api.services.records_sync import service as records_sync

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
    records_sync.run_records_sync("read")
    return default_registry().events(start_day, end_day)


@router.get("/event-categories", response_model=List[EventCategory])
def get_event_categories():
    """Categories after resolution: file defaults, saved overrides, user categories, visibility."""
    records_sync.run_records_sync("read")
    return list(resolved_categories().values())


@contextmanager
def _event_errors():
    try:
        yield
    except event_service.EventNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except event_service.EventConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except EventDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/events", response_model=MarketEvent, status_code=201)
def create_market_event(payload: MarketEventInput = Body(...)):
    with _event_errors():
        created = event_service.create_user_event(payload)
    records_sync.run_records_sync("mutation")
    return created


@router.put("/events/{event_id}", response_model=MarketEvent)
def update_market_event(event_id: str, payload: MarketEventInput = Body(...)):
    with _event_errors():
        updated = event_service.update_user_event(event_id, payload)
    records_sync.run_records_sync("mutation")
    return updated


@router.delete("/events/{event_id}", status_code=204)
def delete_market_event(event_id: str):
    with _event_errors():
        event_service.delete_user_event(event_id)
    records_sync.run_records_sync("mutation")
    return Response(status_code=204)


@router.post("/event-categories", response_model=EventCategory, status_code=201)
def create_event_category(payload: EventCategoryInput = Body(...)):
    with _event_errors():
        created = event_service.create_user_category(payload)
    records_sync.run_records_sync("mutation")
    return created


@router.patch("/event-categories/{category_id}", response_model=EventCategory)
def patch_event_category(category_id: str, patch: EventCategoryPatch = Body(...)):
    with _event_errors():
        patched = event_service.patch_category(category_id, patch)
    records_sync.run_records_sync("mutation")
    return patched


@router.delete("/event-categories/{category_id}/override", status_code=204)
def reset_event_category(category_id: str):
    """Restore a built-in category's file label and colour. Visibility is a preference and stays."""
    with _event_errors():
        event_service.reset_category(category_id)
    records_sync.run_records_sync("mutation")
    return Response(status_code=204)


@router.delete("/event-categories/{category_id}", status_code=204)
def delete_event_category(category_id: str):
    with _event_errors():
        event_service.delete_user_category(category_id)
    records_sync.run_records_sync("mutation")
    return Response(status_code=204)


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
