"""Tests for the read-only backfill reproduction script.

Each test's docstring names the mutation it was shown to catch (CLAUDE.md §8).
"""
from __future__ import annotations

import hashlib
from datetime import date
from pathlib import Path

from apps.api.services import db as db_service
from scripts.risk import reproduce_backfill as rb
from scripts.risk.reproduce_backfill import ExpectedAlert, diff_alerts, parse_report_alerts

REPORT = Path(__file__).resolve().parents[2] / "docs/superpowers/specs/2026-10-19-risk-engine-evidence/report3.md"


def test_parse_report_alerts_reads_eleven():
    alerts = parse_report_alerts(REPORT.read_text(encoding="utf-8"))
    assert len(alerts) == 11
    assert alerts[0].start == date(2019, 1, 29)
    assert alerts[0].release == date(2019, 1, 30)
    assert alerts[0].trigger == ("ai_semis", "big_tech")
    assert alerts[-1].start == date(2026, 10, 8)
    assert alerts[-1].release is None


def test_diff_alerts_matched_missing_extra():
    e = lambda d: ExpectedAlert(d, None, ("a",))  # noqa: E731
    d1, d2, d3 = date(2020, 1, 1), date(2020, 2, 1), date(2020, 3, 1)
    diff = diff_alerts([e(d1), e(d2)], [e(d2), e(d3)])
    assert [x.start for x, _ in diff.matched] == [d2]
    assert [x.start for x in diff.missing] == [d1]
    assert [x.start for x in diff.extra] == [d3]


def test_script_is_read_only(monkeypatch):
    """Mutation caught: compute_alerts leaves _DB_PATH on the original file while loading inputs."""
    src = db_service.get_db_path()
    before = hashlib.sha256(src.read_bytes()).hexdigest()
    seen = {}

    def fake_load(**_kw):
        seen["path"] = db_service.get_db_path()
        raise RuntimeError("stop after path capture")

    monkeypatch.setattr("apps.api.services.risk.inputs.load_inputs", fake_load)
    try:
        rb.compute_alerts(src)
    except RuntimeError:
        pass
    assert seen["path"] != src
    assert hashlib.sha256(src.read_bytes()).hexdigest() == before
    assert db_service.get_db_path() == src  # the override was restored
