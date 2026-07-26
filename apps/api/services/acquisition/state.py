"""Persistent record of what we have asked for and when.

Freshness asks "have I asked since the boundary?", so this table records our own
actions rather than inferring them from which rows happen to be present. Inference
cannot tell a provider gap from a market holiday; a coverage record can.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum

from apps.api.services.db import get_db

class AcquisitionStatus(StrEnum):
    """The single definition site for every status value.

    StrEnum, so `status == "ok"` still holds for existing comparisons and SQLite binds
    a member without `.value`, while a typo becomes an AttributeError at import instead
    of a string that silently matches nothing.
    """

    NEVER_ACQUIRED = "never_acquired"
    OK = "ok"
    EMPTY = "empty"
    FAILED = "failed"
    RETIRED = "retired"


@dataclass(frozen=True)
class AcquisitionState:
    data_class: str
    subject: str
    last_checked_at: datetime | None = None
    last_success_at: datetime | None = None
    covered_from: date | None = None
    covered_to: date | None = None
    status: str = AcquisitionStatus.NEVER_ACQUIRED
    detail: str | None = None


def _parse_datetime(raw: str | None) -> datetime | None:
    if not raw:
        return None
    parsed = datetime.fromisoformat(raw)
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _parse_date(raw: str | None) -> date | None:
    return date.fromisoformat(raw) if raw else None


def read_state(data_class: str, subject: str) -> AcquisitionState:
    with get_db() as conn:
        row = conn.execute(
            """SELECT last_checked_at, last_success_at, covered_from, covered_to, status, detail
               FROM acquisition_state WHERE data_class = ? AND subject = ?""",
            (data_class, subject),
        ).fetchone()
    if row is None:
        return AcquisitionState(data_class=data_class, subject=subject)
    return AcquisitionState(
        data_class=data_class,
        subject=subject,
        last_checked_at=_parse_datetime(row["last_checked_at"]),
        last_success_at=_parse_datetime(row["last_success_at"]),
        covered_from=_parse_date(row["covered_from"]),
        covered_to=_parse_date(row["covered_to"]),
        status=row["status"],
        detail=row["detail"],
    )


def record_check(
    data_class: str,
    subject: str,
    *,
    now: datetime,
    status: AcquisitionStatus,
    detail: str | None = None,
) -> None:
    """Record that we asked. Deliberately leaves last_success_at and coverage alone:
    a failed refresh must not blank data that is still being served."""
    with get_db() as conn:
        conn.execute(
            """INSERT INTO acquisition_state (data_class, subject, last_checked_at, status, detail)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(data_class, subject) DO UPDATE SET
                   last_checked_at = excluded.last_checked_at,
                   status = excluded.status,
                   detail = excluded.detail""",
            (data_class, subject, now.isoformat(), status, detail),
        )


def record_success(
    data_class: str, subject: str, *, now: datetime, covered_from: date, covered_to: date
) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT INTO acquisition_state
                   (data_class, subject, last_checked_at, last_success_at,
                    covered_from, covered_to, status, detail)
               VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
               ON CONFLICT(data_class, subject) DO UPDATE SET
                   last_checked_at = excluded.last_checked_at,
                   last_success_at = excluded.last_success_at,
                   covered_from = MIN(COALESCE(acquisition_state.covered_from, excluded.covered_from),
                                      excluded.covered_from),
                   covered_to = MAX(COALESCE(acquisition_state.covered_to, excluded.covered_to),
                                    excluded.covered_to),
                   status = excluded.status,
                   detail = NULL""",
            (
                data_class, subject, now.isoformat(), now.isoformat(),
                covered_from.isoformat(), covered_to.isoformat(), AcquisitionStatus.OK,
            ),
        )
