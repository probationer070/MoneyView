from __future__ import annotations

from enum import StrEnum
from typing import List

from pydantic import BaseModel, Field

from .common import ComparisonUniverseEnum


class BridgeSource(StrEnum):
    """Where one enterprise-to-equity bridge input came from.

    A closed set, not a free-form string: this value is rendered in the UI, and
    free-form provenance strings drift apart across call sites.
    """

    REQUEST = "request"
    TOTAL_DEBT_LESS_CASH = "total_debt_less_cash"
    NET_DEBT_PLUS_CASH = "net_debt_plus_cash"
    INVESTMENTS_ADVANCES = "investments_and_advances"
    DILUTED_AVERAGE_SHARES = "diluted_average_shares"
    SHARES_OUTSTANDING = "shares_outstanding"
    UNAVAILABLE = "unavailable"


class BridgeInputMeta(BaseModel):
    """One bridge input with its provenance.

    `value` is in billions -- of currency for the two money terms, of shares for
    the share count -- so equity_value / diluted_shares yields dollars per share
    directly. Scaling happens once, in equity_bridge.py, at read time.
    """

    value: float | None = None
    source: str = BridgeSource.UNAVAILABLE
    quality: str = "missing"
    as_of: str | None = None


class ValuationAssumptions(BaseModel):
    """Explicit bounds to prevent invalid DCF and WACC states."""

    revenue_growth_rate: float = Field(..., ge=-0.99, le=2.0, description="Max 200% growth, min -99% decay")
    operating_margin: float = Field(..., ge=-1.0, le=1.0)
    tax_rate: float = Field(..., ge=0.0, le=1.0)
    wacc: float = Field(..., gt=0.0, le=0.5, description="Must be > 0 against division by zero")
    terminal_growth_rate: float = Field(..., ge=-0.1, le=0.1)
    fcff: float | None = Field(default=None, ge=0.0)
    esg_penalty: float | None = Field(default=None, ge=0.0, le=100.0)
    reinvestment: float | None = Field(default=None, ge=0.0, le=100.0)
    unlevered_beta: float | None = Field(default=None, ge=0.0, le=5.0)
    debt_ratio: float | None = Field(default=None, ge=0.0, le=100.0)
    net_debt: float | None = None
    non_operating_assets: float | None = Field(default=None, ge=0.0)
    diluted_shares_outstanding: float | None = Field(default=None, gt=0.0)


class DCFSummary(BaseModel):
    """Phase 1 DCF payload suitable for live streaming and lightweight UI rendering."""

    report_id: str
    ticker: str
    estimated_value: float
    intrinsic_value_per_share: float | None = None
    enterprise_value: float
    equity_value: float | None = None
    valuation_method: str = "enterprise_value_no_share_bridge"
    bridge_quality: str = "missing"
    net_debt_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    non_operating_assets_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    diluted_shares_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    current_price: float
    upside_pct: float
    status: str
    generated_at: str


class DCFAssumptionSummary(BaseModel):
    """Phase 2 DCF payload containing only the high-level assumption recap."""

    report_id: str
    ticker: str
    generated_at: str
    wacc_used: float
    margin_used: float
    growth_used: float
    fcff_used: float
    esg_penalty_used: float
    terminal_growth_used: float
    enterprise_value_index: float


class DCFProjectionRow(BaseModel):
    """One projected FCFF row for the full DCF report."""

    year: int
    projected_fcff: float
    discount_factor: float
    present_value: float


class DCFWaccBreakdown(BaseModel):
    """Expanded WACC inputs reserved for the full report retrieval path."""

    risk_free_rate: float
    unlevered_beta: float
    debt_ratio: float
    tax_rate: float
    equity_risk_premium: float
    country_risk_premium: float


class DCFFullReport(BaseModel):
    """Phase 3 DCF report containing the full backend valuation breakdown."""

    summary: DCFSummary
    assumptions: DCFAssumptionSummary
    projection_rows: List[DCFProjectionRow] = Field(default_factory=list)
    wacc_breakdown: DCFWaccBreakdown
    terminal_cash_flow: float
    terminal_value: float
    present_value_of_terminal: float
    present_value_of_fcff: float
    enterprise_value: float
    equity_value: float | None = None
    intrinsic_value_per_share: float | None = None
    net_debt: float | None = None
    non_operating_assets: float | None = None
    diluted_shares_outstanding: float | None = None
    valuation_method: str = "enterprise_value_no_share_bridge"
    bridge_quality: str = "missing"
    net_debt_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    non_operating_assets_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    diluted_shares_meta: BridgeInputMeta = Field(default_factory=BridgeInputMeta)
    agency_discount: float
    dcf_multiple: float
    baseline_multiple: float
    fcff_scale: float


class RiskAssumptions(BaseModel):
    """Bounds for Monte Carlo risk logic."""

    volatility: float = Field(..., ge=0.0, le=5.0)
    risk_free_rate: float = Field(..., ge=-0.05, le=0.3)
    time_horizon_years: int = Field(..., ge=1, le=50)
    simulations: int = Field(..., ge=1000, le=100000)


class CorporateMetrics(BaseModel):
    """Ticker-specific corporate analysis inputs."""

    ticker: str
    growth: float = 6.0
    growth_avg_legacy: float | None = None
    growth_cagr_v2: float | None = None
    roic: float = 18.0
    roic_legacy: float | None = None
    roic_stable_v2: float | None = None
    wacc: float = 10.0
    debt_ratio: float = 18.0
    unlevered_beta: float = 1.05
    crp: float = 0.8
    reinvestment: float = 34.0
    fcff: float = 92.0
    innovation: float = 82.0
    market_share: float = 64.0
    governance: float = 74.0
    esg_penalty: float = 22.0
    growth_meta: "CorporateDerivedMetricMeta | None" = None
    roic_meta: "CorporateDerivedMetricMeta | None" = None


class MetricQuality(str):
    """Quality states used to qualify derived valuation metrics."""


class CorporateDerivedMetricMeta(BaseModel):
    """Decision-surface metadata for one derived corporate metric."""

    method: str = ""
    quality: str = "missing"
    reason: str | None = None
    warnings: List[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    source: str = ""
    calculation_version: str = ""
    metric_role: str = "primary"
    as_of: str | None = None


class CorporateMetricAuditInput(BaseModel):
    """One raw or intermediate input used in an auditable metric calculation."""

    field: str
    label: str
    value: float | None = None
    display_value: str
    source: str


class CorporateMetricAuditEntry(BaseModel):
    """Auditable metadata for one derived valuation metric."""

    value: float | None = None
    display_value: str = "N/A"
    method: str = ""
    quality: str = "missing"
    reason: str | None = None
    warnings: List[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    inputs_used: List[CorporateMetricAuditInput] = Field(default_factory=list)
    source: str = ""
    as_of: str | None = None
    calculation_version: str = ""


class CorporateMetricAudit(BaseModel):
    """Full audit payload for ROIC, WACC, and spread quality."""

    ticker: str
    source_mode: str = "unavailable"
    generated_at: str
    growth: CorporateMetricAuditEntry | None = None
    roic: CorporateMetricAuditEntry
    wacc: CorporateMetricAuditEntry
    spread: CorporateMetricAuditEntry
    dcf: CorporateMetricAuditEntry | None = None


class CorporateCompany(BaseModel):
    """Company available for corporate analysis."""

    ticker: str
    name: str
    sector: str = ""
    source: str = "manual"


class CorporateComparisonRow(BaseModel):
    """Cross-stock comparison row for target-stock valuation and expected return."""

    ticker: str
    name: str = ""
    sector: str = ""
    group_name: str = "custom"
    weight: float = 0.0
    roic: float
    wacc: float
    roic_minus_wacc: float
    dcf_value: float
    current_price: float
    dcf_implied_return: float = 0.0
    capm_expected_return: float = 0.0
    stock_expected_return: float
    market_expected_return: float
    expected_return_spread: float
    stock_expected_return_source: str = "dcf_implied_upside"
    has_price_data: bool = True
    # Beside has_price_data, and for the same reason: the three return fields above are
    # typed float and feed non-optional aggregates, so they cannot become None when the
    # bridge does not resolve. This flag says the numbers next to it are not meaningful.
    bridge_quality: str = "missing"


class CorporateComparisonSnapshotMeta(BaseModel):
    """Snapshot metadata for live-vs-persisted comparison responses."""

    mode: str = "snapshot"
    as_of_date: str = ""
    generated_at: str = ""
    snapshot_version: str = ""
    snapshot_available: bool = False
    snapshot_source: str = ""
    comparison_universe: ComparisonUniverseEnum = ComparisonUniverseEnum.portfolio_plus_benchmark
    benchmark_ticker: str = "^GSPC"
    custom_tickers: List[str] = Field(default_factory=list)
    snapshot_cadence: str = "daily_kst_0000"
    snapshot_retention_days: int = 365
    snapshot_is_stale: bool = False


class CorporateComparisonResponse(BaseModel):
    """Comparison payload covering all current target stocks."""

    market_expected_return: float
    risk_free_rate: float
    equity_risk_premium: float
    stock_expected_return_method: str = "dcf_implied_upside"
    comparison_reference_return_method: str = "capm_beta_reference"
    snapshot: CorporateComparisonSnapshotMeta = Field(default_factory=CorporateComparisonSnapshotMeta)
    rows: List[CorporateComparisonRow] = Field(default_factory=list)


class CorporateComparisonHistoryPoint(BaseModel):
    """Snapshot-history summary row for one saved comparison date."""

    as_of_date: str
    generated_at: str = ""
    snapshot_version: str = ""
    snapshot_source: str = ""
    comparison_universe: ComparisonUniverseEnum = ComparisonUniverseEnum.portfolio_plus_benchmark
    benchmark_ticker: str = "^GSPC"
    stock_count: int = 0
    # None, not 0.0: both averages exclude bridge_quality = 'missing' rows, so on a
    # snapshot where every non-benchmark row is missing SQL AVG returns NULL over zero
    # rows. Coercing that to 0.0 rendered an absent average as a real $0.0 and a 0.00%
    # spread. stock_count stays the full row count, so it cannot signal the difference.
    average_expected_return_spread: float | None = None
    average_roic_minus_wacc: float = 0.0
    average_dcf_value: float | None = None
    market_expected_return: float = 0.0


class CorporateComparisonHistoryResponse(BaseModel):
    """Timeline payload for persisted comparison snapshots."""

    comparison_universe: ComparisonUniverseEnum = ComparisonUniverseEnum.portfolio_plus_benchmark
    benchmark_ticker: str = "^GSPC"
    custom_tickers: List[str] = Field(default_factory=list)
    points: List[CorporateComparisonHistoryPoint] = Field(default_factory=list)


class CorporateComparisonStockHistoryPoint(BaseModel):
    """Per-stock timeline row for saved comparison snapshots."""

    as_of_date: str
    generated_at: str = ""
    snapshot_version: str = ""
    snapshot_source: str = ""
    benchmark_ticker: str = "^GSPC"
    current_price: float = 0.0
    roic_minus_wacc: float = 0.0
    dcf_implied_return: float = 0.0
    expected_return_spread: float = 0.0
    market_expected_return: float = 0.0


class CorporateComparisonStockHistoryResponse(BaseModel):
    """Saved snapshot trend payload for one stock inside a comparison universe."""

    ticker: str
    comparison_universe: ComparisonUniverseEnum = ComparisonUniverseEnum.portfolio_plus_benchmark
    benchmark_ticker: str = "^GSPC"
    custom_tickers: List[str] = Field(default_factory=list)
    points: List[CorporateComparisonStockHistoryPoint] = Field(default_factory=list)


class CorporateComparisonSnapshotDeleteResult(BaseModel):
    """Deletion summary for one persisted comparison snapshot version."""

    snapshot_version: str
    deleted_rows: int = 0


class CorporateDcfBatchRequest(BaseModel):
    """Tickers selected for bulk DCF report calculation."""

    tickers: List[str] = Field(default_factory=list)
