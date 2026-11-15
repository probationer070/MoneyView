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
