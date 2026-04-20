from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from .news import TechnicalIndicators


class StockOHLCV(BaseModel):
    """Single OHLCV bar in financial-asset schema format."""

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    dividends: float = 0.0
    stock_splits: float = 0.0

    class Config:
        json_schema_extra = {
            "example": {
                "date": "2025-04-07",
                "open": 180.50,
                "high": 183.20,
                "low": 179.10,
                "close": 181.90,
                "volume": 62_000_000,
                "dividends": 0.0,
                "stock_splits": 0.0,
            }
        }


class DeltaBadge(BaseModel):
    """Price change indicator. Red = up, blue = down following local convention."""

    value: float
    prev_value: float
    delta_abs: float
    delta_pct: float
    direction: str
    color: str

    @classmethod
    def compute(cls, value: float, prev_value: float) -> "DeltaBadge":
        if prev_value == 0:
            return cls(
                value=value,
                prev_value=prev_value,
                delta_abs=0,
                delta_pct=0,
                direction="flat",
                color="gray",
            )
        delta_abs = value - prev_value
        delta_pct = (delta_abs / prev_value) * 100
        direction = "up" if delta_abs > 0 else ("down" if delta_abs < 0 else "flat")
        color = "red" if direction == "up" else ("blue" if direction == "down" else "gray")
        return cls(
            value=value,
            prev_value=prev_value,
            delta_abs=round(delta_abs, 4),
            delta_pct=round(delta_pct, 4),
            direction=direction,
            color=color,
        )


class IndexQuote(BaseModel):
    """Market index summary card."""

    name: str
    ticker: str
    instrument_type: str = "index"
    last_close: Optional[float] = None
    delta: DeltaBadge
    sparkline: List[float] = Field(default_factory=list)
    period: str = "5y"


class IndicatorRecord(BaseModel):
    """Single macro or economic indicator data point."""

    category: str
    name: str
    code: str
    value: Optional[float]
    unit: str = ""
    date: str
    source: str = ""
    cycle: str = ""
    description: str = ""

    class Config:
        json_schema_extra = {
            "example": {
                "category": "FX",
                "name": "USD/KRW",
                "code": "0000001",
                "value": 1350.5,
                "unit": "KRW",
                "date": "20240101",
                "source": "ECOS",
                "cycle": "D",
                "description": "",
            }
        }


class MarketVolumeSummary(BaseModel):
    """Daily volume summary for the selected market instrument."""

    latest_volume: Optional[int] = None
    average_20d_volume: Optional[float] = None
    average_60d_volume: Optional[float] = None
    volume_vs_20d_pct: Optional[float] = None
    as_of_date: Optional[str] = None


class MarketDataQuality(BaseModel):
    """Freshness and fallback metadata for a market detail response."""

    source: str = ""
    freshness_status: str = ""
    used_live_refresh: bool = False
    used_stale_cache_fallback: bool = False
    requested_period: str = "5y"
    last_updated: Optional[str] = None
    latest_trading_date: Optional[str] = None
    detail_note: str = ""


class StockPriceLookup(BaseModel):
    """Cache-first latest-price lookup payload for interactive stock inputs."""

    ticker: str
    status: str = "ok"
    price: Optional[float] = None
    as_of_date: Optional[str] = None
    source: str = ""
    freshness_status: str = ""
    retry_after_seconds: Optional[int] = None
    detail_note: str = ""


class MarketRegimeContext(BaseModel):
    """Breadth and regime context for index-style market instruments."""

    regime_label: str = ""
    regime_summary: str = ""
    equity_advancers: int = 0
    equity_decliners: int = 0
    breadth_ratio: Optional[float] = None
    equity_index_count: int = 0
    risk_on_signals: int = 0
    risk_off_signals: int = 0
    signal_count: int = 0


class MarketIndexDetail(BaseModel):
    """Expanded Market Overview detail payload for a single instrument."""

    name: str
    ticker: str
    instrument_type: str = "index"
    unit_label: Optional[str] = None
    base_asset: Optional[str] = None
    quote_asset: Optional[str] = None
    period: str = "5y"
    as_of_date: Optional[str] = None
    last_close: Optional[float] = None
    daily_history: List[StockOHLCV] = Field(default_factory=list)
    monthly_history: List[StockOHLCV] = Field(default_factory=list)
    daily_indicators: TechnicalIndicators
    monthly_indicators: TechnicalIndicators
    volume_summary: MarketVolumeSummary
    data_quality: MarketDataQuality
    market_regime: Optional[MarketRegimeContext] = None
