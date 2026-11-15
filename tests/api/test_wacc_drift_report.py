"""scripts/report_wacc_drift.py: read-only drift list (plan 2026-11-16-wacc-ke-live-premia, S4)."""
import hashlib
import importlib.util
import os
import sqlite3
from pathlib import Path

import pytest

from apps.api.models.schemas import CorporateMetrics
from apps.api.services import corporate_statement_metrics as csm
from apps.api.services import db as db_service
from apps.api.services.db import get_db

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "report_wacc_drift.py"
LIVE = {"AAA": 10.6, "BBB": 9.1}  # saved AAA 10.0 (drifts 0.6), BBB 9.0 (0.1), CCC has no statements


def _load():
    spec = importlib.util.spec_from_file_location("report_wacc_drift", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def db_file(monkeypatch):
    path = db_service.get_db_path()
    with get_db() as conn:
        for t, w in (("AAA", 10.0), ("BBB", 9.0), ("CCC", 8.0)):
            conn.execute(
                "INSERT INTO corporate_metrics (ticker, wacc, updated_at) VALUES (?, ?, 'x')", (t, w))
    raw = sqlite3.connect(str(path))
    raw.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    raw.close()

    def fake(ticker, fallback, **kw):
        if ticker not in LIVE:
            return None
        return CorporateMetrics(ticker=ticker, wacc=LIVE[ticker])

    monkeypatch.setattr(csm, "yahoo_statement_metrics", fake)
    return path


def _fingerprint(path):
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), os.stat(path).st_mtime_ns


def test_lists_drifting_row_omits_small_one(db_file):
    # mutation: threshold ignored (all rows listed) / diff sign or live value wrong
    rows = _load().collect(db_file)
    by = {r["ticker"]: r for r in rows}
    assert set(by) == {"AAA", "CCC"}
    assert by["AAA"]["diff"] == pytest.approx(0.6) and by["AAA"]["drifts"]
    assert by["CCC"]["live"] is None and by["CCC"]["diff"] is None
    assert "rf 2026-11-16" in by["AAA"]["as_of"]
    text = _load().format_report(rows)
    assert "AAA" in text and "+0.60" in text and "BBB" not in text and "not computed" in text


def test_main_prints_and_db_untouched(db_file, capsys):
    # mutation: script commits to the DB (e.g. opens it read-write and writes)
    before = _fingerprint(db_file)
    assert _load().main(["--db", str(db_file)]) == 0
    assert "AAA" in capsys.readouterr().out
    assert _fingerprint(db_file) == before
    assert db_service._DB_PATH == db_file  # path restored


def test_detects_a_writing_script(db_file, monkeypatch):
    # proves the fingerprint check can fail: a write to the original is caught
    mod = _load()
    before = _fingerprint(db_file)
    real = mod._snapshot

    def writing_snapshot(source, target):
        real(source, target)
        c = sqlite3.connect(str(source))
        c.execute("UPDATE corporate_metrics SET wacc = 1 WHERE ticker = 'AAA'")
        c.commit()
        c.close()

    monkeypatch.setattr(mod, "_snapshot", writing_snapshot)
    mod.collect(db_file)
    assert _fingerprint(db_file) != before


def test_missing_db_is_an_error(tmp_path, capsys):
    assert _load().main(["--db", str(tmp_path / "nope.db")]) == 1
