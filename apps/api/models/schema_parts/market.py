from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from .news import TechnicalIndicators


class StockOHLCV(BaseModel):
    """Single OHLCV bar in financial-asset schema format."""

    model_config = ConfigDict(
        json_schema_extra={
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
    )

    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    dividends: float = 0.0
    stock_splits: float = 0.0


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

    model_config = ConfigDict(
        json_schema_extra={
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
    )

    category: str
    name: str
    code: str
    value: Optional[float]
    unit: str = ""
    date: str
    source: str = ""
    cycle: str = ""
    description: str = ""


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


EventOrigin = Literal["builtin", "rule", "user"]


class MarketEvent(BaseModel):
    """A dated event drawn as a vertical line on price charts.

    Built-in and rule events are asserted facts and carry a source; a user's own event may not,
    and `origin` is what lets the chart say so rather than presenting it as checked. See
    `apps.api.services.events`.

    `missing_category` is set only on a user event whose category was removed from the
    built-in file: the event is then served as `uncategorized` and keeps the old id here, so
    the Events page can ask for a new one instead of the event silently changing meaning.
    """

    id: str
    label: str
    category: str
    start_date: str
    end_date: Optional[str] = None
    source: Optional[str] = None
    note: str = ""
    origin: EventOrigin = "builtin"
    missing_category: Optional[str] = None


class EventCategory(BaseModel):
    """A category after resolution: file defaults, then saved overrides, then visibility.

    `visible` is a per-machine display preference (the global chart filter), not part of the
    category's definition. `overridden` is true only when a saved override makes a built-in's
    label or colour differ from its file default.
    """

    id: str
    label: str
    color: str
    origin: Literal["builtin", "user"]
    visible: bool = True
    overridden: bool = False


class MarketEventInput(BaseModel):
    """A user event as submitted. `origin` and `id` are the server's, so they are forbidden here."""

    model_config = ConfigDict(extra="forbid")

    label: str
    category: str
    start_date: str
    end_date: Optional[str] = None
    source: Optional[str] = None
    note: str = ""


class EventCategoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    color: str


class EventCategoryPatch(BaseModel):
    """Only the fields present in the request change; absent ones are left as they are."""

    model_config = ConfigDict(extra="forbid")

    label: Optional[str] = None
    color: Optional[str] = None
    visible: Optional[bool] = None


class MarketSpreadPoint(BaseModel):
    """One date on a relative-strength series."""

    date: str
    value: float


class MarketSpread(BaseModel):
    """Relative strength of one ticker against another, indexed to 100 at the base date.

    `basis` is required and names both tickers and the base date, because "relative
    strength" alone does not distinguish a ratio of returns from a difference of returns
    from a regression beta.

    A pair that cannot be computed carries `refused_reason` and an empty `series`. The two
    are mutually exclusive on purpose: an empty series with no reason would read as a flat
    result rather than an absence.

    Window figures are CALENDAR days. `observations` is the session count, which is not
    derivable from the calendar span -- 62 sessions inside 88 days -- and without it a thin
    series is indistinguishable from a dense one.
    """

    id: str
    label: str
    numerator: str
    denominator: str
    requested_window_days: int
    actual_window_start: Optional[str] = None
    actual_window_end: Optional[str] = None
    actual_window_days: Optional[int] = None
    observations: int = 0
    basis: str
    series: List[MarketSpreadPoint] = Field(default_factory=list)
    latest: Optional[float] = None
    refused_reason: Optional[str] = None
