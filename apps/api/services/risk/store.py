"""SQLite reads and writes for the risk-alert record (spec 2026-10-19 section 7).

Storage choices the spec leaves open:
- `risk_daily.warnings_json` is {"warnings": {id: {state, value, observed_at}}, "on_count": n,
  "w1_proxy": bool}. `sox_confirming` has its own column, so it is not repeated there.
- `risk_alerts.trigger_json` holds the trigger (start) themes that opened the alert, in walk order.
- `risk_alert_themes.last_ref` (not in section 7) keeps the stint's last 20-day-low date so a live
  day can resume the alert walk from the store.
- `risk_alert_cards.payload_json` holds the crash-card fields with no dedicated column
  (high_close, close, closes_30d). Candidate cards leave it NULL.
- Dates are ISO strings, timestamps UTC ISO 8601.
"""
from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Iterator, Mapping, Sequence

from apps.api.services.db import get_db
from packages.core_finance.risk_signals.alerts import ThemeStint
from packages.core_finance.risk_signals.decks import CandidateCard, CrashCard
from packages.core_finance.risk_signals.evaluate import DayResult


# get_db() opens a new connection per call, so it does not nest; a transaction shares one.
_tx = threading.local()


@contextmanager
def _db() -> Iterator:
    conn = getattr(_tx, "conn", None)
    if conn is not None:
        yield conn
        return
    with get_db() as own:
        yield own


@contextmanager
def transaction() -> Iterator[None]:
    """Every store call inside (this thread) commits together or not at all. Nested calls join it."""
    if getattr(_tx, "conn", None) is not None:
        yield
        return
    with get_db() as conn:  # commits on success, rolls back on an exception
        _tx.conn = conn
        try:
            yield
        finally:
            _tx.conn = None

@dataclass(frozen=True)
class StoredStint:
    theme: str
    via: str
    joined_date: date
    left_date: date | None
    dd20_at_join: float | None
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None
    max_dd10: float | None
    last_ref: date | None = None


@dataclass(frozen=True)
class StoredCard:
    snapshot: str
    deck: str
    rank: int
    ticker: str
    as_of: date
    drawdown_pct: float | None
    high_date: date | None
    pct_from_high63: float | None
    corr: float | None
    corr_with: str | None
    fwd5: float | None
    fwd10: float | None
    fwd20: float | None
    payload: dict | None


@dataclass(frozen=True)
class StoredAlert:
    id: int
    origin: str
    rules_version: str
    status: str
    start_date: date
    release_date: date | None
    release_reason: str | None
    primary_theme: str
    w1_proxy: bool
    trigger: tuple[str, ...]
    created_at: str
    stints: list[StoredStint] = field(default_factory=list)
    cards: dict[tuple[str, str], list[StoredCard]] = field(default_factory=dict)


@dataclass(frozen=True)
class StoredDay:
    date: date
    rules_version: str
    origin: str
    warnings: dict[str, dict]  # id -> {"state", "value", "observed_at"}
    on_count: int
    w1_proxy: bool
    confirming: dict[str, str]
    sox_confirming: bool
    cap_share: float
    bars_coverage: float
    evaluated_at: str


def _iso(d: date | None) -> str | None:
    return d.isoformat() if d is not None else None


def _date(s: str | None) -> date | None:
    return date.fromisoformat(s) if s else None


def save_day(result: DayResult, version: str, origin: str, coverage: float, evaluated_at: str) -> None:
    warnings = {
        wid: {"state": state, "value": value, "observed_at": _iso(observed)}
        for wid, (state, value, observed) in result.warnings.items()
    }
    blob = {"warnings": warnings, "on_count": result.on_count, "w1_proxy": result.w1_proxy}
    with _db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO risk_daily
               (date, rules_version, origin, warnings_json, confirming_json, sox_confirming,
                cap_share, bars_coverage, evaluated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (result.day.isoformat(), version, origin, json.dumps(blob),
             json.dumps(result.confirming), int(result.sox_confirm), result.cap_share,
             coverage, evaluated_at),
        )


def last_evaluated(version: str) -> date | None:
    with _db() as conn:
        row = conn.execute("SELECT MAX(date) FROM risk_daily WHERE rules_version = ?", (version,)).fetchone()
    return _date(row[0])


def insert_alert(start: date, trigger: Sequence[str], version: str, origin: str,
                 primary_theme: str, w1_proxy: bool) -> int:
    with _db() as conn:
        cur = conn.execute(
            """INSERT INTO risk_alerts
               (origin, rules_version, status, start_date, primary_theme, w1_proxy, trigger_json, created_at)
               VALUES (?, ?, 'open', ?, ?, ?, ?, ?)""",
            (origin, version, start.isoformat(), primary_theme, int(w1_proxy),
             json.dumps(list(trigger)), datetime.now(timezone.utc).isoformat()),
        )
        return int(cur.lastrowid)


def close_alert(alert_id: int, release: date, reason: str) -> None:
    with _db() as conn:
        conn.execute(
            "UPDATE risk_alerts SET status = 'released', release_date = ?, release_reason = ? WHERE id = ?",
            (release.isoformat(), reason, alert_id),
        )


def upsert_stint(alert_id: int, stint: ThemeStint, dd_at_join: float | None,
                 outcome: Mapping[str, float | None]) -> None:
    with _db() as conn:
        conn.execute(
            """INSERT INTO risk_alert_themes
               (alert_id, theme, via, joined_date, left_date, dd20_at_join, fwd5, fwd10, fwd20, max_dd10,
                last_ref)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(alert_id, theme, joined_date) DO UPDATE SET
                 via = excluded.via, left_date = excluded.left_date, dd20_at_join = excluded.dd20_at_join,
                 fwd5 = excluded.fwd5, fwd10 = excluded.fwd10, fwd20 = excluded.fwd20,
                 max_dd10 = excluded.max_dd10, last_ref = excluded.last_ref""",
            (alert_id, stint.theme, stint.via, stint.joined.isoformat(), _iso(stint.left), dd_at_join,
             outcome.get("fwd5"), outcome.get("fwd10"), outcome.get("fwd20"), outcome.get("max_dd10"),
             _iso(stint.last_ref)),
        )


def replace_cards(alert_id: int, snapshot: str, deck: str,
                  cards: Sequence[CrashCard | CandidateCard], as_of: date) -> None:
    with _db() as conn:
        conn.execute(
            "DELETE FROM risk_alert_cards WHERE alert_id = ? AND snapshot = ? AND deck = ?",
            (alert_id, snapshot, deck),
        )
        for rank, card in enumerate(cards, start=1):
            if isinstance(card, CrashCard):
                payload = json.dumps({"high_close": card.high_close, "close": card.close,
                                      "closes_30d": list(card.closes_30d)})
                values = (card.drawdown_pct, card.high_date.isoformat(), None, None, None, payload)
            else:
                values = (None, None, card.pct_from_high63, card.corr, card.corr_with, None)
            conn.execute(
                """INSERT INTO risk_alert_cards
                   (alert_id, snapshot, deck, rank, ticker, as_of, drawdown_pct, high_date,
                    pct_from_high63, corr, corr_with, payload_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (alert_id, snapshot, deck, rank, card.ticker, as_of.isoformat(), *values),
            )


def update_card_outcomes(alert_id: int, snapshot: str, deck: str, ticker: str,
                         outcome: Mapping[str, float | None]) -> None:
    """Write fwd5/fwd10/fwd20 of one card; keys absent from `outcome` are written as NULL."""
    with _db() as conn:
        conn.execute(
            """UPDATE risk_alert_cards SET fwd5 = ?, fwd10 = ?, fwd20 = ?
               WHERE alert_id = ? AND snapshot = ? AND deck = ? AND ticker = ?""",
            (outcome.get("fwd5"), outcome.get("fwd10"), outcome.get("fwd20"), alert_id, snapshot, deck, ticker),
        )


def _hydrate(conn, row) -> StoredAlert:
    stints = [
        StoredStint(r["theme"], r["via"], date.fromisoformat(r["joined_date"]), _date(r["left_date"]),
                    r["dd20_at_join"], r["fwd5"], r["fwd10"], r["fwd20"], r["max_dd10"], _date(r["last_ref"]))
        for r in conn.execute(
            "SELECT * FROM risk_alert_themes WHERE alert_id = ? ORDER BY joined_date, theme", (row["id"],))
    ]
    cards: dict[tuple[str, str], list[StoredCard]] = {}
    for r in conn.execute("SELECT * FROM risk_alert_cards WHERE alert_id = ? ORDER BY rank", (row["id"],)):
        cards.setdefault((r["snapshot"], r["deck"]), []).append(StoredCard(
            r["snapshot"], r["deck"], r["rank"], r["ticker"], date.fromisoformat(r["as_of"]),
            r["drawdown_pct"], _date(r["high_date"]), r["pct_from_high63"], r["corr"], r["corr_with"],
            r["fwd5"], r["fwd10"], r["fwd20"],
            json.loads(r["payload_json"]) if r["payload_json"] else None))
    return StoredAlert(
        id=row["id"], origin=row["origin"], rules_version=row["rules_version"], status=row["status"],
        start_date=date.fromisoformat(row["start_date"]), release_date=_date(row["release_date"]),
        release_reason=row["release_reason"], primary_theme=row["primary_theme"],
        w1_proxy=bool(row["w1_proxy"]), trigger=tuple(json.loads(row["trigger_json"])),
        created_at=row["created_at"], stints=stints, cards=cards)


def open_alert(version: str) -> StoredAlert | None:
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM risk_alerts WHERE rules_version = ? AND status = 'open' "
            "ORDER BY start_date DESC, id DESC LIMIT 1", (version,)).fetchone()
        return _hydrate(conn, row) if row else None


def list_alerts(version: str | None, origin: str, limit: int) -> list[StoredAlert]:
    sql, params = "SELECT * FROM risk_alerts WHERE origin = ?", [origin]
    if version is not None:
        sql += " AND rules_version = ?"
        params.append(version)
    sql += " ORDER BY start_date DESC, id DESC LIMIT ?"
    params.append(limit)
    with _db() as conn:
        return [_hydrate(conn, row) for row in conn.execute(sql, params).fetchall()]


def get_alert(alert_id: int) -> StoredAlert | None:
    with _db() as conn:
        row = conn.execute("SELECT * FROM risk_alerts WHERE id = ?", (alert_id,)).fetchone()
        return _hydrate(conn, row) if row else None


def latest_day(version: str) -> StoredDay | None:
    with _db() as conn:
        row = conn.execute(
            "SELECT * FROM risk_daily WHERE rules_version = ? ORDER BY date DESC LIMIT 1", (version,)).fetchone()
    if row is None:
        return None
    blob = json.loads(row["warnings_json"])
    return StoredDay(
        date=date.fromisoformat(row["date"]), rules_version=row["rules_version"], origin=row["origin"],
        warnings=blob["warnings"], on_count=blob["on_count"], w1_proxy=blob["w1_proxy"],
        confirming=json.loads(row["confirming_json"]), sox_confirming=bool(row["sox_confirming"]),
        cap_share=row["cap_share"], bars_coverage=row["bars_coverage"], evaluated_at=row["evaluated_at"])


def get_state(key: str) -> str | None:
    with _db() as conn:
        row = conn.execute("SELECT value FROM risk_state WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_state(key: str, value: str) -> None:
    with _db() as conn:
        conn.execute("INSERT OR REPLACE INTO risk_state (key, value) VALUES (?, ?)", (key, value))


def versions() -> set[str]:
    """Every rules version with an alert or a risk_daily row."""
    with _db() as conn:
        rows = conn.execute(
            "SELECT rules_version FROM risk_alerts UNION SELECT rules_version FROM risk_daily").fetchall()
    return {r[0] for r in rows}


def purge_version(version: str, *, include_live: bool = False) -> None:
    """Delete a version's backfill alerts (themes and cards cascade) and its risk_daily rows."""
    with _db() as conn:
        if include_live:
            conn.execute("DELETE FROM risk_alerts WHERE rules_version = ?", (version,))
        else:
            conn.execute("DELETE FROM risk_alerts WHERE rules_version = ? AND origin = 'backfill'", (version,))
        conn.execute("DELETE FROM risk_daily WHERE rules_version = ?", (version,))
