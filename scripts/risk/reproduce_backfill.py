"""Recompute past risk alerts from the local DB and diff them against the research report's alerts.

Read-only. The app's get_db() sets WAL and may create files, so it cannot be opened with
``mode=ro``. The script therefore copies the DB (and any -wal/-shm sidecars) to a temp
directory, points the app's DB path at the copy, and evaluates in memory. The original file
is never opened for writing. The FRED series come from the cache table; nothing is fetched.

    python scripts/risk/reproduce_backfill.py [--db PATH] [--compare REPORT.md]
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

DEFAULT_REPORT = ROOT / "docs/superpowers/specs/2026-10-19-risk-engine-evidence/report3.md"
DEFAULT_DB = ROOT / "data/processed/moneyview.db"
_SECTION = "## Pick: every alert"


@dataclass(frozen=True)
class ExpectedAlert:
    start: date
    release: date | None
    trigger: tuple[str, ...]


@dataclass(frozen=True)
class AlertDiff:
    matched: list
    missing: list
    extra: list


def parse_report_alerts(md: str) -> list[ExpectedAlert]:
    """Rows of the table under '## Pick: every alert'; release 'open' becomes None."""
    section = md.split(_SECTION, 1)[1]
    section = re.split(r"\n## ", section, maxsplit=1)[0]
    out: list[ExpectedAlert] = []
    for line in section.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5 or not cells[0].isdigit():
            continue
        release = None if cells[2] == "open" else date.fromisoformat(cells[2])
        out.append(ExpectedAlert(date.fromisoformat(cells[1]), release,
                                 tuple(t.strip() for t in cells[4].split(","))))
    return out


def diff_alerts(expected: list, actual: list) -> AlertDiff:
    """Match by start date. matched is (expected, actual) pairs; missing/extra are the leftovers."""
    by_start = {a.start: a for a in actual}
    exp_starts = {e.start for e in expected}
    return AlertDiff(
        matched=[(e, by_start[e.start]) for e in expected if e.start in by_start],
        missing=[e for e in expected if e.start not in by_start],
        extra=[a for a in actual if a.start not in exp_starts],
    )


def _copy_db(src: Path, dest_dir: Path) -> Path:
    dest = dest_dir / "moneyview.db"
    shutil.copy2(src, dest)
    for suffix in ("-wal", "-shm"):
        side = Path(str(src) + suffix)
        if side.exists():
            shutil.copy2(side, Path(str(dest) + suffix))
    return dest


def compute_alerts(db: Path):
    """Evaluate eval_start..last day on a temp copy of `db`; returns (alerts, warnings_by_start)."""
    from apps.api.services import db as db_service
    from apps.api.services.risk.inputs import load_inputs
    from apps.api.services.risk.rules import get_rules
    from packages.core_finance.risk_signals.evaluate import evaluate_range

    loaded = get_rules()
    rules = loaded.rules
    with tempfile.TemporaryDirectory() as tmp:
        copy = _copy_db(db, Path(tmp))
        original = db_service._DB_PATH
        db_service._DB_PATH = copy
        try:
            inputs = load_inputs(fetch_fred=False, loaded=loaded)
        finally:
            db_service._DB_PATH = original
    last = inputs.sox.index.max().date()
    res = evaluate_range(inputs.closes, inputs.sox, inputs.rsp, inputs.shares, inputs.themes,
                         inputs.fred, rules, start=rules.eval_start, end=last)
    by_day = {d.day: d for d in res.days}
    alerts = list(res.closed) + ([res.open] if res.open is not None else [])
    on = {a.start: tuple(w for w, (state, _v, _o) in by_day[a.start].warnings.items() if state == "on")
          for a in alerts if a.start in by_day}
    return alerts, on


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--compare", type=Path, default=DEFAULT_REPORT)
    args = ap.parse_args(argv)

    alerts, on = compute_alerts(args.db)
    print("start        release      trigger                                   warnings on")
    for a in alerts:
        rel = getattr(a, "release", None)
        print(f"{a.start}   {str(rel) if rel else 'open':<11}  {', '.join(a.trigger):<40}  "
              f"{', '.join(on.get(a.start, ()))}")
    expected = parse_report_alerts(args.compare.read_text(encoding="utf-8"))
    diff = diff_alerts(expected, alerts)
    print(f"\nreport alerts {len(expected)}, recomputed {len(alerts)}: "
          f"matched {len(diff.matched)}, missing {len(diff.missing)}, extra {len(diff.extra)}")
    for e, a in diff.matched:
        rel = getattr(a, "release", None)
        note = "" if (e.release == rel and e.trigger == tuple(a.trigger)) else "  (release/trigger differ)"
        print(f"  matched  {e.start}{note}")
    for e in diff.missing:
        print(f"  missing  {e.start}")
    for a in diff.extra:
        print(f"  extra    {a.start}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
