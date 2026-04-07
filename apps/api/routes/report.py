"""
Reporting routes for Phase 5 canonical export payload.
"""

from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schemas import (
    APIResponse,
    ReportExportRequest,
    ReportExportResponse,
    ReportPayload,
    ReportSummaryRequest,
)
from apps.api.services.portfolio_service import PortfolioAnalyticsService

router = APIRouter()
_report_service = PortfolioAnalyticsService()


@router.post("/summary", response_model=APIResponse[ReportPayload])
async def get_report_summary(payload: ReportSummaryRequest = Body(...)):
    """
    Build a canonical report payload used by HTML/PDF/Markdown/CSV/JSON exports.
    """
    try:
        report_payload = _report_service.build_report(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=report_payload)


@router.post("/export", response_model=APIResponse[ReportExportResponse])
async def export_report(payload: ReportExportRequest = Body(...)):
    """
    Backend static export renderer.
    """
    try:
        exported = _report_service.build_report_export(payload.request, payload.format)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return APIResponse(data=exported)
