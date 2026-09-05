"""Request and response models for segment build-up valuation cases."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    initial_growth: float | None = Field(default=None, gt=-1)
    waypoint_gap_fraction: float | None = Field(default=None, gt=0, lt=1)
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
    # Also controls the tax ramp: `effective_tax_rate`, when set, converges
    # to `marginal_tax_rate` on this same schedule. One knob, because the
    # source hardwires both to year 6 -- but moving it moves the tax
    # schedule too, which is worth 12.6 of enterprise value on the seeded
    # post-prospectus case across the range 3..8.
    wacc_converge_from: int = Field(default=6, ge=1)
    nol_balance: float = Field(default=0.0, ge=0)
    terminal_growth: float | None = None
    # Today's reported rate. None taxes every year at the marginal rate.
    # Converges on the `wacc_converge_from` schedule above; at
    # wacc_converge_from=1 it therefore applies to no year at all.
    effective_tax_rate: float | None = Field(default=None, ge=0, le=1)
    # No defaults: the equity bridge (cash, debt, ipo_proceeds, shares_new) must
    # be stated, not silently assumed to be a debt-free, cash-free firm with no
    # pending raise. See `calculate_net_debt`'s docstring in dcf.py for the same
    # argument -- a missing balance is not a zero balance.
    cash: float = Field(ge=0)
    debt: float = Field(ge=0)
    ipo_proceeds: float = Field(ge=0)
    shares_new: float = Field(ge=0)
    parent_case_id: int | None = None


class ValuationCaseCreated(BaseModel):
    id: int


class ForkOverrides(BaseModel):
    """The envelope is known; the leaves are not. A leaf is a bare scalar for
    an unnarrated field or a {value, claim, three_p} object for a narrated
    one, so it stays `Any` and `case_fork` validates it."""
    model_config = ConfigDict(extra="forbid")

    case: dict[str, Any] = {}
    segments: dict[str, dict[str, Any]] = {}


class ForkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    case_name: str
    overrides: ForkOverrides = ForkOverrides()

    @field_validator("case_name")
    @classmethod
    def _named(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("a fork needs a name")
        return name


class ConservativeCaseResult(BaseModel):
    """The outcome of a conservative-case request.

    `created` distinguishes a case built by this call from one that already
    existed, which a bare id cannot: the endpoint is idempotent, so a repeat
    request succeeds without changing anything.
    """

    id: int
    case_name: str
    created: bool


class VerdictRow(BaseModel):
    """One signal. `value` and `reason` are mutually exclusive."""

    value: float | None = None
    comparison: str | None = None
    source: str
    reason: str | None = None


class VerdictPanel(BaseModel):
    ticker: str
    direction: str
    rows: dict[str, VerdictRow]


class ValuationCaseSummary(BaseModel):
    id: int
    case_name: str
    ticker: str | None
    as_of_date: str
    base_year: int
    target_year: int
    parent_case_id: int | None
