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

from apps.api.models.schemas import APIResponse, NewsArticle
from apps.api.models.schema_parts.news import (
    BulkNewsResponse,
    NewsAcquireRequest,
    NewsAcquireResponse,
    NewsDailyStatus,
    NewsHistoryRequest,
    NewsHistoryResponse,
    NewsStatusResponse,
)
from apps.api.services.acquisition.freshness import needs_acquisition
from apps.api.services.acquisition.registry import get_data_class
from apps.api.services.acquisition.runner import acquire_point_in_time
from apps.api.services.acquisition.sources.news import fetch_news
from apps.api.services.acquisition.state import read_state
from apps.api.services.acquisition.store import news_coverage, save_news
from apps.api.services.db import get_db
from apps.api.services.news_feed import NewsBlocked, get_pacer
from apps.api.services.news_feed.daily import _done_key, _mark, session_day
from apps.api.services.news_feed.history import search_history
from apps.api.services.news_service import NewsService
from apps.api.services.risk import store

router = APIRouter()
_svc   = NewsService()

MAX_ACQUIRE_TICKERS = 100


def _blocked_http(error: NewsBlocked) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={"code": "news_blocked", "reason": error.reason, "retry_after": error.retry_after.isoformat()},
    )


@router.get("/feed", response_model=List[NewsArticle])
def get_news_feed(
    ticker:  Optional[str] = Query(default=None),
    q:       Optional[str] = Query(default=None, description="keyword search"),
    limit:   int           = Query(default=20, ge=1, le=100),
    offset:  int           = Query(default=0, ge=0),
    from_:   Optional[str] = Query(default=None, alias="from", pattern=r"^\d{4}-\d{2}-\d{2}$"),
    to:      Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
):
    """Return news articles filtered by ticker or keyword; from/to bound the day when ticker is set."""
    return _svc.get_news(ticker=ticker, limit=limit, keyword=q, offset=offset, from_date=from_, to_date=to)


@router.get("/feed/bulk", response_model=APIResponse[BulkNewsResponse])
def get_news_feed_bulk(
    tickers: str = Query(..., description="comma-separated tickers"),
    per_ticker: int = Query(default=3, ge=1, le=20),
):
    """One request for the whole tile grid, with acquisition state per ticker."""
    requested = [part for part in tickers.split(",") if part.strip()]
    if not requested:
        raise HTTPException(status_code=400, detail="tickers is required")
    if len(requested) > MAX_ACQUIRE_TICKERS:
        raise HTTPException(status_code=400,
                            detail=f"at most {MAX_ACQUIRE_TICKERS} tickers per request")
    return APIResponse(data=BulkNewsResponse(tickers=_svc.get_news_bulk(requested, per_ticker=per_ticker)))


@router.post("/history", response_model=APIResponse[NewsHistoryResponse])
def search_news_history(request: NewsHistoryRequest):
    """Search Google News for the five days around a date. Synchronous: the pacer wait happens here."""
    names = _watchlist_names()
    ticker = request.ticker.upper().strip()
    if ticker not in names:
        raise HTTPException(status_code=404, detail=f"{ticker} is not in the watchlist")
    return APIResponse(data=search_history(ticker, request.date, now=datetime.now(timezone.utc), names=names))


@router.get("/status", response_model=APIResponse[NewsStatusResponse])
def get_news_status():
    """Google block state, today's request count and the daily sweep progress."""
    pacer = get_pacer().status()
    day = session_day(datetime.now(timezone.utc))
    tickers = list(_watchlist_names())
    done = sum(1 for t in tickers if store.get_state(_mark(day, t)) is not None)
    remaining = len(tickers) - done
    return APIResponse(data=NewsStatusResponse(
        blocked_until=pacer.blocked_until,
        blocked_reason=pacer.blocked_reason,
        requests_today=pacer.requests_today,
        daily_cap=pacer.daily_cap,
        daily=NewsDailyStatus(
            session_day=day,
            done=done,
            remaining=remaining,
            # A ticker added after the day was flagged done is still to sweep.
            complete=store.get_state(_done_key(day)) is not None and remaining == 0,
        ),
    ))


@router.post("/crawl", response_model=List[NewsArticle])
def crawl_news(
    query:  str           = Query(...),
    ticker: Optional[str] = Query(default=None),
    limit:  int           = Query(default=10),
):
    """Trigger a live crawl and persist results."""
    try:
        return _svc.crawl_and_save(query=query, ticker=ticker, limit=limit)
    except NewsBlocked as error:
        raise _blocked_http(error)


@router.post("/crawl/stock", response_model=List[NewsArticle])
def crawl_stock_news(
    ticker: str = Query(...),
    company_name: str = Query(default=""),
    limit: int = Query(default=10, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
):
    """Trigger stock-specific news crawl and persist results."""
    try:
        return _svc.crawl_stock_and_save(ticker=ticker, company_name=company_name, limit=limit, offset=offset)
    except NewsBlocked as error:
        raise _blocked_http(error)


def _watchlist_names() -> dict[str, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT ticker, name FROM watchlist").fetchall()
    return {str(row["ticker"]).upper(): str(row["name"] or "") for row in rows}


def _blocked_result(ticker: str, error: NewsBlocked) -> dict:
    return {"ticker": ticker, "status": "failed", "articles": 0,
            "detail": f"blocked until {error.retry_after.isoformat()}"}


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
    # Set by the first NewsBlocked: the pacer refuses every request until its retry time,
    # so the rest of the batch is reported failed without calling the fetcher.
    blocked: NewsBlocked | None = None

    for raw in tickers:
        ticker = str(raw).upper().strip()
        if not ticker or ticker in seen or ticker not in names:
            continue
        seen.add(ticker)
        company_name = names[ticker]
        if blocked is not None:
            # No request is possible, but a ticker the boundary already covers needs none.
            if needs_acquisition(read_state("news", ticker), get_data_class("news").boundary, now):
                results.append(_blocked_result(ticker, blocked))
            else:
                results.append({"ticker": ticker, "status": "fresh", "articles": 0, "detail": None})
            continue

        try:
            # A block reaches here without a recorded check: nothing was sent.
            outcome = acquire_point_in_time(
                "news",
                ticker,
                now=now,
                fetcher=lambda subject, _company=company_name: fetcher(subject, company_name=_company),
                saver=save_news,
                coverage=news_coverage,
            )
        except NewsBlocked as error:
            blocked = error
            results.append(_blocked_result(ticker, blocked))
            continue
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
    # Deliberately on the raw request size, not the deduped/known count: this is a cheap
    # pre-guard ahead of the watchlist query below. A post-dedupe cap was considered and
    # rejected -- the frontend already sends a unique-by-ticker list, so it buys no real
    # protection while letting an oversized raw payload reach the DB first.
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
