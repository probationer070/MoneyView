"""Read-only views for the stock detail screen: watchlist profile and latest movers."""

from __future__ import annotations

import statistics
from datetime import date, timedelta

from apps.api.models.schema_parts.detail import (
    DetailProfile, LatestMovers, MoveAlert, MoveEvent, MoveExplanation, MoveMarket, MoveNews,
    MovePeer, MoverRow, MoveTheme, ThemeLabel, ThemeRef,
)
from apps.api.services.db import get_db
from apps.api.services.events import default_registry
from apps.api.services.news_feed.history import history_window
from apps.api.services.risk import store
from apps.api.services.risk.evaluator import BACKFILL_COMPLETE
from apps.api.services.risk.inputs import load_inputs
from apps.api.services.risk.rules import get_rules
from apps.api.services.watchlist_themes import load_themes
from packages.core_finance.risk_signals.indices import theme_indices

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


# Big-move rule (spec 5.2): sd of the 60 daily returns before the day, mean of the 20 volumes before it.
SD_RETURNS = 60
VOLUME_BARS = 20
LEVEL_LOAD_PAD_DAYS = 10  # calendar days loaded before the day, so the previous level exists
ALERT_LIMIT = 100000
MARKET_TICKER = "^GSPC"


class NoBars(LookupError):
    """The ticker has no bars at all."""


class NoBarOnDay(ValueError):
    """The ticker has bars, but none on the asked day (or no earlier bar to compare with)."""


def _bars(conn, ticker: str, day: date, limit: int) -> list:
    """Newest first, up to `day`, from stocks, else from indices."""
    for table in ("stocks", "indices"):
        rows = conn.execute(
            f"SELECT date, close, volume FROM {table} WHERE ticker = ? AND date <= ? "
            "AND close IS NOT NULL ORDER BY date DESC LIMIT ?",
            (ticker, day.isoformat(), limit),
        ).fetchall()
        if rows:
            return rows
    return []


def _return_pct(bars: list, day: date) -> float | None:
    """Day close over the previous bar close, in percent. None unless the newest bar is `day`."""
    if len(bars) < 2 or bars[0]["date"] != day.isoformat() or not bars[1]["close"]:
        return None
    return (bars[0]["close"] / bars[1]["close"] - 1) * 100


def _ratios(bars: list) -> tuple[float | None, float | None]:
    price = volume = None
    if len(bars) >= SD_RETURNS + 2:
        closes = [b["close"] for b in reversed(bars)]  # oldest first, the last is the day
        rets = [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes) - 1)][-SD_RETURNS:]
        sd = statistics.stdev(rets)
        if sd > 0:
            price = abs(closes[-1] / closes[-2] - 1) / sd
    prev_vols = [b["volume"] for b in bars[1:VOLUME_BARS + 1]]
    if len(prev_vols) == VOLUME_BARS and None not in prev_vols and bars[0]["volume"] is not None:
        mean = sum(prev_vols) / VOLUME_BARS
        if mean > 0:
            volume = bars[0]["volume"] / mean
    return price, volume


def _theme_return(theme_id: str, day: date) -> float | None:
    inputs = load_inputs(since=day - timedelta(days=LEVEL_LOAD_PAD_DAYS), through=day, fetch_fred=False)
    levels = theme_indices(inputs.closes, inputs.shares, inputs.themes, get_rules().rules.min_members)
    if theme_id not in levels:
        return None
    level = levels[theme_id].dropna()
    if len(level) < 2 or level.index[-1].date() != day:
        return None
    return (level.iloc[-1] / level.iloc[-2] - 1) * 100


def _role(day: date, start: date, end: date | None) -> str:
    if day == start:
        return "start"
    return "end" if end == day else "ongoing"


def _alerts(ticker: str, theme_id: str, day: date) -> list[MoveAlert]:
    version = get_rules().version
    origins = ["live"]
    if (store.get_state(f"backfill:{version}") or "pending") in BACKFILL_COMPLETE:
        origins.append("backfill")
    found: list[MoveAlert] = []
    for origin in origins:
        for a in store.list_alerts(version, origin, ALERT_LIMIT):
            if a.start_date > day or (a.release_date is not None and a.release_date < day):
                continue
            in_stint = bool(theme_id) and any(
                s.theme == theme_id and s.joined_date <= day and (s.left_date is None or day <= s.left_date)
                for s in a.stints)
            in_cards = any(c.ticker == ticker for cards in a.cards.values() for c in cards)
            if in_stint or in_cards:
                found.append(MoveAlert(id=a.id, kind="risk", role=_role(day, a.start_date, a.release_date)))
    if theme_id:
        for e in store.list_surge(version, None, theme_id, ALERT_LIMIT, origins=origins):
            if e.start_date <= day and (e.end_date is None or day <= e.end_date):
                found.append(MoveAlert(id=e.id, kind="surge", role=_role(day, e.start_date, e.end_date)))
    return found


def explain_move(ticker: str, day: date) -> MoveExplanation:
    """Everything the explanation card shows for `ticker` on `day`.

    Raises NoBars when the ticker has no bars at all, NoBarOnDay when it has none on `day`.
    A ticker outside the watchlist gets theme null, peers [], news null (never an error).
    `market` is ^GSPC's day change, null when missing or when the ticker is ^GSPC itself.
    return_pct, price_ratio and volume_ratio are rounded to 2 dp.
    """
    ticker = ticker.upper()
    with get_db() as conn:
        bars = _bars(conn, ticker, day, SD_RETURNS + 2)
        if not bars:
            if not _bars(conn, ticker, date.max, 1):
                raise NoBars(ticker)
            raise NoBarOnDay(ticker)
        ret = _return_pct(bars, day)
        if ret is None:
            raise NoBarOnDay(ticker)
        market = None
        if ticker != MARKET_TICKER:
            m = _return_pct(_bars(conn, MARKET_TICKER, day, 2), day)
            market = None if m is None else MoveMarket(ticker=MARKET_TICKER, return_pct=round(m, 2))
        watch = conn.execute("SELECT theme FROM watchlist WHERE ticker = ?", (ticker,)).fetchone()
        theme_id = (watch["theme"] or "") if watch else ""
        peers: list[MovePeer] = []
        if theme_id:
            for r in conn.execute(
                "SELECT ticker, name FROM watchlist WHERE theme = ? AND ticker != ?", (theme_id, ticker)
            ).fetchall():
                p = _return_pct(_bars(conn, r["ticker"], day, 2), day)
                if p is not None:
                    peers.append(MovePeer(ticker=r["ticker"], name=r["name"] or r["ticker"],
                                          return_pct=round(p, 2)))
        news = None
        if watch:
            start, end = history_window(day)
            stored = conn.execute(
                "SELECT COUNT(*) FROM news WHERE ticker = ? AND topic = '' "
                "AND substr(published_date, 1, 10) >= ? AND substr(published_date, 1, 10) <= ?",
                (ticker, start.isoformat(), end.isoformat())).fetchone()[0]
            searched = conn.execute(
                'SELECT 1 FROM news_history_searches WHERE ticker = ? AND lang = ? AND start = ? AND "end" = ?',
                (ticker, "en", start.isoformat(), end.isoformat())).fetchone() is not None
            news = MoveNews(stored=stored, searched=searched)
    peers.sort(key=lambda p: p.return_pct)

    theme = None
    if theme_id:
        ref = next((t for t in load_themes() if t.id == theme_id), None)
        tr = _theme_return(theme_id, day)
        if ref is not None and tr is not None:
            theme = MoveTheme(id=ref.id, label=ThemeLabel(en=ref.en, ko=ref.ko), return_pct=round(tr, 2))
    price_ratio, volume_ratio = _ratios(bars)
    return MoveExplanation(
        ticker=ticker,
        date=day.isoformat(),
        return_pct=round(ret, 2),
        price_ratio=None if price_ratio is None else round(price_ratio, 2),
        volume_ratio=None if volume_ratio is None else round(volume_ratio, 2),
        market=market,
        theme=theme,
        peers=peers,
        events=[MoveEvent(category=e.category, title=e.label) for e in default_registry().events(day, day)],
        alerts=_alerts(ticker, theme_id, day),
        news=news,
    )
