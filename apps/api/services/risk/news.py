"""Topic, theme and Korean news for risk alerts (spec 2026-10-19 section 5).

`sweep_news` fetches Google News RSS feeds and stores them in `news`; `select_alert_news`
picks the stored rows that belong to an alert; `macro_figures` gives the latest two values
of each macro topic's series as they were known on a given day.

Like the other risk sweeps, a feed failure is logged and skipped, and an AssertionError
(the tests' network guard) is let through.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path
from typing import Literal, Mapping, Sequence

import pandas as pd
import yaml
from pydantic import BaseModel, ConfigDict, ValidationError, model_validator

from apps.api.core.logger import setup_logger
from apps.api.models.schemas import NewsArticle, SentimentEnum
from apps.api.routes.news import NEWS_CRAWL_DELAY_SECONDS
from apps.api.services.db import get_db
from apps.api.services.news_service import NewsService
from apps.api.services.risk import store
from apps.api.services.risk.constants import RISK_FRED_SERIES
from apps.api.services.risk.rules import LoadedRules, get_rules
from apps.api.services.risk.store import StoredAlert
from apps.api.services.risk.sweep import SweepReport
from apps.api.services.watchlist_themes import theme_ids
from packages.core_finance.risk_signals.config import RiskRules
from packages.core_finance.risk_signals.warnings import cpi_release, daily_release, pce_release

logger = setup_logger(__name__)

QUERIES_PATH = Path(__file__).with_name("news_queries.yaml")
FEED_LIMIT = 10


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _Lang(_Strict):
    en: str
    ko: str


class _Queries(_Strict):
    en: list[str]
    ko: list[str]


class Topic(_Strict):
    id: str
    ko: str
    en: str
    queries: _Queries
    series: list[str]


class NewsQueries(_Strict):
    topics: list[Topic]
    series_labels: dict[str, _Lang]
    themes: dict[str, _Lang]
    ko_names: dict[str, str]

    @model_validator(mode="after")
    def _consistent(self):
        ids = [t.id for t in self.topics]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate topic ids")
        if set(self.themes) != set(theme_ids()):
            raise ValueError(f"themes must be exactly the watchlist theme ids: {set(self.themes) ^ set(theme_ids())}")
        for topic in self.topics:
            if not topic.queries.en or not topic.queries.ko:
                raise ValueError(f"topic {topic.id}: needs queries in both languages")
            for series in topic.series:
                if series not in RISK_FRED_SERIES:
                    raise ValueError(f"topic {topic.id}: unknown FRED series {series!r}")
                if series not in self.series_labels:
                    raise ValueError(f"topic {topic.id}: no series_labels entry for {series!r}")
        if any(not name for name in self.ko_names.values()):
            raise ValueError("ko_names: empty Korean name")
        return self


def load_news_queries(path: Path | None = None) -> NewsQueries:
    try:
        return NewsQueries.model_validate(yaml.safe_load((path or QUERIES_PATH).read_text(encoding="utf-8")))
    except (ValidationError, yaml.YAMLError) as exc:
        raise ValueError(f"invalid news queries: {exc}") from exc


@lru_cache(maxsize=1)
def _queries() -> NewsQueries:
    return load_news_queries()


# ---------------------------------------------------------------- sweep


def _feed_jobs(tickers: Sequence[str]):
    """(label, lang, query, ticker, topic) for every feed, in sweep order."""
    q = _queries()
    for topic in q.topics:
        for lang in ("en", "ko"):
            for query in getattr(topic.queries, lang):
                yield f"macro:{topic.id}:{lang}", lang, query, "", f"macro:{topic.id}"
    for theme, text in q.themes.items():
        for lang in ("en", "ko"):
            yield f"theme:{theme}:{lang}", lang, getattr(text, lang), "", f"theme:{theme}"
    for raw in tickers:
        ticker = raw.upper()
        yield f"{ticker}:en", "en", None, ticker, ""
        if ticker in q.ko_names:
            yield f"{ticker}:ko", "ko", f"{q.ko_names[ticker]} 주가", ticker, ""


def sweep_news(
    now: datetime,
    *,
    crawler=None,
    sleep=time.sleep,
    tickers: Sequence[str] = (),
) -> SweepReport:
    """Fetch and store every topic, theme and given-ticker feed. `attempted` counts feeds,
    `fetched` the feeds that returned articles, `failed` the labels of feeds that raised."""
    if crawler is None:
        from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

        crawler = StockNewsCrawler()
    service = NewsService()
    attempted = fetched = 0
    failed: list[str] = []
    for label, lang, query, ticker, topic in _feed_jobs(tickers):
        if attempted:
            sleep(NEWS_CRAWL_DELAY_SECONDS)
        attempted += 1
        try:
            items = crawler.crawl(ticker=ticker, company_name="", limit=FEED_LIMIT, offset=0, lang=lang, query=query)
        except AssertionError:
            raise
        except Exception as error:  # noqa: BLE001 - one feed must not stop the sweep
            logger.warning("risk.sweep_news_failed feed=%s error=%s", label, error)
            failed.append(label)
            continue
        if items:
            fetched += 1
        for item in items:
            service.save_article(NewsArticle(
                ticker=ticker,
                headline=item.title,
                url=item.url or "",
                source=item.source or "",
                published_date=item.date or "",
                sentiment=SentimentEnum.neutral,
                importance=1,
                lang=lang,
                topic=topic,
            ))
    store.set_state("news_swept_at", now.isoformat())
    store.set_state("news_last_sweep_failed", "1" if attempted and len(failed) == attempted else "0")
    return SweepReport(attempted, fetched, failed)


# ---------------------------------------------------------------- selection


@dataclass(frozen=True)
class NewsItem:
    title: str
    url: str
    source: str
    published_date: str
    lang: str
    kind: Literal["macro", "industry"]
    topic: str | None
    theme: str | None
    ticker: str | None


@dataclass(frozen=True)
class AlertNews:
    items: list[NewsItem]
    shortfall: int
    note: str | None


_SOURCE_SUFFIX = re.compile(r"\s+-\s+[^-]*$")


def _normalise_title(title: str) -> str:
    text = " ".join(title.lower().split())
    return _SOURCE_SUFFIX.sub("", text)


def select_alert_news(alert: StoredAlert, today: date, rules: RiskRules) -> AlertNews:
    news = rules.news
    start = alert.start_date.fromordinal(alert.start_date.toordinal() - news.days_before).isoformat()
    end = (alert.release_date or today).isoformat()
    window = "substr(published_date, 1, 10) BETWEEN ? AND ?"
    order = "ORDER BY published_date DESC, id DESC"

    def rows_for(conn, where: str, value: str):
        return conn.execute(f"SELECT * FROM news WHERE {where} AND {window} {order}", (value, start, end)).fetchall()

    candidates: list[NewsItem] = []

    def add(rows, kind, topic=None, theme=None, ticker=None):
        for r in rows:
            candidates.append(NewsItem(r["headline"], r["url"] or "", r["source"] or "", r["published_date"] or "",
                                       r["lang"], kind, topic, theme, ticker))

    with get_db() as conn:
        for topic in _queries().topics:
            add(rows_for(conn, "topic = ?", f"macro:{topic.id}"), "macro", topic=topic.id)
        for theme in dict.fromkeys(s.theme for s in alert.stints):
            add(rows_for(conn, "topic = ?", f"theme:{theme}"), "industry", theme=theme)
        for card in alert.cards.get(("latest", "crash"), []):
            add(rows_for(conn, "topic = '' AND ticker = ?", card.ticker), "industry", ticker=card.ticker)
        earliest = conn.execute(
            "SELECT MIN(substr(published_date, 1, 10)) FROM news WHERE topic != '' AND published_date != ''"
        ).fetchone()[0]

    unique: list[NewsItem] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    for item in candidates:
        title_key = _normalise_title(item.title)
        if (item.url and item.url in seen_urls) or title_key in seen_titles:
            continue
        if item.url:
            seen_urls.add(item.url)
        seen_titles.add(title_key)
        unique.append(item)

    # Both kinds appear: macro takes at most half the slots, industry the rest; a side that
    # runs short hands its unused slots to the other. Macro is listed first.
    macro = [i for i in unique if i.kind == "macro"]
    industry = [i for i in unique if i.kind == "industry"]
    macro_take = min(len(macro), max(news.max_items // 2, news.max_items - len(industry)))
    items = macro[:macro_take] + industry[: news.max_items - macro_take]

    note = None
    if earliest is not None and end < earliest:
        note = "before_collection"
    elif store.get_state("news_last_sweep_failed") == "1":
        note = "feed_failed"
    return AlertNews(items, max(0, news.min_items - len(items)), note)


# ---------------------------------------------------------------- macro figures


@dataclass(frozen=True)
class MacroFigure:
    topic: str
    series: str
    label: dict[str, str]
    kind: Literal["mm_pct", "level"]
    latest: dict
    prior: dict


# Monthly series: m/m percent, known per the release rule of their topic. Payrolls have no
# rule in rules.yaml; the CPI rule is the later of the two plausible dates, so it never shows
# a figure before it was out.
_MONTHLY_TOPICS = {"cpi", "pce", "jobs"}


def macro_figures(
    fred: Mapping[str, pd.Series],
    as_of: date,
    *,
    loaded: LoadedRules | None = None,
) -> list[MacroFigure]:
    """A series with fewer than two known values is left out."""
    cpi_day = (loaded or get_rules()).rules.w5.cpi_known_day
    cutoff = pd.Timestamp(as_of)
    figures: list[MacroFigure] = []
    for topic in _queries().topics:
        for series in topic.series:
            raw = fred.get(series)
            values = raw.dropna().sort_index() if raw is not None else pd.Series(dtype=float)
            if values.empty:
                continue
            values.index = pd.DatetimeIndex(values.index)
            if topic.id in _MONTHLY_TOPICS:
                kind = "mm_pct"
                values = (values.pct_change().dropna()) * 100
                if values.empty:
                    continue
                release = pd.DatetimeIndex(
                    [pce_release(d) if topic.id == "pce" else cpi_release(d, cpi_day) for d in values.index]
                )
                period = lambda d: d.strftime("%Y-%m")  # noqa: E731
            else:
                kind = "level"
                release = daily_release(values.index)
                period = lambda d: d.strftime("%Y-%m-%d")  # noqa: E731
            known = values[release <= cutoff]
            if len(known) < 2:
                continue
            (p_idx, p_val), (l_idx, l_val) = list(known.items())[-2:]
            figures.append(MacroFigure(
                topic.id, series, dict(ko=_queries().series_labels[series].ko, en=_queries().series_labels[series].en),
                kind, {"period": period(l_idx), "value": float(l_val)}, {"period": period(p_idx), "value": float(p_val)},
            ))
    return figures
