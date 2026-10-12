"""SQLite reads and writes for the macro signal engine.

Same overwrite-by-key pattern as industry_benchmark_store.store_vintage, keyed by ISO week.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Mapping, Sequence

from apps.api.services.db import get_db
from packages.core_finance.macro_signals.rules import Observation


def iso_week(d: date) -> str:
    year, week, _ = d.isocalendar()
    return f"{year}-W{week:02d}"


@dataclass(frozen=True)
class ResultRow:
    rule_id: str
    state: str
    value: float | None
    observed_at: str | None
    threshold: float | None
    note: str
    contribution: dict[str, float] | None


@dataclass(frozen=True)
class StoredSnapshot:
    id: int
    iso_week: str
    run_at: str
    rules_version: str
    probs: dict[str, float]
    results: tuple[ResultRow, ...]


@dataclass(frozen=True)
class HistoryRow:
    iso_week: str
    run_at: str
    rules_version: str
    a: float
    b: float
    c: float


@dataclass(frozen=True)
class ManualInput:
    state: str
    note: str
    updated_at: str


def save_snapshot(*, iso_week: str, run_at: str, rules_version: str,
                  probs: Mapping[str, float], results: Sequence[ResultRow]) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT INTO signal_snapshots (iso_week, run_at, rules_version, prob_a, prob_b, prob_c)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(iso_week) DO UPDATE SET run_at = excluded.run_at,
                 rules_version = excluded.rules_version, prob_a = excluded.prob_a,
                 prob_b = excluded.prob_b, prob_c = excluded.prob_c""",
            (iso_week, run_at, rules_version, probs["a"], probs["b"], probs["c"]),
        )
        snapshot_id = conn.execute(
            "SELECT id FROM signal_snapshots WHERE iso_week = ?", (iso_week,)).fetchone()["id"]
        conn.execute("DELETE FROM signal_results WHERE snapshot_id = ?", (snapshot_id,))
        conn.executemany(
            """INSERT INTO signal_results (snapshot_id, rule_id, state, value, observed_at, threshold,
                 note, contrib_a, contrib_b, contrib_c) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [(snapshot_id, r.rule_id, r.state, r.value, r.observed_at, r.threshold, r.note,
              *((r.contribution or {}).get(s) for s in "abc")) for r in results],
        )


def _load(conn, row) -> StoredSnapshot:
    results = conn.execute(
        "SELECT * FROM signal_results WHERE snapshot_id = ? ORDER BY rowid", (row["id"],)).fetchall()
    return StoredSnapshot(
        id=row["id"], iso_week=row["iso_week"], run_at=row["run_at"], rules_version=row["rules_version"],
        probs={"a": row["prob_a"], "b": row["prob_b"], "c": row["prob_c"]},
        results=tuple(
            ResultRow(r["rule_id"], r["state"], r["value"], r["observed_at"], r["threshold"], r["note"] or "",
                      None if r["contrib_a"] is None else {s: r[f"contrib_{s}"] for s in "abc"})
            for r in results),
    )


def _one(sql: str, params: tuple) -> StoredSnapshot | None:
    with get_db() as conn:
        row = conn.execute(sql, params).fetchone()
        return _load(conn, row) if row else None


def load_snapshot(week: str) -> StoredSnapshot | None:
    return _one("SELECT * FROM signal_snapshots WHERE iso_week = ?", (week,))


def latest_snapshot() -> StoredSnapshot | None:
    return _one("SELECT * FROM signal_snapshots ORDER BY iso_week DESC LIMIT 1", ())


def previous_snapshot(week: str) -> StoredSnapshot | None:
    return _one("SELECT * FROM signal_snapshots WHERE iso_week < ? ORDER BY iso_week DESC LIMIT 1", (week,))


def history(weeks: int) -> list[HistoryRow]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM signal_snapshots ORDER BY iso_week DESC LIMIT ?", (weeks,)).fetchall()
    return [HistoryRow(r["iso_week"], r["run_at"], r["rules_version"], r["prob_a"], r["prob_b"], r["prob_c"])
            for r in reversed(rows)]


def get_manual_inputs(week: str) -> dict[str, ManualInput]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM signal_manual_inputs WHERE iso_week = ?", (week,)).fetchall()
    return {r["rule_id"]: ManualInput(r["state"], r["note"] or "", r["updated_at"]) for r in rows}


def put_manual_input(rule_id: str, week: str, state: str, note: str, updated_at: str) -> None:
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO signal_manual_inputs (rule_id, iso_week, state, note, updated_at) "
            "VALUES (?, ?, ?, ?, ?)", (rule_id, week, state, note, updated_at))


def save_cache(series_id: str, observations: Sequence[Observation], fetched_at: str) -> None:
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO fred_cache (series_id, obs_date, value, fetched_at) VALUES (?, ?, ?, ?)",
            [(series_id, o.date.isoformat(), o.value, fetched_at) for o in observations])


def load_cache(series_id: str, start: date) -> list[Observation]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT obs_date, value FROM fred_cache WHERE series_id = ? AND obs_date >= ? ORDER BY obs_date",
            (series_id, start.isoformat())).fetchall()
    return [Observation(date.fromisoformat(r["obs_date"]), r["value"]) for r in rows]
