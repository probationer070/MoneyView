from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

from .corporate import AssumptionsOut

AssumptionKey = Literal["risk_free_fallback", "equity_risk_premium", "crp_non_mature"]


class MarketAssumptionIn(BaseModel):
    """One owner-entered row; `value` is percent points. Validated in the service (422)."""

    key: str
    value: float
    as_of: str
    source: str


class MarketAssumptionRow(BaseModel):
    key: str
    value: float
    as_of: str
    source: str
    updated_at: str


class MarketAssumptionsView(BaseModel):
    """Resolved values (None while any premium is missing) plus every owner row, newest first."""

    current: Optional[AssumptionsOut] = None
    missing: list[str] = []
    history: list[MarketAssumptionRow] = []
