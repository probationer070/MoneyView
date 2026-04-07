"""
News routes.

GET /api/news/feed?ticker=AAPL&q=keyword&limit=20
POST /api/news/crawl
"""

from fastapi import APIRouter, Query
from typing import List, Optional

from apps.api.models.schemas import NewsArticle
from apps.api.services.news_service import NewsService

router = APIRouter()
_svc   = NewsService()


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
