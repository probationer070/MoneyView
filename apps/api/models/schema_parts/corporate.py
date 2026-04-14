from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field

from .common import ComparisonUniverseEnum


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
    roic: float = 18.0
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


class CorporateComparisonSnapshotMeta(BaseModel):
    """Snapshot metadata for live-vs-persisted comparison responses."""

    mode: str = "snapshot"
    as_of_date: str = ""
    generated_at: str = ""
    snapshot_version: str = ""
    snapshot_versions_for_day: int = 0
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
    snapshot_versions_for_day: int = 1
    snapshot_source: str = ""
    comparison_universe: ComparisonUniverseEnum = ComparisonUniverseEnum.portfolio_plus_benchmark
    benchmark_ticker: str = "^GSPC"
    stock_count: int = 0
    average_expected_return_spread: float = 0.0
    average_roic_minus_wacc: float = 0.0
    average_dcf_value: float = 0.0
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
