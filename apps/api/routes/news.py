"""
News routes.

GET /api/news/feed?ticker=AAPL&q=keyword&limit=20
POST /api/news/crawl
POST /api/news/acquire
"""

import asyncio
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from apps.api.models.schemas import NewsArticle
from apps.api.models.schema_parts.news import NewsAcquireRequest, NewsAcquireResponse
from apps.api.services.acquisition.runner import acquire_point_in_time
from apps.api.services.acquisition.sources.news import fetch_news
from apps.api.services.acquisition.state import read_state
from apps.api.services.acquisition.store import news_coverage, save_news
from apps.api.services.db import get_db
from apps.api.services.news_service import NewsService

router = APIRouter()
_svc   = NewsService()

MAX_ACQUIRE_TICKERS = 100


@router.get("/feed", response_model=List[NewsArticle])
async def get_news_feed(
    ticker:  Optional[str] = Query(default=None),
    q:       Optional[str] = Query(default=None, description="keyword search"),
    limit:   int           = Query(default=20, ge=1, le=100),
    offset:  int           = Query(default=0, ge=0),
):
    """Return news articles filtered by ticker or keyword."""
    return _svc.get_news(ticker=ticker, limit=limit, keyword=q, offset=offset)


@router.post("/crawl", response_model=List[NewsArticle])
async def crawl_news(
    query:  str           = Query(...),
    ticker: Optional[str] = Query(default=None),
    limit:  int           = Query(default=10),
):
    """Trigger a live crawl and persist results."""
    return _svc.crawl_and_save(query=query, ticker=ticker, limit=limit)


@router.post("/crawl/stock", response_model=List[NewsArticle])
async def crawl_stock_news(
    ticker: str = Query(...),
    company_name: str = Query(default=""),
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
):
    """Trigger stock-specific news crawl and persist results."""
    return _svc.crawl_stock_and_save(ticker=ticker, company_name=company_name, limit=limit, offset=offset)


def _watchlist_names() -> dict[str, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT ticker, name FROM watchlist").fetchall()
    return {str(row["ticker"]).upper(): str(row["name"] or "") for row in rows}


def acquire_news_batch(tickers, *, now, fetcher=fetch_news) -> list[dict]:
    """Acquire news for each ticker in turn.

    Sequential by decision, not by omission. Measured 2026-07-31, one crawl is 0.8-1.0s,
    so twelve tiles is about eleven seconds -- acceptable behind a progress counter, and
    it matches the rest of the acquisition layer. A bounded pool would trade that known
    cost for an unmeasured rate-limit risk on an action the hourly boundary already caps
    at once per ticker per hour.
    """
    names = _watchlist_names()
    seen: set[str] = set()
    results: list[dict] = []

    for raw in tickers:
        ticker = str(raw).upper().strip()
        if not ticker or ticker in seen or ticker not in names:
            continue
        seen.add(ticker)
        company_name = names[ticker]
        outcome = acquire_point_in_time(
            "news",
            ticker,
            now=now,
            fetcher=lambda subject: fetcher(subject, company_name=company_name),
            saver=save_news,
            coverage=news_coverage,
        )
        results.append({
            "ticker": ticker,
            "status": outcome.reason,
            "articles": outcome.fetched_rows,
            "detail": read_state("news", ticker).detail if outcome.reason == "failed" else None,
        })
    return results


@router.post("/acquire", response_model=NewsAcquireResponse)
async def acquire_news(request: NewsAcquireRequest):
    """Refresh news for the given tickers, through the acquisition layer."""
    if len(request.tickers) > MAX_ACQUIRE_TICKERS:
        raise HTTPException(status_code=400,
                            detail=f"at most {MAX_ACQUIRE_TICKERS} tickers per request")

    names = _watchlist_names()
    requested = [str(t).upper().strip() for t in request.tickers if str(t).strip()]
    known = [t for t in requested if t in names]
    skipped = sorted({t for t in requested if t not in names})
    if not known:
        raise HTTPException(status_code=400, detail="no known tickers in request")

    # to_thread because the crawler blocks: ~11s on the event loop would stall every
    # other request. The worker cannot be cancelled once started, which is why the batch
    # continues server-side if the client navigates away.
    results = await asyncio.to_thread(
        acquire_news_batch, known, now=datetime.now(timezone.utc)
    )
    return NewsAcquireResponse(results=results, skipped_unknown=skipped)
