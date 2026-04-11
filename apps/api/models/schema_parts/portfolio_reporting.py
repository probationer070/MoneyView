from __future__ import annotations

from datetime import date
from enum import Enum
from hashlib import sha256
from typing import Dict, List, Optional

from pydantic import BaseModel, Field, model_validator

from .common import PeriodEnum

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
    date_from: Optional[date] = None
    as_of_date: Optional[date] = None

    @model_validator(mode="after")
    def validate_and_normalize(self) -> "PortfolioInput":
        if self.date_from is not None and self.as_of_date is not None and self.date_from > self.as_of_date:
            raise ValueError("date_from must be on or before as_of_date")

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
        digest_input = "|".join(
            [
                *(f"{ticker}:{weight:.10f}" for ticker, weight in pairs),
                f"date_from:{self.date_from or ''}",
                f"as_of_date:{self.as_of_date or ''}",
            ]
        )
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
    period: PeriodEnum = PeriodEnum.five_year
    currency: str = "USD"
    return_frequency: ReturnFrequencyEnum = ReturnFrequencyEnum.daily
    rebalancing: RebalancingEnum = RebalancingEnum.bop
    attribution_method: AttributionMethodEnum = AttributionMethodEnum.brinson_fachler_arithmetic
    allow_cash: bool = True
    allow_short: bool = False
    allow_synthetic_fallback: bool = False
    allow_benchmark_proxy: bool = False
    date_from: Optional[date] = None
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
            date_from=self.date_from,
            as_of_date=self.as_of_date,
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
            date_from=self.date_from,
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
    period: PeriodEnum = PeriodEnum.five_year
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
            date_from=self.filters.date_from,
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
