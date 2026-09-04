from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DecisionInput(BaseModel):
    # extra="forbid" is the contract: the server captures the figures, so a
    # client that sends one is making a mistake worth surfacing as a 422 rather
    # than silently dropping.
    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(min_length=1)
    action: str
    memo: str

    @field_validator("ticker")
    @classmethod
    def ticker_must_not_be_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("ticker is required: a blank ticker cannot be recorded")
        return value

    @field_validator("memo")
    @classmethod
    def memo_must_say_something(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("memo is required: a decision without a reason is a snapshot")
        return value


class DecisionCreated(BaseModel):
    id: int


class DecisionOutcome(BaseModel):
    decided_on: str
    price_now: float | None = None
    price_date: str | None = None
    # Percent, matching DecisionRow.dcf_implied_return_pct -- the two are
    # charted together (spec S6) and a raw fraction beside a percent would put
    # them 100x apart on the same axis. `outcome_for` still computes and
    # returns a raw fraction under the key "price_move"; converted to percent
    # here, at the wire boundary, not in the service layer. See Finding 2.
    price_move_pct: float | None = None
    reason: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _price_move_to_percent(cls, data: object) -> object:
        if isinstance(data, dict) and "price_move" in data and "price_move_pct" not in data:
            data = dict(data)
            move = data.pop("price_move")
            data["price_move_pct"] = None if move is None else move * 100
        return data


class DecisionRow(BaseModel):
    id: int
    ticker: str
    decided_at: str
    action: str
    memo: str
    price_at_decision: float | None = None
    dcf_value: float | None = None
    # Percent already at the DB layer (`corporate_comparison._dcf_snapshot`
    # stores `round(rate * 100, 2)`); renamed here, at the wire boundary only,
    # so the unit travels with the name. The DB column stays `dcf_implied_return`
    # -- see Finding 2's ruling: fix at the API boundary, not a migration.
    dcf_implied_return_pct: float | None = Field(default=None, validation_alias="dcf_implied_return")
    roic: float | None = None
    wacc: float | None = None
    # Assumptions the figures above were computed under. Decisions never
    # expire and DEFAULT_RISK_FREE_RATE/DEFAULT_EQUITY_RISK_PREMIUM can change,
    # so without these a stored dcf_implied_return_pct could be silently
    # reinterpreted under today's defaults. See Finding 5.
    risk_free_rate: float | None = None
    equity_risk_premium: float | None = None
    # Decisions never expire, so this table holds rows from both sides of a
    # metric-schema bump with no other way to tell them apart. See Finding 5
    # and ERROR-LOG.md's 2026-08-05 entry, which the comparison subsystem
    # already learned this same lesson from.
    metric_schema_version: int | None = None
    figures_source: str
    figures_unavailable_reason: str | None = None
    outcome: DecisionOutcome
