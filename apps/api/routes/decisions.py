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
from apps.api.services.investment_decision import get_decision, list_decisions, record_decision

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


@router.get("/{decision_id}", response_model=APIResponse[DecisionRow])
def get_one_decision(decision_id: int):
    """One decision, with its outcome computed on read like the list's rows.

    A missing id is a 404 rather than a 200 carrying nulls: this table exists so
    that a record cannot say more than it knows, and an empty row would describe
    a decision nobody made.

    (Declaration order relative to the collection route does not matter --
    `/decisions` and `/decisions/{id}` are distinct paths and neither shadows the
    other. Checked by swapping them: all route tests still pass. Noted because
    the opposite is a common assumption and an earlier draft of this docstring
    asserted it.)
    """
    decision = get_decision(decision_id)
    if decision is None:
        raise HTTPException(status_code=404, detail=f"no decision with id {decision_id}")
    return APIResponse(data=DecisionRow(**decision))
