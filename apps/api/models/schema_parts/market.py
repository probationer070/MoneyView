from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


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
