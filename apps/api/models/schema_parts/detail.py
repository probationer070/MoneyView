from __future__ import annotations

from typing import List, Optional

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
