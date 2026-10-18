"""Apply the approved watchlist theme draft and the five name fixes. One-off, idempotent.

Reads `themes-draft.csv` (`proposed_theme` holds the Korean label, mapped to the stable id
through `load_themes()`), then for each ticker:

- sets its theme through `POST /portfolio/watchlist/{ticker}/theme`, and
- fixes its name through the full-row upsert, sending back the current sector, group and
  weight so the upsert changes nothing else.

A draft ticker that is not on the watchlist is reported as `not-on-watchlist` and never
created. A second run plans nothing. The endpoints are called in-process through
`TestClient(app)` so the startup migrations run first.

    python scripts/apply_watchlist_themes.py [--csv PATH] [--dry-run]

`--dry-run` never builds the app: it runs `init_db()` (so the theme column exists), reads
the watchlist with a SELECT, and prints the plan. The real run builds the app with
`MONEYVIEW_DISABLE_STARTUP_JOBS=1`, so the lifespan does not start the live-fetch cycles or
`watchlist_cleanup_cycle(run_at_start=True)`, then writes through the endpoints.
"""
from __future__ import annotations

import argparse
import csv
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

from apps.api.models.schema_parts.watchlist import WatchlistTheme  # noqa: E402
from apps.api.services.db import get_db, init_db  # noqa: E402
from apps.api.services.watchlist_themes import load_themes  # noqa: E402

DEFAULT_CSV = ROOT / "docs" / "superpowers" / "specs" / "2026-10-18-risk-signal-evidence" / "themes-draft.csv"

# The API RateLimiter (apps/api/core/middleware.py, rate=10/s, capacity=50) answers 429 to a burst.
# A short gap between writes keeps the run under it; one retry after a longer wait clears a 429.
WRITE_GAP_SECONDS = 0.12
RETRY_WAIT_SECONDS = 1.0

NAME_FIXES = {
    "NRG": "NRG Energy",
    "SCCO": "Southern Copper",
    "MSTR": "Strategy",
    "IAUM": "iShares Gold Trust Micro",
    "SLV": "iShares Silver Trust",
}


def _target_tickers(rows: list[dict]) -> list[str]:
    """Draft tickers in CSV order, then any name-fix ticker the draft does not mention."""
    tickers = [row["ticker"].strip().upper() for row in rows]
    tickers += [ticker for ticker in NAME_FIXES if ticker not in tickers]
    return list(dict.fromkeys(tickers))


def plan_changes(
    rows: list[dict], current: dict[str, dict], themes: list[WatchlistTheme]
) -> list[tuple[str, str, str]]:
    """Return `(ticker, action, value)` for every change still needed. Pure: no DB, no network.

    `action` is `"theme"` (value = theme id), `"name"` (value = new name) or `"missing"`
    (ticker not on the watchlist; value is empty). A value already in place produces no tuple.
    """
    ids_by_label = {theme.ko: theme.id for theme in themes}
    theme_for: dict[str, str] = {}
    for row in rows:
        label = row["proposed_theme"]
        if label not in ids_by_label:
            raise ValueError(f"unknown theme label {label!r} for {row['ticker']}; not in watchlist_themes.yaml")
        theme_for[row["ticker"].strip().upper()] = ids_by_label[label]

    changes: list[tuple[str, str, str]] = []
    for ticker in _target_tickers(rows):
        if ticker not in current:
            changes.append((ticker, "missing", ""))
            continue
        now = current[ticker]
        if ticker in theme_for and now["theme"] != theme_for[ticker]:
            changes.append((ticker, "theme", theme_for[ticker]))
        if ticker in NAME_FIXES and now["name"] != NAME_FIXES[ticker]:
            changes.append((ticker, "name", NAME_FIXES[ticker]))
    return changes


def _read_current() -> dict[str, dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT ticker, name, sector, group_name, weight, theme FROM watchlist"
        ).fetchall()
    return {row["ticker"]: {key: row[key] for key in row.keys()} for row in rows}


def _post_with_retry(client: TestClient, path: str, body: dict):
    """POST once; on HTTP 429 wait RETRY_WAIT_SECONDS and POST once more. The retry's answer stands."""
    response = client.post(path, json=body)
    if response.status_code == 429:
        time.sleep(RETRY_WAIT_SECONDS)
        response = client.post(path, json=body)
    return response


def _apply(client: TestClient, ticker: str, action: str, value: str, now: dict) -> None:
    time.sleep(WRITE_GAP_SECONDS)
    if action == "theme":
        response = _post_with_retry(client, f"/api/v1/portfolio/watchlist/{ticker}/theme", {"theme": value})
    else:
        response = _post_with_retry(
            client,
            "/api/v1/portfolio/watchlist",
            {
                "ticker": ticker,
                "name": value,
                "sector": now["sector"] or "",
                "group_name": now["group_name"] or "custom",
                "weight": float(now["weight"] or 0.0),
            },
        )
    if response.status_code != 200:
        raise RuntimeError(f"{ticker} {action} failed: HTTP {response.status_code} {response.text}")


def _report(rows: list[dict], current: dict[str, dict], themes: list[WatchlistTheme], client) -> int:
    """Print the plan and, when `client` is given, apply it. `client=None` writes nothing."""
    changes = plan_changes(rows, current, themes)
    by_ticker: dict[str, list[tuple[str, str]]] = {}
    for ticker, action, value in changes:
        by_ticker.setdefault(ticker, []).append((action, value))

    counts = {"set": 0, "unchanged": 0, "not-on-watchlist": 0}
    for ticker in _target_tickers(rows):
        planned = by_ticker.get(ticker, [])
        if any(action == "missing" for action, _ in planned):
            status = "not-on-watchlist"
        elif planned:
            status = "set"
            if client is not None:
                for action, value in planned:
                    _apply(client, ticker, action, value, current[ticker])
        else:
            status = "unchanged"
        counts[status] += 1
        detail = ", ".join(f"{action}={value}" for action, value in planned if action != "missing")
        print(f"{ticker}	{status}	{detail}".rstrip())

    print(f"set={counts['set']} unchanged={counts['unchanged']} missing={counts['not-on-watchlist']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply the approved watchlist theme draft and name fixes.")
    parser.add_argument("--csv", type=Path, default=DEFAULT_CSV, help="draft CSV (default: the evidence draft)")
    parser.add_argument("--dry-run", action="store_true", help="print the plan and change nothing")
    args = parser.parse_args(argv)

    with args.csv.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    themes = load_themes()

    if args.dry_run:
        # No app, no lifespan, no TestClient: migrations via init_db, then a read-only SELECT.
        init_db()
        return _report(rows, _read_current(), themes, client=None)

    # Must be set before the app module is imported: the lifespan reads it when it starts.
    os.environ.setdefault("MONEYVIEW_DISABLE_STARTUP_JOBS", "1")
    from apps.api.main import app

    with TestClient(app) as client:
        return _report(rows, _read_current(), themes, client)


if __name__ == "__main__":
    sys.exit(main())
