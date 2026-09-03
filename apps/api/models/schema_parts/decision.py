from pydantic import BaseModel, ConfigDict, Field, field_validator


class DecisionInput(BaseModel):
    # extra="forbid" is the contract: the server captures the figures, so a
    # client that sends one is making a mistake worth surfacing as a 422 rather
    # than silently dropping.
    model_config = ConfigDict(extra="forbid")

    ticker: str = Field(min_length=1)
    action: str
    memo: str

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
    price_move: float | None = None
    reason: str | None = None


class DecisionRow(BaseModel):
    id: int
    ticker: str
    decided_at: str
    action: str
    memo: str
    price_at_decision: float | None = None
    dcf_value: float | None = None
    dcf_implied_return: float | None = None
    roic: float | None = None
    wacc: float | None = None
    figures_source: str
    figures_unavailable_reason: str | None = None
    outcome: DecisionOutcome
