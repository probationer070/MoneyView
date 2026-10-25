"""Read-only views for the stock detail screen: watchlist profile and latest movers."""

from __future__ import annotations

from apps.api.models.schema_parts.detail import (
    DetailProfile, LatestMovers, MoverRow, ThemeLabel, ThemeRef,
)
from apps.api.services.db import get_db
from apps.api.services.watchlist_themes import load_themes

# A date counts as "latest" once this share of the watchlist tickers that have bars
# have a bar on it. A few tickers already on the next day must not decide it.
COMMON_DAY_SHARE = 0.9


def profile(ticker: str) -> DetailProfile:
    """Watchlist name/sector/theme for a ticker; unknown tickers give in_watchlist=False and nulls."""
    ticker = ticker.upper()
    with get_db() as conn:
        row = conn.execute(
            "SELECT name, sector, theme FROM watchlist WHERE ticker = ?", (ticker,)
        ).fetchone()
    if row is None:
        return DetailProfile(ticker=ticker, in_watchlist=False)
    theme = None
    theme_id = row["theme"] or ""
    if theme_id:
        for item in load_themes():
            if item.id == theme_id:
                theme = ThemeRef(id=item.id, label=ThemeLabel(en=item.en, ko=item.ko))
                break
    return DetailProfile(
        ticker=ticker,
        in_watchlist=True,
        name=row["name"] or None,
        sector=row["sector"] or None,
        theme=theme,
    )


def latest_movers(limit: int = 5) -> LatestMovers:
    """Top `limit` risers and fallers on the latest common day.

    Latest common day: the newest date on which at least COMMON_DAY_SHARE of the
    watchlist tickers that have any bar have a bar. return_pct is that day's close over
    the ticker's previous bar close, minus 1, in percent, 2 dp. Tickers lacking either
    bar are skipped.
    """
    with get_db() as conn:
        counts = conn.execute(
            """SELECT s.date AS date, COUNT(*) AS n FROM stocks s
               JOIN watchlist w ON w.ticker = s.ticker GROUP BY s.date ORDER BY s.date DESC"""
        ).fetchall()
        total = conn.execute(
            "SELECT COUNT(DISTINCT s.ticker) FROM stocks s JOIN watchlist w ON w.ticker = s.ticker"
        ).fetchone()[0]
        day = next((r["date"] for r in counts if r["n"] >= COMMON_DAY_SHARE * total), None)
        if day is None:
            return LatestMovers(date=None, up=[], down=[])
        rows = conn.execute(
            """SELECT w.ticker AS ticker, w.name AS name, w.theme AS theme, s.close AS close,
                      (SELECT p.close FROM stocks p WHERE p.ticker = s.ticker AND p.date < s.date
                       ORDER BY p.date DESC LIMIT 1) AS prev
               FROM stocks s JOIN watchlist w ON w.ticker = s.ticker
               WHERE s.date = ?""",
            (day,),
        ).fetchall()
    movers = [
        MoverRow(
            ticker=r["ticker"],
            name=r["name"] or r["ticker"],
            theme=r["theme"] or None,
            return_pct=round((r["close"] / r["prev"] - 1) * 100, 2),
        )
        for r in rows
        if r["close"] is not None and r["prev"]
    ]
    up = sorted(movers, key=lambda m: m.return_pct, reverse=True)[:limit]
    down = sorted(movers, key=lambda m: m.return_pct)[:limit]
    return LatestMovers(date=day, up=up, down=down)
