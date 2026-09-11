from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from .market import DeltaBadge


class WatchlistItem(BaseModel):
    """User watchlist entry."""

    ticker: str
    name: str = ""
    sector: str = ""
    group_name: str = "custom"
    weight: float = Field(default=0.0, ge=0.0, le=1.0)


class WatchlistGroupUpdate(BaseModel):
    """Body for moving one watchlist row between groups.

    A dedicated body rather than reusing WatchlistItem: that model carries defaults for
    every other column, and a partial send through it would overwrite them.
    """

    group_name: str


class WatchlistResyncResult(BaseModel):
    """Summary of an explicit watchlist reload from stock_targets.json."""

    item_count: int
    tickers: List[str] = Field(default_factory=list)
    source: str
    json_path: str


class WatchlistSyncResult(BaseModel):
    """Summary of a safe DB-to-JSON watchlist sync."""

    item_count: int
    tickers: List[str] = Field(default_factory=list)
    source: str
    json_path: str
    preserved_weights: bool = True
    last_updated_at: str = ""


class WatchlistSyncStatus(BaseModel):
    """Last explicit watchlist sync or import action metadata."""

    source: str = ""
    last_updated_at: str = ""
    json_path: str = ""


class PortfolioPreferences(BaseModel):
    """Persisted portfolio workspace preferences shared by allocation tools."""

    total_investment_amount: float = Field(default=10_000.0, ge=0.0)
    transaction_fee_rate: float = Field(default=0.002, ge=0.0)
    updated_at: str = ""


class PortfolioStock(BaseModel):
    """Portfolio watchlist card row."""

    ticker: str
    name: str
    sector: str
    group_name: str
    weight: float
    # Optional because "no priced bar" is a real state, not a zero. The tile renders a
    # dash for null and "$0.0" for zero (StockTile.tsx:18), so sending 0.0 here made
    # every ticker with an unsettled newest bar read as a real price that had collapsed.
    last_close: Optional[float] = None
    delta: Optional[DeltaBadge] = None
    sparkline: List[float] = Field(default_factory=list)
    # Insertion order. watchlist has no created_at, so this is the only recency signal,
    # and the portfolio grid's no-weights fallback needs it.
    id: int = 0
