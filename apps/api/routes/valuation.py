"""Segment build-up valuation cases.

Hand-authored cases: nothing here consults the acquisition pipeline, so a
private or pre-IPO company is valued the same way a listed one is.
"""

from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schemas import (
    APIResponse,
    ValuationCaseCreated,
    ValuationCaseInput,
    ValuationCaseSummary,
)
from apps.api.services.valuation_case import (
    CaseNotFound,
    create_case,
    list_cases,
    load_case,
    run_stored_case,
)

router = APIRouter()


@router.post("/cases", response_model=APIResponse[ValuationCaseCreated])
async def create_valuation_case(payload: ValuationCaseInput = Body(...)):
    """Create a case with its segments and narratives.

    Rejects with 422 if any stated numeric input lacks a narrative claim.
    """
    try:
        case_id = create_case(payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=ValuationCaseCreated(id=case_id))


@router.get("/cases", response_model=APIResponse[list[ValuationCaseSummary]])
async def list_valuation_cases():
    return APIResponse(data=[ValuationCaseSummary(**case) for case in list_cases()])


@router.get("/cases/{case_id}", response_model=APIResponse[dict])
async def get_valuation_case(case_id: int):
    try:
        return APIResponse(data=load_case(case_id))
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cases/{case_id}/run", response_model=APIResponse[dict])
async def run_valuation_case(case_id: int):
    """Value a stored case.

    A ValueError here is a rejected model, not a server fault: terminal growth
    above the riskfree rate, a non-positive WACC-to-growth spread, ROIC at or
    below WACC with positive growth. All are 422.
    """
    try:
        return APIResponse(data=run_stored_case(case_id))
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
