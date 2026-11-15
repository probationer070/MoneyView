"""Market assumptions resolver: risk-free rate, equity risk premium and non-mature CRP.

Plan 2026-11-16-wacc-ke-live-premia section 1. A pure function of (db connection, now): reads only
the local DB (fred_cache and market_assumptions), never the network, no side effects but log lines.
All rates are percent points (4.2 = 4.2 %); `rf_fraction` / `erp_fraction` are the one conversion
point for builders that take fractions.
"""
from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from datetime import date, datetime

logger = logging.getLogger(__name__)

RF_MAX_AGE_DAYS = 7
RF_STALE_DAYS = 90
ERP_STALE_DAYS = 120
FRED_SERIES = "DGS10"
FRED_SOURCE = "FRED DGS10"

_RANGES = {
    "risk_free_fallback": (-0.5, 15.0),
    "equity_risk_premium": (2.0, 12.0),
    "crp_non_mature": (0.0, 10.0),
}


@dataclass(frozen=True)
class Assumptions:
    risk_free_rate: float
    risk_free_source: str
    risk_free_as_of: str
    equity_risk_premium: float
    erp_source: str
    erp_as_of: str
    crp_non_mature: float
    crp_as_of: str
    stale: tuple[str, ...] = ()

    @property
    def rf_fraction(self) -> float:
        return self.risk_free_rate / 100.0

    @property
    def erp_fraction(self) -> float:
        return self.equity_risk_premium / 100.0


@dataclass(frozen=True)
class AssumptionsMissing:
    missing: tuple[str, ...]
    code: str = "assumptions_missing"


def _latest_row(conn: sqlite3.Connection, key: str):
    """Newest as_of whose value is inside its range; out-of-range rows (manual SQL) are skipped."""
    low, high = _RANGES[key]
    rows = conn.execute(
        "SELECT value, as_of, source FROM market_assumptions WHERE key = ? ORDER BY as_of DESC", (key,)
    ).fetchall()
    for row in rows:
        if low <= row["value"] <= high:
            return row
        logger.warning("market_assumptions.out_of_range key=%s as_of=%s value=%s", key, row["as_of"], row["value"])
    return None


def _fresh_fred_rf(conn: sqlite3.Connection, today: date):
    low, high = _RANGES["risk_free_fallback"]
    rows = conn.execute(
        "SELECT obs_date, value FROM fred_cache WHERE series_id = ? ORDER BY obs_date DESC", (FRED_SERIES,)
    ).fetchall()
    for row in rows:
        if (today - date.fromisoformat(row["obs_date"])).days > RF_MAX_AGE_DAYS:
            return None
        if low <= row["value"] <= high:
            return row
        logger.warning("market_assumptions.fred_out_of_range obs_date=%s value=%s", row["obs_date"], row["value"])
    return None


def _age_days(as_of: str, today: date) -> int:
    return (today - date.fromisoformat(as_of)).days


def resolve_assumptions(conn: sqlite3.Connection, now: datetime) -> Assumptions | AssumptionsMissing:
    today = now.date()
    missing: list[str] = []
    stale: list[str] = []

    fred = _fresh_fred_rf(conn, today)
    if fred is not None:
        rf, rf_source, rf_as_of = float(fred["value"]), FRED_SOURCE, fred["obs_date"]
    else:
        fallback = _latest_row(conn, "risk_free_fallback")
        if fallback is None:
            missing.append("risk_free")
            rf, rf_source, rf_as_of = 0.0, "", ""
        else:
            rf, rf_source, rf_as_of = float(fallback["value"]), fallback["source"], fallback["as_of"]
            if _age_days(rf_as_of, today) > RF_STALE_DAYS:
                stale.append("risk_free")

    erp_row = _latest_row(conn, "equity_risk_premium")
    if erp_row is None:
        missing.append("erp")
    elif _age_days(erp_row["as_of"], today) > ERP_STALE_DAYS:
        stale.append("erp")

    crp_row = _latest_row(conn, "crp_non_mature")
    if crp_row is None:
        missing.append("crp")

    if missing:
        return AssumptionsMissing(missing=tuple(missing))
    return Assumptions(
        risk_free_rate=rf,
        risk_free_source=rf_source,
        risk_free_as_of=rf_as_of,
        equity_risk_premium=float(erp_row["value"]),
        erp_source=erp_row["source"],
        erp_as_of=erp_row["as_of"],
        crp_non_mature=float(crp_row["value"]),
        crp_as_of=crp_row["as_of"],
        stale=tuple(stale),
    )


class AssumptionsRefused(Exception):
    """Raised where a number cannot be produced because the market assumptions are missing.

    Routes turn it into the `assumptions_missing` payload (HTTP 200), never a silent default.
    """

    def __init__(self, missing: tuple[str, ...]):
        super().__init__(f"market assumptions missing: {', '.join(missing)}")
        self.missing = tuple(missing)
        self.code = "assumptions_missing"


def capm_cost_of_equity_pct(a: Assumptions, levered_beta: float, crp_pct: float) -> float:
    """The one CAPM cost of equity, in percent: rf + beta x ERP + CRP (plan section 3, S2a)."""
    return a.risk_free_rate + levered_beta * a.equity_risk_premium + crp_pct


def assumptions_missing_reason(exc: AssumptionsRefused) -> str:
    """The refusal reason string of the case generators (prefix kept, as their other reasons do)."""
    return f"assumptions_missing: {', '.join(exc.missing)} not on file; enter it under Market assumptions"


class AssumptionRejected(ValueError):
    """The owner row is invalid (unknown key, range, date, source) or duplicates (key, as_of)."""

    def __init__(self, message: str, *, duplicate: bool = False):
        super().__init__(message)
        self.duplicate = duplicate


def assumption_history(conn: sqlite3.Connection) -> list[dict]:
    rows = conn.execute(
        "SELECT key, value, as_of, source, updated_at FROM market_assumptions ORDER BY key, as_of DESC"
    ).fetchall()
    return [dict(r) for r in rows]


def add_assumption(conn: sqlite3.Connection, key: str, value: float, as_of: str, source: str, now: datetime) -> dict:
    """Append one dated owner row. A single INSERT: no UPDATE or DELETE path exists, and a second
    row with the same (key, as_of) is refused, never overwritten."""
    if key not in _RANGES:
        raise AssumptionRejected(f"unknown key {key!r}")
    low, high = _RANGES[key]
    if not (low <= value <= high):
        raise AssumptionRejected(f"{key} must be between {low} and {high} percent points")
    try:
        day = date.fromisoformat(as_of)
    except ValueError:
        raise AssumptionRejected("as_of must be an ISO date (YYYY-MM-DD)") from None
    if day.isoformat() != as_of:
        raise AssumptionRejected("as_of must be an ISO date (YYYY-MM-DD)")
    if (day - now.date()).days > 1:
        raise AssumptionRejected("as_of must not be in the future")
    if not source or not source.strip():
        raise AssumptionRejected("source must not be empty")
    updated_at = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        conn.execute(
            "INSERT INTO market_assumptions (key, value, as_of, source, updated_at) VALUES (?, ?, ?, ?, ?)",
            (key, value, as_of, source.strip(), updated_at),
        )
    except sqlite3.IntegrityError as exc:
        if "UNIQUE" not in str(exc).upper():
            raise
        raise AssumptionRejected(f"{key} already has a row for {as_of}", duplicate=True) from None
    return {"key": key, "value": value, "as_of": as_of, "source": source.strip(), "updated_at": updated_at}
