"""Request and response models for segment build-up valuation cases."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SegmentNarrativeInput(BaseModel):
    """The claim that justifies one numeric input."""

    input_field: str
    claim: str
    evidence_source: str | None = None
    confidence: Literal["confirmed", "derived", "assumed"]
    three_p: Literal["possible", "plausible", "probable"]


class SegmentInput(BaseModel):
    name: str
    base_revenue: float
    base_margin: float
    margin_target: float
    sales_to_capital_early: float = Field(gt=0)
    sales_to_capital_late: float = Field(gt=0)
    tam_target: float | None = None
    market_share_target: float | None = None
    revenue_target: float | None = None
    ramp_start_year: int = Field(default=1, ge=1)
    narratives: list[SegmentNarrativeInput] = Field(default_factory=list)


class ValuationCaseInput(BaseModel):
    case_name: str
    as_of_date: str
    base_year: int
    target_year: int
    riskfree_rate: float
    wacc_initial: float = Field(gt=0)
    wacc_stable: float = Field(gt=0)
    marginal_tax_rate: float = Field(ge=0, le=1)
    roic_stable: float = Field(gt=0)
    shares_basic: float = Field(gt=0)
    segments: list[SegmentInput] = Field(min_length=1)
    ticker: str | None = None
    wacc_converge_from: int = Field(default=6, ge=1)
    nol_balance: float = Field(default=0.0, ge=0)
    terminal_growth: float | None = None
    cash: float = 0.0
    debt: float = 0.0
    ipo_proceeds: float = 0.0
    shares_new: float = 0.0
    parent_case_id: int | None = None


class ValuationCaseCreated(BaseModel):
    id: int


class ValuationCaseSummary(BaseModel):
    id: int
    case_name: str
    ticker: str | None
    as_of_date: str
    base_year: int
    target_year: int
    parent_case_id: int | None
