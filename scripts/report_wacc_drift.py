"""Read-only report: saved corporate_metrics.wacc against the WACC the current resolver gives.

Plan 2026-11-16-wacc-ke-live-premia S4 / owner answer 6: drifting rows are listed so the owner
re-saves them by hand; nothing is ever recomputed into the database.

The source DB is opened with a read-only URI and copied (sqlite backup) into a temporary file; the
metric path runs on that copy, so the original is never written, not even a WAL pragma. Metric
computation reads only locally stored statements (no network). A ticker without stored statements
is reported as "not computed".

Usage (from project root):
    python scripts/report_wacc_drift.py [--db PATH] [--threshold 0.25] [--all]
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

DEFAULT_THRESHOLD = 0.25


def _snapshot(source: Path, target: Path) -> None:
    src = sqlite3.connect(f"{source.resolve().as_uri()}?mode=ro", uri=True)
    try:
        dst = sqlite3.connect(str(target))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()


def collect(db_path: Path, threshold: float = DEFAULT_THRESHOLD, show_all: bool = False) -> list[dict]:
    """One dict per saved row: ticker, saved, live (None = not computed), diff, as_of, drifts."""
    from apps.api.services import db as db_service
    from apps.api.services import corporate_metrics_service as service
    from apps.api.services.corporate_statement_metrics import get_yahoo_statement_bundle, yahoo_statement_metrics
    from apps.api.services.market_assumptions import AssumptionsMissing, resolve_assumptions

    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "snapshot.db"
        _snapshot(db_path, copy)
        original = db_service._DB_PATH
        db_service._DB_PATH = copy
        try:
            with db_service.get_db() as conn:
                saved = [dict(r) for r in conn.execute(
                    "SELECT ticker, wacc FROM corporate_metrics WHERE wacc IS NOT NULL ORDER BY ticker")]
                resolved = resolve_assumptions(conn, datetime.now(timezone.utc))
            if isinstance(resolved, AssumptionsMissing):
                as_of = "missing: " + ", ".join(resolved.missing)
            else:
                as_of = f"rf {resolved.risk_free_as_of}, erp {resolved.erp_as_of}, crp {resolved.crp_as_of}"
            rows = []
            for item in saved:
                live = None
                if not isinstance(resolved, AssumptionsMissing):
                    fallback, _ = service.load_fallback_metrics(item["ticker"])
                    computed = yahoo_statement_metrics(
                        item["ticker"], fallback, bundle_loader=get_yahoo_statement_bundle, assumptions=resolved)
                    live = computed.wacc if computed is not None else None
                diff = None if live is None else live - float(item["wacc"])
                drifts = diff is not None and abs(diff) > threshold
                if show_all or drifts or live is None:
                    rows.append({"ticker": item["ticker"], "saved": float(item["wacc"]), "live": live,
                                 "diff": diff, "as_of": as_of, "drifts": drifts})
            return rows
        finally:
            db_service._DB_PATH = original


def format_report(rows: list[dict]) -> str:
    lines = [f"{'ticker':<8}{'saved':>8}{'live':>8}{'diff(pt)':>10}  assumptions as-of"]
    for r in rows:
        live = "n/c" if r["live"] is None else f"{r['live']:.2f}"
        diff = "not computed" if r["diff"] is None else f"{r['diff']:+.2f}"
        lines.append(f"{r['ticker']:<8}{r['saved']:>8.2f}{live:>8}{diff:>10}  {r['as_of']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--db", type=Path, default=ROOT / "data" / "processed" / "moneyview.db")
    parser.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD, help="points; default 0.25")
    parser.add_argument("--all", action="store_true", help="also list rows that did not drift")
    args = parser.parse_args(argv)
    if not args.db.exists():
        print(f"database not found: {args.db}", file=sys.stderr)
        return 1
    print(format_report(collect(args.db, args.threshold, args.all)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
