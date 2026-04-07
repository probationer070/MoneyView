"""
Portfolio routes — Tab 3: Portfolio View.

GET  /api/portfolio/watchlist           → all watchlist items with spark + delta
GET  /api/portfolio/stock/{ticker}      → detailed stock data
POST /api/portfolio/watchlist           → add / update watchlist entry
"""

import json
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Body

from apps.api.models.schemas import (
    APIResponse,
    AttributionRequest,
    AttributionResult,
    DeltaBadge,
    PortfolioStock,
    StockOHLCV,
    WatchlistItem,
)
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
from apps.api.services.news_service import NewsService
from apps.api.services.portfolio_service import PortfolioAnalyticsService

_API_ROOT = Path(__file__).resolve().parents[1]
_WATCHLIST_JSON = _API_ROOT / "services" / "webscrap" / "stock_targets.json"
router = APIRouter()
_mkt   = MarketDataService()
_news  = NewsService()
_portfolio_analytics = PortfolioAnalyticsService(_mkt)


def _load_watchlist_from_json() -> List[WatchlistItem]:
    """Fallback: read stock_targets.json if DB watchlist is empty."""
    if not _WATCHLIST_JSON.exists():
        return []
    try:
        data = json.loads(_WATCHLIST_JSON.read_text(encoding="utf-8"))
        items = []
        for group_name, group in data.items():
            for t in group.get("targets", []):
                items.append(WatchlistItem(
                    ticker=t.get("ticker", ""),
                    name=t.get("name", t.get("ticker", "")),
                    sector=t.get("sector", ""),
                    group_name=group_name,
                ))
        return items
    except Exception:
        return []


def _sync_watchlist_to_db(items: List[WatchlistItem]) -> None:
    with get_db() as conn:
        for item in items:
            conn.execute(
                """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name)
                   VALUES (?, ?, ?, ?)""",
                (item.ticker, item.name, item.sector, item.group_name),
            )


@router.get("/watchlist", response_model=List[PortfolioStock])
async def get_watchlist():
    """
    Return all watchlist stocks with latest close, delta badge, and sparkline.
    Seeds from stock_targets.json on first run.
    """
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM watchlist ORDER BY group_name, ticker").fetchall()

    if not rows:
        items = _load_watchlist_from_json()
        _sync_watchlist_to_db(items)
        rows_fresh = []
        with get_db() as conn:
            rows_fresh = conn.execute("SELECT * FROM watchlist").fetchall()
        rows = rows_fresh

    result: List[PortfolioStock] = []
    for r in rows:
        ticker = r["ticker"]
        bars   = _mkt.get_stock_ohlcv(ticker, period="1mo")
        if len(bars) < 2:
            continue
        last   = bars[-1].close
        prev   = bars[-2].close
        result.append(PortfolioStock(
            ticker=ticker,
            name=r["name"] or ticker,
            sector=r["sector"] or "",
            group_name=r["group_name"] or "custom",
            last_close=last,
            delta=DeltaBadge.compute(last, prev),
            sparkline=[b.close for b in bars[-20:]],
        ))
    return result


@router.get("/stock/{ticker}", response_model=dict)
async def get_stock_detail(ticker: str, period: str = "1y"):
    """Return prices + recent news for a single stock."""
    bars  = _mkt.get_stock_ohlcv(ticker.upper(), period=period)
    news  = _news.get_news(ticker=ticker.upper(), limit=10)
    return {
        "ticker": ticker.upper(),
        "prices": [b.model_dump() for b in bars],
        "news":   [n.model_dump() for n in news],
    }


@router.post("/watchlist", response_model=WatchlistItem)
async def upsert_watchlist_item(item: WatchlistItem = Body(...)):
    """Add or update a watchlist entry."""
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO watchlist (ticker, name, sector, group_name)
               VALUES (?, ?, ?, ?)""",
            (item.ticker.upper(), item.name, item.sector, item.group_name),
        )
    return item


@router.post("/attribution", response_model=APIResponse[AttributionResult])
async def get_portfolio_attribution(payload: AttributionRequest = Body(...)):
    """
    Portfolio-level arithmetic Brinson-Fachler attribution.

    Returns domain schemas only (totals/effects/sector breakdown/risk/metadata)
    and intentionally avoids chart-library-specific payload shaping.
    """
    try:
        result = _portfolio_analytics.build_attribution(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=result)
