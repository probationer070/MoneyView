from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel


class ThemeLabel(BaseModel):
    en: str
    ko: str


class ThemeRef(BaseModel):
    id: str
    label: ThemeLabel


class DetailProfile(BaseModel):
    """Watchlist facts for one ticker; nulls when the ticker is not on the watchlist."""

    ticker: str
    in_watchlist: bool
    name: Optional[str] = None
    sector: Optional[str] = None
    theme: Optional[ThemeRef] = None


class MoverRow(BaseModel):
    ticker: str
    name: str
    theme: Optional[str] = None
    return_pct: float


class LatestMovers(BaseModel):
    date: Optional[str] = None
    up: List[MoverRow]
    down: List[MoverRow]


class MoveMarket(BaseModel):
    ticker: str
    return_pct: float


class MoveTheme(BaseModel):
    id: str
    label: ThemeLabel
    return_pct: float


class MovePeer(BaseModel):
    ticker: str
    name: str
    return_pct: float


class MoveEvent(BaseModel):
    category: str
    title: str


class MoveAlert(BaseModel):
    id: int
    kind: Literal["risk", "surge"]
    role: Literal["start", "ongoing", "end"]


class MoveNews(BaseModel):
    stored: int
    searched: bool


class MoveExplanation(BaseModel):
    """Why one day's move happened. A value that cannot be computed is null, never 0."""

    ticker: str
    date: str
    return_pct: float
    price_ratio: Optional[float] = None
    volume_ratio: Optional[float] = None
    market: Optional[MoveMarket] = None
    theme: Optional[MoveTheme] = None
    peers: List[MovePeer]
    events: List[MoveEvent]
    alerts: List[MoveAlert]
    news: Optional[MoveNews] = None
