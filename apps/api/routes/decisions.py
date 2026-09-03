"""Investment decisions: what was believed about a ticker, when, and why.

The figures are captured by the server (see `record_decision`); this router
never accepts them from the caller.
"""
from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schemas import APIResponse
from apps.api.models.schema_parts.decision import (
    DecisionCreated,
    DecisionInput,
    DecisionRow,
)
from apps.api.services.investment_decision import list_decisions, record_decision

router = APIRouter()


@router.post("", response_model=APIResponse[DecisionCreated])
def create_decision(payload: DecisionInput = Body(...)):
    try:
        decision_id = record_decision(
            ticker=payload.ticker, action=payload.action, memo=payload.memo
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=DecisionCreated(id=decision_id))


@router.get("", response_model=APIResponse[list[DecisionRow]])
def get_decisions():
    return APIResponse(data=[DecisionRow(**row) for row in list_decisions()])
