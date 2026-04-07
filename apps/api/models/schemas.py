"""
Pydantic schemas for MoneyView API.

Schema A (Macro/Economic): category | name | code | value | unit | date | source | cycle | description
Schema B (Financial Assets): Date | Open | High | Low | Close | Volume | Dividends | Stock Splits
"""

from __future__ import annotations
from datetime import date
from hashlib import sha256
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Generic, TypeVar, Any, Dict
from enum import Enum

T = TypeVar("T")

class APIMeta(BaseModel):
    last_updated_at: str = ""
    request_id: str = ""

class APIResponse(BaseModel, Generic[T]):
    status: str = "ok"
    data: T
    meta: APIMeta = Field(default_factory=APIMeta)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class SentimentEnum(str, Enum):
    positive = "positive"
    neutral  = "neutral"
    negative = "negative"

class PeriodEnum(str, Enum):
    one_week   = "1w"
    one_month  = "1mo"
    three_month= "3mo"
    six_month  = "6mo"
    one_year   = "1y"
    two_year   = "2y"
    five_year  = "5y"


# ---------------------------------------------------------------------------
# Schema B — Financial Asset OHLCV (stocks, crypto, indices)
# Columns: Date, Open, High, Low, Close, Volume, Dividends, Stock Splits
# ---------------------------------------------------------------------------

class StockOHLCV(BaseModel):
    """Single OHLCV bar — Schema B."""
    date:         str
    open:         float
    high:         float
    low:          float
    close:        float
    volume:       int
    dividends:    float = 0.0
    stock_splits: float = 0.0

    class Config:
        json_schema_extra = {
            "example": {
                "date": "2025-04-07",
                "open": 180.50, "high": 183.20,
                "low":  179.10, "close": 181.90,
                "volume": 62_000_000,
                "dividends": 0.0, "stock_splits": 0.0,
            }
        }


class DeltaBadge(BaseModel):
    """Price change indicator — Red = UP, Blue = DOWN (Korean convention)."""
    value:      float
    prev_value: float
    delta_abs:  float
    delta_pct:  float
    direction:  str   # "up" | "down" | "flat"
    color:      str   # "red" | "blue" | "gray"

    @classmethod
    def compute(cls, value: float, prev_value: float) -> "DeltaBadge":
        if prev_value == 0:
            return cls(value=value, prev_value=prev_value,
                       delta_abs=0, delta_pct=0, direction="flat", color="gray")
        delta_abs = value - prev_value
        delta_pct = (delta_abs / prev_value) * 100
        direction = "up" if delta_abs > 0 else ("down" if delta_abs < 0 else "flat")
        color     = "red" if direction == "up" else ("blue" if direction == "down" else "gray")
        return cls(value=value, prev_value=prev_value,
                   delta_abs=round(delta_abs, 4),
                   delta_pct=round(delta_pct, 4),
                   direction=direction, color=color)


class IndexQuote(BaseModel):
    """Market index summary card (Tab 2 — Market Overview)."""
    name:           str
    ticker:         str
    last_close:     float
    delta:          DeltaBadge
    sparkline:      List[float] = Field(default_factory=list)
    period:         str = "1y"


# ---------------------------------------------------------------------------
# Schema A — Macro / Economic Indicator
# Columns: category | name | code | value | unit | date | source | cycle | description
# ---------------------------------------------------------------------------

class IndicatorRecord(BaseModel):
    """Single economic indicator data point — Schema A."""
    category:    str
    name:        str
    code:        str
    value:       Optional[float]
    unit:        str  = ""
    date:        str
    source:      str  = ""
    cycle:       str  = ""
    description: str  = ""

    class Config:
        json_schema_extra = {
            "example": {
                "category": "환율", "name": "원/미국달러",
                "code": "0000001", "value": 1350.5,
                "unit": "원", "date": "20240101",
                "source": "ECOS", "cycle": "D", "description": "",
            }
        }


# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

class WatchlistItem(BaseModel):
    """User watchlist entry (from stock_targets.json)."""
    ticker:     str
    name:       str = ""
    sector:     str = ""
    group_name: str = "custom"


class PortfolioStock(BaseModel):
    """Stock card for Tab 3 — Portfolio View."""
    ticker:     str
    name:       str
    sector:     str
    group_name: str
    last_close: float
    delta:      DeltaBadge
    sparkline:  List[float] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------

class NewsArticle(BaseModel):
    """News article with sentiment tag."""
    id:             Optional[int] = None
    ticker:         Optional[str] = None   # None = macro event
    headline:       str
    url:            str  = ""
    source:         str  = ""
    published_date: str  = ""
    sentiment:      SentimentEnum = SentimentEnum.neutral
    importance:     int  = 1


# ---------------------------------------------------------------------------
# Technical Indicators (Detail Popup)
# ---------------------------------------------------------------------------

class TechnicalIndicators(BaseModel):
    """Computed technical indicators for a stock."""
    ticker:      str
    rsi_14:      Optional[float] = None
    macd:        Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist:   Optional[float] = None
    bb_upper:    Optional[float] = None
    bb_mid:      Optional[float] = None
    bb_lower:    Optional[float] = None
    ma_20:       Optional[float] = None
    ma_50:       Optional[float] = None
    ma_200:      Optional[float] = None
    as_of_date:  Optional[str]   = None


# ---------------------------------------------------------------------------
# Monte Carlo (Detail Popup)
# ---------------------------------------------------------------------------

class MonteCarloResult(BaseModel):
    """Monte Carlo simulation results."""
    ticker:       str
    paths:        int
    horizon_days: int
    p5:           float   # 5th percentile (pessimistic)
    p50:          float   # median
    p95:          float   # 95th percentile (optimistic)
    current:      float
    risk_score:   str     # "Low" | "Medium" | "High" | "Critical"
    computed_by:  str = "numpy"  # "numpy" | "rust"


# ---------------------------------------------------------------------------
# Strict Financial Assumptions (Pre-Phase 4)
# ---------------------------------------------------------------------------

class ValuationAssumptions(BaseModel):
    """Explicit bounds to prevent NaN or division by zero in DCF/WACC."""
    revenue_growth_rate: float = Field(..., ge=-0.99, le=2.0, description="Max 200% growth, min -99% decay")
    operating_margin: float    = Field(..., ge=-1.0, le=1.0)
    tax_rate: float            = Field(..., ge=0.0, le=1.0)
    wacc: float                = Field(..., gt=0.0, le=0.5, description="Must be > 0 against division by zero")
    terminal_growth_rate: float= Field(..., ge=-0.1, le=0.1)
    fcff: float | None         = Field(default=None, ge=0.0)
    esg_penalty: float | None  = Field(default=None, ge=0.0, le=100.0)
    reinvestment: float | None = Field(default=None, ge=0.0, le=100.0)
    unlevered_beta: float | None = Field(default=None, ge=0.0, le=5.0)
    debt_ratio: float | None   = Field(default=None, ge=0.0, le=100.0)

class RiskAssumptions(BaseModel):
    """Bounds for Monte Carlo risk logic."""
    volatility: float         = Field(..., ge=0.0, le=5.0)
    risk_free_rate: float     = Field(..., ge=-0.05, le=0.3)
    time_horizon_years: int   = Field(..., ge=1, le=50)
    simulations: int          = Field(..., ge=1000, le=100000)


class CorporateMetrics(BaseModel):
    """Ticker-specific corporate analysis inputs."""
    ticker: str
    growth: float = 6.0
    roic: float = 18.0
    wacc: float = 10.0
    debt_ratio: float = 18.0
    unlevered_beta: float = 1.05
    crp: float = 1.1
    reinvestment: float = 34.0
    fcff: float = 92.0
    innovation: float = 82.0
    market_share: float = 64.0
    governance: float = 74.0
    esg_penalty: float = 22.0


class CorporateCompany(BaseModel):
    """Company available for corporate analysis."""
    ticker: str
    name: str
    sector: str = ""
    source: str = "manual"


# ---------------------------------------------------------------------------
# Phase 5 - Portfolio Attribution & Reporting
# ---------------------------------------------------------------------------

WEIGHT_SUM_TOLERANCE = 1e-6
RECONCILIATION_TOLERANCE = 1e-8


class AttributionMethodEnum(str, Enum):
    brinson_fachler_arithmetic = "brinson_fachler_arithmetic"


class ReturnFrequencyEnum(str, Enum):
    daily = "daily"
    monthly = "monthly"


class RebalancingEnum(str, Enum):
    bop = "bop"
    eop = "eop"


class RiskMethodEnum(str, Enum):
    historical = "historical"


class BenchmarkWeightsSourceEnum(str, Enum):
    provider_derived = "provider_derived"
    user_provided = "user_provided"


class ReportExportFormatEnum(str, Enum):
    html = "html"
    pdf = "pdf"
    markdown = "markdown"
    csv = "csv"
    json = "json"


class PortfolioInput(BaseModel):
    tickers: List[str]
    weights: List[float]
    allow_cash: bool = True
    allow_short: bool = False
    as_of_date: Optional[date] = None

    @model_validator(mode="after")
    def validate_and_normalize(self) -> "PortfolioInput":
        if not self.tickers:
            raise ValueError("tickers must not be empty")
        if len(self.tickers) != len(self.weights):
            raise ValueError("tickers and weights length must match")

        merged: Dict[str, float] = {}
        for ticker, weight in zip(self.tickers, self.weights):
            norm_ticker = ticker.upper().strip()
            if not norm_ticker:
                raise ValueError("ticker values must be non-empty")
            merged[norm_ticker] = merged.get(norm_ticker, 0.0) + float(weight)

        normalized_tickers = list(merged.keys())
        normalized_weights = [merged[t] for t in normalized_tickers]

        if not self.allow_short and any(w < 0 for w in normalized_weights):
            raise ValueError("short positions are disabled for this portfolio input")

        total_weight = sum(normalized_weights)
        if self.allow_cash:
            if total_weight > 1.0 + WEIGHT_SUM_TOLERANCE:
                raise ValueError("weights exceed 1.0 with cash enabled")
            if total_weight < 1.0 - WEIGHT_SUM_TOLERANCE:
                cash_weight = 1.0 - total_weight
                if "CASH" in merged:
                    cash_idx = normalized_tickers.index("CASH")
                    normalized_weights[cash_idx] += cash_weight
                else:
                    normalized_tickers.append("CASH")
                    normalized_weights.append(cash_weight)
        elif abs(total_weight - 1.0) > WEIGHT_SUM_TOLERANCE:
            raise ValueError("weights must sum to 1.0 when cash is disabled")

        self.tickers = normalized_tickers
        self.weights = normalized_weights
        return self

    @property
    def total_weight(self) -> float:
        return float(sum(self.weights))

    def portfolio_hash(self) -> str:
        pairs = sorted(zip(self.tickers, self.weights), key=lambda x: x[0])
        digest_input = "|".join(f"{ticker}:{weight:.10f}" for ticker, weight in pairs)
        return sha256(digest_input.encode("utf-8")).hexdigest()[:16]


class BenchmarkDefinition(BaseModel):
    ticker: str = "^GSPC"
    source: str = "yfinance_via_sqlite_cache"
    weights_source: BenchmarkWeightsSourceEnum = BenchmarkWeightsSourceEnum.provider_derived
    weights: Optional[List[float]] = None


class RiskProfileInput(BaseModel):
    beta_rolling_window: int = Field(default=252, ge=20, le=756)
    var_method: RiskMethodEnum = RiskMethodEnum.historical
    var_confidence_level: float = Field(default=0.95, gt=0.5, lt=0.999)
    var_horizon_days: int = Field(default=1, ge=1, le=30)
    es_method: RiskMethodEnum = RiskMethodEnum.historical
    es_confidence_level: float = Field(default=0.95, gt=0.5, lt=0.999)
    es_horizon_days: int = Field(default=1, ge=1, le=30)


class AttributionRequest(BaseModel):
    tickers: List[str]
    weights: List[float]
    benchmark: str = "^GSPC"
    period: PeriodEnum = PeriodEnum.one_year
    currency: str = "USD"
    return_frequency: ReturnFrequencyEnum = ReturnFrequencyEnum.daily
    rebalancing: RebalancingEnum = RebalancingEnum.bop
    attribution_method: AttributionMethodEnum = AttributionMethodEnum.brinson_fachler_arithmetic
    allow_cash: bool = True
    allow_short: bool = False
    allow_synthetic_fallback: bool = False
    allow_benchmark_proxy: bool = False
    as_of_date: Optional[date] = None
    benchmark_weights: Optional[List[float]] = None
    risk_profile: RiskProfileInput = Field(default_factory=RiskProfileInput)

    @model_validator(mode="after")
    def validate_request(self) -> "AttributionRequest":
        normalized = PortfolioInput(
            tickers=self.tickers,
            weights=self.weights,
            allow_cash=self.allow_cash,
            allow_short=self.allow_short,
        )
        self.tickers = normalized.tickers
        self.weights = normalized.weights

        self.currency = self.currency.upper().strip()
        if self.currency != "USD":
            raise ValueError("only USD is currently supported; FX normalization is not implemented")

        if self.return_frequency != ReturnFrequencyEnum.daily:
            raise ValueError("only daily return frequency is currently implemented")

        if self.rebalancing != RebalancingEnum.bop:
            raise ValueError("only beginning-of-period weights are currently implemented")

        if self.benchmark_weights is not None:
            if len(self.benchmark_weights) != len(self.tickers):
                raise ValueError("benchmark_weights length must match tickers length")
            b_total = sum(float(w) for w in self.benchmark_weights)
            if abs(b_total - 1.0) > WEIGHT_SUM_TOLERANCE:
                raise ValueError("benchmark_weights must sum to 1.0")
        return self

    def to_portfolio_input(self) -> PortfolioInput:
        return PortfolioInput(
            tickers=self.tickers,
            weights=self.weights,
            allow_cash=self.allow_cash,
            allow_short=self.allow_short,
            as_of_date=self.as_of_date,
        )

    def portfolio_hash(self) -> str:
        return self.to_portfolio_input().portfolio_hash()

    def benchmark_definition(self) -> BenchmarkDefinition:
        return BenchmarkDefinition(
            ticker=self.benchmark,
            weights=self.benchmark_weights,
            weights_source=(
                BenchmarkWeightsSourceEnum.user_provided
                if self.benchmark_weights is not None
                else BenchmarkWeightsSourceEnum.provider_derived
            ),
        )


class AttributionTotals(BaseModel):
    portfolio_return: float
    benchmark_return: float


class AttributionEffects(BaseModel):
    allocation: float
    selection: float
    interaction: float

    @property
    def total(self) -> float:
        return float(self.allocation + self.selection + self.interaction)


class SectorAttribution(BaseModel):
    sector: str
    portfolio_weight: float
    benchmark_weight: float
    portfolio_return: float
    benchmark_return: float
    allocation_effect: float
    selection_effect: float
    interaction_effect: float
    active_contribution: float


class RiskMetrics(BaseModel):
    beta: float
    beta_rolling_window: int
    var_95_1d: float
    es_95_1d: float
    var_method: RiskMethodEnum = RiskMethodEnum.historical
    es_method: RiskMethodEnum = RiskMethodEnum.historical


class AttributionDataContract(BaseModel):
    return_frequency: ReturnFrequencyEnum
    rebalancing_assumption: RebalancingEnum
    timezone_cutoff: str = "16:00:00"
    timezone: str = "UTC"
    currency: str = "USD"
    fx_handling: str = "none_usd_only"
    corporate_actions: str = "split_and_dividend_adjusted_total_return"
    benchmark_source: str = "yfinance_via_sqlite_cache"
    sector_taxonomy: str = "watchlist_sector_gics_like"
    missing_data_fallback: str = "fail_closed_unless_allow_synthetic_fallback_true"


class AttributionDataQuality(BaseModel):
    synthetic_data_used: bool = False
    synthetic_tickers: List[str] = Field(default_factory=list)
    benchmark_proxy_used: bool = False
    benchmark_proxy_method: Optional[str] = None
    limitations: List[str] = Field(default_factory=list)


class AttributionMetadata(BaseModel):
    method: AttributionMethodEnum
    benchmark: str
    benchmark_weights_source: BenchmarkWeightsSourceEnum
    period: PeriodEnum
    schema_version: str = "1.0.0"
    generated_at: str
    portfolio_hash: str
    cache_key: str
    cache_hit: bool = False
    data_contract: AttributionDataContract
    data_quality: AttributionDataQuality = Field(default_factory=AttributionDataQuality)


class AttributionResult(BaseModel):
    totals: AttributionTotals
    active_return: float
    effects: AttributionEffects
    sector_breakdowns: List[SectorAttribution]
    risk_metrics: RiskMetrics
    metadata: AttributionMetadata

    @model_validator(mode="after")
    def validate_invariants(self) -> "AttributionResult":
        if abs(self.effects.total - self.active_return) > RECONCILIATION_TOLERANCE:
            raise ValueError("effects do not reconcile to active_return")

        sector_sum = sum(item.active_contribution for item in self.sector_breakdowns)
        if abs(sector_sum - self.active_return) > RECONCILIATION_TOLERANCE:
            raise ValueError("sector contributions do not reconcile to active_return")

        total_portfolio_weight = sum(item.portfolio_weight for item in self.sector_breakdowns)
        total_benchmark_weight = sum(item.benchmark_weight for item in self.sector_breakdowns)
        if abs(total_portfolio_weight - 1.0) > WEIGHT_SUM_TOLERANCE:
            raise ValueError("portfolio sector weights do not sum to 1.0")
        if abs(total_benchmark_weight - 1.0) > WEIGHT_SUM_TOLERANCE:
            raise ValueError("benchmark sector weights do not sum to 1.0")
        return self


class ReportFilters(BaseModel):
    period: PeriodEnum = PeriodEnum.one_year
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    benchmark: str = "^GSPC"
    currency: str = "USD"


class ReportOptions(BaseModel):
    formats: List[ReportExportFormatEnum] = Field(
        default_factory=lambda: [
            ReportExportFormatEnum.html,
            ReportExportFormatEnum.pdf,
            ReportExportFormatEnum.markdown,
            ReportExportFormatEnum.csv,
            ReportExportFormatEnum.json,
        ]
    )
    include_risk_metrics: bool = True
    include_sector_table: bool = True
    include_methodology: bool = True


class ReportSummaryRequest(BaseModel):
    tickers: List[str]
    weights: List[float]
    filters: ReportFilters = Field(default_factory=ReportFilters)
    report_options: ReportOptions = Field(default_factory=ReportOptions)
    attribution_method: AttributionMethodEnum = AttributionMethodEnum.brinson_fachler_arithmetic
    version: str = "phase5-v1"
    allow_cash: bool = True
    allow_short: bool = False
    allow_synthetic_fallback: bool = False
    allow_benchmark_proxy: bool = False
    benchmark_weights: Optional[List[float]] = None
    risk_profile: RiskProfileInput = Field(default_factory=RiskProfileInput)

    @model_validator(mode="after")
    def validate_request(self) -> "ReportSummaryRequest":
        PortfolioInput(
            tickers=self.tickers,
            weights=self.weights,
            allow_cash=self.allow_cash,
            allow_short=self.allow_short,
        )
        return self

    def to_attribution_request(self) -> AttributionRequest:
        return AttributionRequest(
            tickers=self.tickers,
            weights=self.weights,
            benchmark=self.filters.benchmark,
            period=self.filters.period,
            currency=self.filters.currency,
            as_of_date=self.filters.date_to,
            attribution_method=self.attribution_method,
            allow_cash=self.allow_cash,
            allow_short=self.allow_short,
            allow_synthetic_fallback=self.allow_synthetic_fallback,
            allow_benchmark_proxy=self.allow_benchmark_proxy,
            benchmark_weights=self.benchmark_weights,
            risk_profile=self.risk_profile,
        )


class ReportPayload(BaseModel):
    version: str
    schema_version: str = "1.0.0"
    generated_at: str
    portfolio_hash: str
    filters: ReportFilters
    report_options: ReportOptions
    attribution: AttributionResult
    executive_summary: str
    markdown_content: str


class ReportExportRequest(BaseModel):
    request: ReportSummaryRequest
    format: ReportExportFormatEnum


class ReportExportResponse(BaseModel):
    format: ReportExportFormatEnum
    content_type: str
    filename: str
    content: str
