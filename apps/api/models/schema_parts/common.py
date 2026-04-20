from __future__ import annotations

from enum import Enum
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class APIMeta(BaseModel):
    last_updated_at: str = ""
    request_id: str = ""


class APIResponse(BaseModel, Generic[T]):
    status: str = "ok"
    data: T
    meta: APIMeta = Field(default_factory=APIMeta)


class LogTailResponse(BaseModel):
    log_path: str
    line_count: int
    lines: list[str] = Field(default_factory=list)


class SentimentEnum(str, Enum):
    positive = "positive"
    neutral = "neutral"
    negative = "negative"


class PeriodEnum(str, Enum):
    one_week = "1w"
    one_month = "1mo"
    three_month = "3mo"
    six_month = "6mo"
    one_year = "1y"
    two_year = "2y"
    five_year = "5y"


class ComparisonUniverseEnum(str, Enum):
    portfolio_plus_benchmark = "portfolio_plus_benchmark"
    watchlist_plus_benchmark = "watchlist_plus_benchmark"
    custom = "custom"
