"""Recompute past risk alerts from the local DB and diff them against the research report's alerts.

Read-only. The app's get_db() sets WAL and may create files, so it cannot be pointed at the
real DB. The script opens the DB with ``mode=ro`` and takes a SQLite online backup into a temp
directory (one consistent snapshot even while the app writes), points the app's DB path at the
copy, and evaluates in memory. The original file is never opened for writing. The FRED series
come from the cache table; nothing is fetched.

    python scripts/risk/reproduce_backfill.py [--db PATH] [--compare REPORT.md]
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
import tempfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

DEFAULT_REPORT = ROOT / "docs/superpowers/specs/2026-10-19-risk-engine-evidence/report3.md"
DEFAULT_DB = ROOT / "data/processed/moneyview.db"
DEFAULT_SURGE_REPORT = ROOT / "docs/superpowers/specs/2026-10-19-surge-signal-evidence/report_surge_pick4.md"
_SECTION = "## Pick: every alert"
_SURGE_SECTION = "## Events"
# the engine's end reasons, named as the research report names them
_REASON_NAMES = {"below_ema": "ema_break", "stalled": "quiet10", None: "open"}


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


def alert_matches(expected: ExpectedAlert, actual) -> bool:
    """Same release and the same trigger themes; trigger order is not significant."""
    return expected.release == getattr(actual, "release", None) and set(expected.trigger) == set(actual.trigger)


@dataclass(frozen=True)
class ExpectedSurge:
    theme: str
    start: date
    end: date | None
    end_reason: str  # ema_break | quiet10 | open
    shown: bool


@dataclass(frozen=True)
class SurgeDiff:
    matched: list  # (expected, actual) pairs
    missing: list
    extra: list
    mismatches: list  # (theme, start, field, expected, actual)


def parse_surge_events(md: str) -> list[ExpectedSurge]:
    """Rows of the table under '## Events': theme, start, end, end_reason, shown ('open' end becomes None)."""
    section = md.split(_SURGE_SECTION, 1)[1]
    section = re.split(r"\n## ", section, maxsplit=1)[0]
    out: list[ExpectedSurge] = []
    for line in section.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 5 or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", cells[1]):
            continue
        end = None if cells[2] == "open" else date.fromisoformat(cells[2])
        out.append(ExpectedSurge(cells[0], date.fromisoformat(cells[1]), end, cells[3], cells[4] == "yes"))
    return out


def diff_surge(expected: list, actual: list, shown: dict) -> SurgeDiff:
    """Match by (theme, start). ``actual`` are SurgeEvents; ``shown`` maps (theme, start) to the banner
    flag on the start day. Matched pairs are also checked for end, end_reason and shown."""
    by_key = {(a.theme, a.start): a for a in actual}
    exp_keys = {(e.theme, e.start) for e in expected}
    matched = [(e, by_key[(e.theme, e.start)]) for e in expected if (e.theme, e.start) in by_key]
    mismatches = []
    for e, a in matched:
        got = {"end": a.end, "end_reason": _REASON_NAMES.get(a.end_reason, a.end_reason),
               "shown": bool(shown.get((a.theme, a.start), False))}
        for field in ("end", "end_reason", "shown"):
            want = getattr(e, field)
            if want != got[field]:
                mismatches.append((e.theme, e.start, field, want, got[field]))
    return SurgeDiff(
        matched=matched,
        missing=[e for e in expected if (e.theme, e.start) not in by_key],
        extra=[a for a in actual if (a.theme, a.start) not in exp_keys],
        mismatches=mismatches,
    )


def _copy_db(src: Path, dest_dir: Path) -> Path:
    dest = dest_dir / "moneyview.db"
    source = sqlite3.connect(f"{Path(src).resolve().as_uri()}?mode=ro", uri=True)
    try:
        target = sqlite3.connect(dest)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()
    return dest


def _evaluate(db: Path):
    """Evaluate eval_start..last day on a temp copy of `db`; returns the EvaluationResult."""
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
    return res


def compute_alerts(res):
    """Returns (alerts, warnings_by_start) of `_evaluate`'s result."""
    by_day = {d.day: d for d in res.days}
    alerts = list(res.closed) + ([res.open] if res.open is not None else [])
    on = {a.start: tuple(w for w, (state, _v, _o) in by_day[a.start].warnings.items() if state == "on")
          for a in alerts if a.start in by_day}
    return alerts, on


def compute_surge(res):
    """Returns (surge events closed or open, {(theme, start): banner shown on the start day}) of
    `_evaluate`'s result."""
    events = list(res.surge_closed) + list(res.surge_state.open.values())
    shown = {(t, d.day): flag for d in res.days for t, flag in d.surge_shown.items()}
    return events, shown


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", type=Path, default=DEFAULT_DB)
    ap.add_argument("--compare", type=Path, default=DEFAULT_REPORT)
    ap.add_argument("--compare-surge", type=Path, default=DEFAULT_SURGE_REPORT)
    args = ap.parse_args(argv)

    res = _evaluate(args.db)  # one copy and one full evaluation serve both diffs
    alerts, on = compute_alerts(res)
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
        note = "" if alert_matches(e, a) else "  (release/trigger differ)"
        print(f"  matched  {e.start}{note}")
    for e in diff.missing:
        print(f"  missing  {e.start}")
    for a in diff.extra:
        print(f"  extra    {a.start}")

    events, shown = compute_surge(res)
    exp_surge = parse_surge_events(args.compare_surge.read_text(encoding="utf-8"))
    sd = diff_surge(exp_surge, events, shown)
    print(f"\nreport surge events {len(exp_surge)}, recomputed {len(events)}: "
          f"matched {len(sd.matched)}, missing {len(sd.missing)}, extra {len(sd.extra)}, "
          f"field mismatches {len(sd.mismatches)}")
    for theme, start, field, want, got in sd.mismatches:
        print(f"  differ   {theme} {start} {field}: report {want}, recomputed {got}")
    for e in sd.missing:
        print(f"  missing  {e.theme} {e.start}")
    for a in sd.extra:
        print(f"  extra    {a.theme} {a.start}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
