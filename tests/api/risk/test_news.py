"""Topic, theme and Korean news. Each docstring names the mutation its test catches."""
from __future__ import annotations

import sys
from datetime import UTC, date, datetime
from types import SimpleNamespace

import pandas as pd
import pytest

from apps.api.models.schemas import NewsArticle
from apps.api.services.db import get_db
from apps.api.services.news_service import NewsService, news_identity_hash
from apps.api.services.risk import news, store
from apps.api.services.risk.rules import get_rules
from apps.api.services.risk.store import StoredAlert, StoredCard, StoredStint
from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=UTC)
RULES = get_rules().rules
TOPIC_IDS = ["cpi", "pce", "fomc", "jobs", "treasury", "credit", "oil"]


def _item(title, url, day="2026-10-10"):
    return SimpleNamespace(title=title, url=url, source="Google News", date=day)


class FakeCrawler:
    """Records every call; returns one article per feed unless `fail` matches the query."""

    def __init__(self, fail=lambda kw: False):
        self.calls: list[dict] = []
        self.fail = fail

    def crawl(self, **kw):
        self.calls.append(kw)
        if self.fail(kw):
            raise RuntimeError("feed down")
        key = kw["query"] or kw["ticker"]
        return [_item(f"{key} headline {kw['lang']}", f"https://x/{key}/{kw['lang']}")]


def _rows(where="1=1"):
    with get_db() as conn:
        return [dict(r) for r in conn.execute(f"SELECT * FROM news WHERE {where} ORDER BY id")]


def _save(headline, url, day, *, ticker="", topic="", lang="en"):
    NewsService().save_article(NewsArticle(ticker=ticker, headline=headline, url=url, published_date=day,
                                           lang=lang, topic=topic))


def _alert(start=date(2026, 10, 8), release=None, themes=("ai_semis",), crash=()):
    stints = [StoredStint(t, "trigger", start, None, None, None, None, None, None) for t in themes]
    cards = {("latest", "crash"): [
        StoredCard("latest", "crash", i, t, start, -15.0, start, None, None, None, None, None, None, None)
        for i, t in enumerate(crash, start=1)]}
    return StoredAlert(1, "live", "v", "open", start, release, None, themes[0], False, (), "t",
                       stints=stints, cards=cards)


def _no_sleep(_s):
    pass


def test_topic_rows_saved_with_topic_and_lang():
    """Catches rows saved with the feed's ticker/topic dropped, or with lang left at the 'en' default."""
    news.sweep_news(NOW, crawler=FakeCrawler(), sleep=_no_sleep)
    cpi_ko = _rows("topic = 'macro:cpi' AND lang = 'ko'")
    assert cpi_ko and all(r["ticker"] == "" for r in cpi_ko)
    assert {r["topic"] for r in _rows("lang = 'en'")} >= {f"macro:{t}" for t in TOPIC_IDS}
    assert _rows("topic = 'theme:memory_storage' AND lang = 'ko'")
    assert store.get_state("news_swept_at") == NOW.isoformat()
    assert store.get_state("news_last_sweep_failed") == "0"


def test_general_feed_excludes_topic_rows():
    """Catches get_news() without `topic = ''` on the no-ticker and keyword paths."""
    _save("NVDA beats", "https://x/nvda", "2026-10-10", ticker="NVDA")
    _save("CPI hot", "https://x/cpi", "2026-10-11", topic="macro:cpi")
    assert [a.headline for a in NewsService().get_news()] == ["NVDA beats"]
    assert [a.headline for a in NewsService().get_news(keyword="CPI")] == []


def test_ko_only_for_ko_names():
    """Catches a Korean feed for every ticker (English name sent to the Korean feed)."""
    crawler = FakeCrawler()
    news.sweep_news(NOW, crawler=crawler, sleep=_no_sleep, tickers=["nvda", "ZZZZ"])
    ticker_calls = [(c["ticker"], c["lang"], c["query"]) for c in crawler.calls if c["ticker"]]
    assert ticker_calls == [("NVDA", "en", None), ("NVDA", "ko", "엔비디아 주가"), ("ZZZZ", "en", None)]
    assert {r["ticker"] for r in _rows("lang = 'ko' AND ticker != ''")} == {"NVDA"}


def test_feed_failure_is_skipped_and_flagged_only_when_all_fail():
    """Catches a raise out of the sweep, a skipped feed ending the sweep, and a flag set on partial failure."""
    partial = FakeCrawler(fail=lambda kw: kw["lang"] == "ko")
    report = news.sweep_news(NOW, crawler=partial, sleep=_no_sleep)
    assert 0 < len(report.failed) < report.attempted and report.fetched == report.attempted - len(report.failed)
    assert store.get_state("news_last_sweep_failed") == "0"
    news.sweep_news(NOW, crawler=FakeCrawler(fail=lambda kw: True), sleep=_no_sleep)
    assert store.get_state("news_last_sweep_failed") == "1"


def test_network_guard_assertion_propagates():
    """Catches `except Exception` swallowing AssertionError, which hides a test reaching the network."""
    def boom(kw):
        raise AssertionError("network")

    with pytest.raises(AssertionError):
        news.sweep_news(NOW, crawler=FakeCrawler(fail=boom), sleep=_no_sleep)


def test_sweep_sleeps_between_feeds_only():
    """Catches no pacing, or a sleep before the first feed."""
    sleeps: list[float] = []
    report = news.sweep_news(NOW, crawler=FakeCrawler(), sleep=sleeps.append)
    assert len(sleeps) == report.attempted - 1
    assert set(sleeps) == {news.NEWS_CRAWL_DELAY_SECONDS}


def test_ticker_hash_unchanged_and_topic_rows_distinct():
    """Catches a changed ticker hash (duplicating old rows) and topic rows that share one hash."""
    import hashlib

    assert news_identity_hash("nvda", "u") == hashlib.md5(b"NVDA::u").hexdigest()
    assert news_identity_hash("", "u", "macro:cpi") != news_identity_hash("", "u", "macro:pce")


def test_select_order_macro_first_and_dedupe():
    """Catches wrong group order, a non-newest-first order, and no URL / normalised-title dedupe."""
    _save("Crash stock news", "https://x/c1", "2026-10-12", ticker="NVDA")
    _save("Theme news", "https://x/t1", "2026-10-12", topic="theme:ai_semis")
    _save("Fed older", "https://x/f1", "2026-10-09", topic="macro:fomc")
    _save("CPI old", "https://x/p1", "2026-10-09", topic="macro:cpi")
    _save("CPI new", "https://x/p2", "2026-10-11", topic="macro:cpi")
    _save("Same url again", "https://x/p2", "2026-10-11", topic="macro:pce")  # duplicate URL
    _save("  FED   older - Reuters ", "https://x/f2", "2026-10-09", topic="macro:jobs")  # duplicate title
    got = news.select_alert_news(_alert(crash=["NVDA"]), date(2026, 10, 19), RULES)
    assert [i.title for i in got.items] == ["CPI new", "CPI old", "Fed older", "Theme news", "Crash stock news"]
    assert [i.kind for i in got.items] == ["macro"] * 3 + ["industry"] * 2
    assert (got.items[0].topic, got.items[3].theme, got.items[4].ticker) == ("cpi", "ai_semis", "NVDA")


def test_select_window_and_cap():
    """Catches a wrong window (start - days_before .. release) and a missing max_items cap."""
    for i in range(35):
        _save(f"CPI {i}", f"https://x/{i}", "2026-10-10", topic="macro:cpi")
    _save("too early", "https://x/e", "2026-09-30", topic="macro:cpi")
    _save("after release", "https://x/l", "2026-10-15", topic="macro:cpi")
    _save("edge start", "https://x/s", "2026-10-01", topic="macro:oil")  # start 10-08 minus 7 = 10-01
    got = news.select_alert_news(_alert(release=date(2026, 10, 12)), date(2026, 10, 19), RULES)
    assert len(got.items) == RULES.news.max_items == 30
    assert got.shortfall == 0
    titles = {i.title for i in got.items}
    assert "after release" not in titles
    only = news.select_alert_news(_alert(release=date(2026, 10, 12), themes=("ai_semis",)), date(2026, 10, 19),
                                  RULES.model_copy(update={"news": RULES.news.model_copy(update={"max_items": 100})}))
    only_titles = {i.title for i in only.items}
    assert "edge start" in only_titles
    assert not {"too early", "after release"} & only_titles


def test_shortfall_when_under_ten():
    """Catches shortfall computed as the count, not min_items minus the count, or negative at 10+."""
    for i in range(4):
        _save(f"CPI {i}", f"https://x/{i}", "2026-10-10", topic="macro:cpi")
    assert news.select_alert_news(_alert(), date(2026, 10, 19), RULES).shortfall == 6
    for i in range(4, 12):
        _save(f"CPI {i}", f"https://x/{i}", "2026-10-10", topic="macro:cpi")
    assert news.select_alert_news(_alert(), date(2026, 10, 19), RULES).shortfall == 0


def test_before_collection_note():
    """Catches no note for an alert that ended before the first topic row, and a note for a current one."""
    _save("CPI", "https://x/1", "2026-10-10", topic="macro:cpi")
    old = _alert(start=date(2024, 3, 1), release=date(2024, 3, 20))
    assert news.select_alert_news(old, date(2026, 10, 19), RULES).note == "before_collection"
    assert news.select_alert_news(_alert(), date(2026, 10, 19), RULES).note is None


def test_feed_failed_note():
    """Catches a feed_failed note ignoring the stored flag."""
    _save("CPI", "https://x/1", "2026-10-10", topic="macro:cpi")
    assert news.select_alert_news(_alert(), date(2026, 10, 19), RULES).note is None
    store.set_state("news_last_sweep_failed", "1")
    assert news.select_alert_news(_alert(), date(2026, 10, 19), RULES).note == "feed_failed"


def _levels(*pairs):
    return pd.Series([v for _, v in pairs], index=pd.DatetimeIndex([d for d, _ in pairs]), dtype=float)


def test_macro_figure_respects_release_day():
    """Catches a monthly figure shown before its release day, and daily figures shown the same day."""
    day = RULES.w5.cpi_known_day
    cpi = _levels(("2026-04-01", 100), ("2026-05-01", 101), ("2026-06-01", 102.01), ("2026-07-01", 103.0301))
    dgs = _levels(("2026-09-28", 4.0), ("2026-09-29", 4.1), ("2026-09-30", 4.3))
    fred = {"CPIAUCSL": cpi, "DGS10": dgs}
    before = news.macro_figures(_alert(), fred, date(2026, 8, day - 1))  # Jul CPI is out on Aug `day`
    cpi_before = next(f for f in before if f.series == "CPIAUCSL")
    assert cpi_before.latest["period"] == "2026-06" and cpi_before.prior["period"] == "2026-05"
    after = news.macro_figures(_alert(), fred, date(2026, 8, day))
    cpi_after = next(f for f in after if f.series == "CPIAUCSL")
    assert (cpi_after.kind, cpi_after.latest["period"], cpi_after.prior["period"]) == ("mm_pct", "2026-07", "2026-06")
    assert cpi_after.latest["value"] == pytest.approx(1.0) and cpi_after.topic == "cpi"
    assert cpi_after.label == {"ko": "CPI", "en": "CPI"}
    dgs_fig = next(f for f in news.macro_figures(_alert(), fred, date(2026, 10, 1)) if f.series == "DGS10")
    assert (dgs_fig.kind, dgs_fig.latest, dgs_fig.prior) == (
        "level", {"period": "2026-09-30", "value": 4.3}, {"period": "2026-09-29", "value": 4.1})
    same_day = news.macro_figures(_alert(), fred, date(2026, 9, 30))  # 09-30 value known from 10-01
    assert next(f for f in same_day if f.series == "DGS10").latest["period"] == "2026-09-29"
    assert not [f for f in news.macro_figures(_alert(), {}, date(2026, 10, 1))]


def test_crawler_ko_url(monkeypatch):
    """Catches a Korean crawl that still requests the US edition, or ignores the raw query."""
    seen: list[str] = []

    def parse(url):
        seen.append(url)
        return SimpleNamespace(bozo=False, entries=[])

    monkeypatch.setitem(sys.modules, "feedparser", SimpleNamespace(parse=parse))
    StockNewsCrawler().crawl("NVDA", lang="ko", query="엔비디아 주가")
    StockNewsCrawler().crawl("NVDA")
    assert "hl=ko&gl=KR&ceid=KR:ko" in seen[0] and "q=%EC%97%94" in seen[0]
    assert seen[1].endswith("q=NVDA%20stock%20news&hl=en-US&gl=US&ceid=US:en")


def test_queries_file_validates_strictly(tmp_path):
    """Catches a loader that accepts an unknown theme id or an unknown FRED series."""
    text = news.QUERIES_PATH.read_text(encoding="utf-8")
    assert len(news.load_news_queries().themes) == 24
    bad_theme = tmp_path / "t.yaml"
    bad_theme.write_text(text.replace("  quantum:", "  not_a_theme:"), encoding="utf-8")
    with pytest.raises(ValueError):
        news.load_news_queries(bad_theme)
    bad_series = tmp_path / "s.yaml"
    # Renaming the label too leaves only the FRED-series check to reject it.
    bad_series.write_text(text.replace("DGS10", "NOPE"), encoding="utf-8")
    with pytest.raises(ValueError):
        news.load_news_queries(bad_series)
