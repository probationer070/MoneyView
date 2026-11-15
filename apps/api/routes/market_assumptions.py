"""Owner-entered market assumptions (plan 2026-11-16-wacc-ke-live-premia, S4). Append-only."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from apps.api.models.schema_parts.corporate import AssumptionsOut
from apps.api.models.schemas import MarketAssumptionIn, MarketAssumptionRow, MarketAssumptionsView
from apps.api.services.db import get_db
from apps.api.services.market_assumptions import (
    Assumptions,
    AssumptionRejected,
    AssumptionsMissing,
    add_assumption,
    assumption_history,
    resolve_assumptions,
)

router = APIRouter()


@router.get("", response_model=MarketAssumptionsView)
def get_market_assumptions():
    """Resolved values with source, as-of and stale flags, plus every owner row. No side effects."""
    with get_db() as conn:
        resolved = resolve_assumptions(conn, datetime.now(timezone.utc))
        history = assumption_history(conn)
    if isinstance(resolved, AssumptionsMissing):
        return MarketAssumptionsView(missing=list(resolved.missing), history=history)
    assert isinstance(resolved, Assumptions)
    current = AssumptionsOut(
        risk_free_rate=resolved.risk_free_rate,
        risk_free_source=resolved.risk_free_source,
        risk_free_as_of=resolved.risk_free_as_of,
        equity_risk_premium=resolved.equity_risk_premium,
        erp_source=resolved.erp_source,
        erp_as_of=resolved.erp_as_of,
        crp=resolved.crp_non_mature,
        crp_basis="non_mature_rule",
        stale=list(resolved.stale),
    )
    return MarketAssumptionsView(current=current, history=history)


@router.put("", response_model=MarketAssumptionRow)
def put_market_assumption(body: MarketAssumptionIn):
    """Append one dated owner row. 422 invalid, 409 when (key, as_of) already exists."""
    with get_db() as conn:
        try:
            return add_assumption(conn, body.key, body.value, body.as_of, body.source, datetime.now(timezone.utc))
        except AssumptionRejected as exc:
            raise HTTPException(status_code=409 if exc.duplicate else 422, detail=str(exc)) from None
