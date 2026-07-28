"""compute-service portfolio operations. Domain models only — no web envelope.

Uses the shared serializer (dumps_model/loads_model) on BOTH the request and the
response — NOT FastAPI's default pydantic serializer — so the "single serializer,
both ends" invariant (spec §A-3) holds even for non-finite floats. FastAPI's
default response serializer would coerce NaN/Inf to null and break the round trip.
"""
from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, Request, Response

from apps.api.compute.serialization import dumps_model, loads_model
from apps.api.models.schemas import AttributionRequest, AttributionResult
from apps.api.services.market_data import MarketDataService
from apps.api.services.portfolio_service import PortfolioAnalyticsService

router = APIRouter()
_analytics = PortfolioAnalyticsService(MarketDataService())


@router.post("/portfolio/attribution")
async def compute_attribution(request: Request) -> Response:
    started = time.perf_counter()
    payload = loads_model(AttributionRequest, (await request.body()).decode("utf-8"))
    try:
        result = _analytics.build_attribution(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    duration_ms = round((time.perf_counter() - started) * 1000, 1)
    return Response(
        content=dumps_model(result),
        media_type="application/json",
        headers={"X-Compute-Duration-Ms": str(duration_ms)},
    )
