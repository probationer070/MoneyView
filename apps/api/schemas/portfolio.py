"""
Portfolio API schema source exports.

Pydantic models remain the source of truth. This module gives schema export
tooling a stable import path for portfolio/report contracts.
"""

from apps.api.models.schemas import (
    APIResponse,
    AttributionDataContract,
    AttributionEffects,
    AttributionMetadata,
    AttributionRequest,
    AttributionResult,
    AttributionTotals,
    BenchmarkDefinition,
    BenchmarkWeightsSourceEnum,
    CorporateComparisonResponse,
    CorporateComparisonHistoryPoint,
    CorporateComparisonHistoryResponse,
    CorporateComparisonRow,
    CorporateComparisonSnapshotMeta,
    PortfolioInput,
    ReportExportFormatEnum,
    ReportExportRequest,
    ReportExportResponse,
    ReportFilters,
    ReportOptions,
    ReportPayload,
    ReportSummaryRequest,
    RiskMetrics,
    RiskProfileInput,
    SectorAttribution,
    WatchlistSyncResult,
    WatchlistSyncStatus,
)

__all__ = [
    "APIResponse",
    "AttributionDataContract",
    "AttributionEffects",
    "AttributionMetadata",
    "AttributionRequest",
    "AttributionResult",
    "AttributionTotals",
    "BenchmarkDefinition",
    "BenchmarkWeightsSourceEnum",
    "CorporateComparisonResponse",
    "CorporateComparisonHistoryPoint",
    "CorporateComparisonHistoryResponse",
    "CorporateComparisonRow",
    "CorporateComparisonSnapshotMeta",
    "PortfolioInput",
    "ReportExportFormatEnum",
    "ReportExportRequest",
    "ReportExportResponse",
    "ReportFilters",
    "ReportOptions",
    "ReportPayload",
    "ReportSummaryRequest",
    "RiskMetrics",
    "RiskProfileInput",
    "SectorAttribution",
    "WatchlistSyncResult",
    "WatchlistSyncStatus",
]

