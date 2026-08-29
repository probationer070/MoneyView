"""Segment build-up valuation cases.

Hand-authored cases: nothing here consults the acquisition pipeline, so a
private or pre-IPO company is valued the same way a listed one is.
"""

from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schemas import (
    APIResponse,
    ConservativeCaseResult,
    ValuationCaseCreated,
    ValuationCaseInput,
    ValuationCaseSummary,
)
from apps.api.services.company_baseline import (
    find_conservative_case_id,
    generate_conservative_case_for_ticker,
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

    A ValueError here is a rejected model, not a server fault, and is returned as
    a 422. Raised either at construction time (`CaseSpec`/`SegmentSpec`: terminal
    growth above the riskfree rate, a non-positive sales-to-capital, a negative
    NOL balance, a tax rate outside [0, 1], target_year at or before base_year,
    ramp_start_year below 1, ...) or inside `run_case`/`terminal_value`: a
    non-positive WACC-to-growth spread, ROIC at or below WACC with positive
    growth, or roic_stable exceeding the target-year marginal return on new
    capital -- returns cannot improve after the target year, since margins have
    converged and sales-to-capital no longer changes. A terminal return BELOW
    the marginal one is not rejected at any distance; the implied change in
    capital intensity is reported as `terminal_capital_intensity_change`.
    """
    try:
        return APIResponse(data=run_stored_case(case_id))
    except CaseNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _conservative_result(case_id: int, *, created: bool) -> ConservativeCaseResult:
    """Report the case's name as STORED, never as re-derived.

    `generate_conservative_case_for_ticker` resolves a vintage internally and
    returns only `(case_id, reason)`, so the name is not handed back. Rebuilding
    it here with a second `latest_vintage()` call is the exact anti-pattern
    `resolve_for_ticker`'s docstring warns against: a vintage stored between the
    two calls makes the reported name disagree with the stored row, and a
    `latest_vintage()` of None yields a plausible-looking `conservative_X_None`
    that no guard would catch. The stored row is the only authority.
    """
    return ConservativeCaseResult(
        id=case_id, case_name=load_case(case_id)["case_name"], created=created
    )


@router.post("/conservative/{ticker}", response_model=APIResponse[ConservativeCaseResult])
def create_conservative_case(ticker: str):
    """Value `ticker` against the top industries of its sector, conservatively.

    Idempotent: the case is named `conservative_<TICKER>_<vintage>`, so a repeat
    request returns the existing case with `created=false` rather than the
    duplicate-name refusal `create_case` would otherwise raise. A client
    retrying after a timeout is therefore safe.

    Refusal is a first-class outcome here, not a degradation -- a benchmark that
    cannot be resolved never falls back to a substituted default, and the reason
    keeps its machine-readable prefix (`unmapped_industry`, `no_statements`,
    `not_storable`, ...) so a caller can branch on it without parsing prose.

    `no_vintage` is the one refusal that is not about the ticker: it means no
    benchmark dataset has been loaded into this server at all. It answers 409
    rather than 422, because blaming the caller's input for missing server state
    sends them to debug a ticker that was never the problem.
    """
    case_id, reason = generate_conservative_case_for_ticker(ticker)
    if case_id is not None:
        return APIResponse(data=_conservative_result(case_id, created=True))

    if reason.startswith("no_vintage"):
        raise HTTPException(status_code=409, detail=reason)

    # Only a DUPLICATE-NAME refusal means "already done". Checking for an
    # existing case on any refusal would let a stale case mask a new, genuine
    # one -- a ticker whose industry mapping later broke would keep answering
    # 200 with the old id instead of reporting `unmapped_industry`.
    is_duplicate = reason.startswith("not_storable:") and "already exists" in reason
    existing = find_conservative_case_id(ticker) if is_duplicate else None
    if existing is not None:
        return APIResponse(data=_conservative_result(existing, created=False))

    raise HTTPException(status_code=422, detail=reason)
