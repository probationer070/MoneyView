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

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.schemas.portfolio import (
    AttributionRequest,
    AttributionResult,
    ReportExportRequest,
    ReportExportResponse,
    ReportPayload,
    ReportSummaryRequest,
)


OUT_DIR = ROOT / "packages" / "shared-types" / "generated"
SCHEMA_PATH = OUT_DIR / "portfolio.schema.json"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    schema = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "title": "MoneyView Portfolio API Schemas",
        "description": "Generated from backend Pydantic models. Do not edit by hand.",
        "$defs": {
            "AttributionRequest": AttributionRequest.model_json_schema(),
            "AttributionResult": AttributionResult.model_json_schema(),
            "ReportSummaryRequest": ReportSummaryRequest.model_json_schema(),
            "ReportPayload": ReportPayload.model_json_schema(),
            "ReportExportRequest": ReportExportRequest.model_json_schema(),
            "ReportExportResponse": ReportExportResponse.model_json_schema(),
        },
    }
    SCHEMA_PATH.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    main()
