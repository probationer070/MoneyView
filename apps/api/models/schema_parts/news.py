from __future__ import annotations

from typing import List, Optional

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
