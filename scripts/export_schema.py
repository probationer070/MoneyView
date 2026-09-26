"""
Export portfolio/report JSON schemas for shared TypeScript generation.

Usage:
    python scripts/export_schema.py

The generated JSON is the input for json2ts/openapi-typescript style tooling.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from pydantic.json_schema import models_json_schema

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.schemas.portfolio import (
    AttributionRequest,
    AttributionResult,
    CorporateComparisonResponse,
    CorporateComparisonHistoryPoint,
    CorporateComparisonHistoryResponse,
    CorporateComparisonRow,
    CorporateComparisonSnapshotMeta,
    ReportExportRequest,
    ReportExportResponse,
    ReportPayload,
    ReportSummaryRequest,
    WatchlistSyncResult,
    WatchlistSyncStatus,
)


OUT_DIR = ROOT / "packages" / "shared-types" / "generated"
SCHEMA_PATH = OUT_DIR / "portfolio.schema.json"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # One shared $defs for every model. Calling model_json_schema() per model nested each
    # model's own $defs under it while its $refs still pointed at the root ("#/$defs/X"),
    # so json2ts failed with a missing-pointer error and the generated file silently
    # stopped being regenerated.
    _, shared = models_json_schema(
        [(model, "validation") for model in (
            AttributionRequest,
            AttributionResult,
            CorporateComparisonRow,
            CorporateComparisonSnapshotMeta,
            CorporateComparisonResponse,
            CorporateComparisonHistoryPoint,
            CorporateComparisonHistoryResponse,
            ReportSummaryRequest,
            ReportPayload,
            ReportExportRequest,
            ReportExportResponse,
            WatchlistSyncResult,
            WatchlistSyncStatus,
        )],
        ref_template="#/$defs/{model}",
    )
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "MoneyView Portfolio API Schemas",
        "description": "Generated from backend Pydantic models. Do not edit by hand.",
        "$defs": shared["$defs"],
    }
    SCHEMA_PATH.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    main()
