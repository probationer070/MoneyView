from __future__ import annotations

from datetime import date, datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field

from .common import SentimentEnum


class NewsArticle(BaseModel):
    """News article with a sentiment tag."""

    id: Optional[int] = None
    ticker: Optional[str] = None
    headline: str
    url: str = ""
    source: str = ""
    published_date: str = ""
    sentiment: SentimentEnum = SentimentEnum.neutral
    importance: int = 1
    lang: str = "en"
    topic: str = ""
    published_at: Optional[str] = None


HistoryStatus = Literal["searched_now", "cached", "blocked", "daily_limit", "failed"]


class NewsHistoryRequest(BaseModel):
    ticker: str
    date: date


class NewsHistoryLang(BaseModel):
    lang: str
    status: HistoryStatus
    found: int
    truncated: bool


class NewsHistoryResponse(BaseModel):
    ticker: str
    start: date
    end: date
    status: HistoryStatus
    retry_after: Optional[datetime] = None
    truncated: bool
    searched: List[NewsHistoryLang]
    articles: List[NewsArticle]


class NewsDailyStatus(BaseModel):
    session_day: Optional[date] = None
    done: int
    remaining: int
    complete: bool


class NewsStatusResponse(BaseModel):
    blocked_until: Optional[datetime] = None
    blocked_reason: Optional[str] = None
    requests_today: int
    daily_cap: int
    daily: NewsDailyStatus


class NewsAcquireRequest(BaseModel):
    tickers: List[str]


class NewsAcquireResult(BaseModel):
    ticker: str
    status: str          # acquired | fresh | empty | failed
    articles: int = 0
    detail: Optional[str] = None


class NewsAcquireResponse(BaseModel):
    results: List[NewsAcquireResult]
    skipped_unknown: List[str] = Field(default_factory=list)


class BulkNewsEntry(BaseModel):
    articles: List[NewsArticle]
    last_checked_at: Optional[str] = None


class BulkNewsResponse(BaseModel):
    tickers: Dict[str, BulkNewsEntry]


class TechnicalIndicators(BaseModel):
    """Computed technical indicators for a stock."""

    ticker: str
    rsi_14: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    bb_upper: Optional[float] = None
    bb_mid: Optional[float] = None
    bb_lower: Optional[float] = None
    ma_20: Optional[float] = None
    ma_50: Optional[float] = None
    ma_200: Optional[float] = None
    as_of_date: Optional[str] = None


class MonteCarloResult(BaseModel):
    """Monte Carlo simulation results."""

    ticker: str
    paths: int
    horizon_days: int
    p5: float
    p50: float
    p95: float
    current: float
    risk_score: str
    computed_by: str = "numpy"
