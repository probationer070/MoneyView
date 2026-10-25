"""Topic, theme and Korean news. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace

import pandas as pd
import pytest

from apps.api.models.schemas import NewsArticle
from apps.api.services.db import get_db
from apps.api.services.news_feed import NewsBlocked
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


def test_topic_rows_saved_with_topic_and_lang():
    """Catches rows saved with the feed's ticker/topic dropped, or with lang left at the 'en' default."""
    news.sweep_news(NOW, crawler=FakeCrawler())
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
    news.sweep_news(NOW, crawler=crawler, tickers=["nvda", "ZZZZ"])
    ticker_calls = [(c["ticker"], c["lang"], c["query"]) for c in crawler.calls if c["ticker"]]
    assert ticker_calls == [("NVDA", "en", None), ("NVDA", "ko", "엔비디아 주가"), ("ZZZZ", "en", None)]
    assert {r["ticker"] for r in _rows("lang = 'ko' AND ticker != ''")} == {"NVDA"}


def test_feed_failure_is_skipped_and_flagged_only_when_all_fail():
    """Catches a raise out of the sweep, a skipped feed ending the sweep, a flag set on partial failure,
    and news_swept_at stamped by a sweep where every feed failed (the next sweep would wait 12 hours)."""
    partial = FakeCrawler(fail=lambda kw: kw["lang"] == "ko")
    report = news.sweep_news(NOW, crawler=partial)
    assert 0 < len(report.failed) < report.attempted and report.fetched == report.attempted - len(report.failed)
    assert store.get_state("news_last_sweep_failed") == "0"
    assert store.get_state("news_swept_at") == NOW.isoformat()
    news.sweep_news(NOW + timedelta(hours=13), crawler=FakeCrawler(fail=lambda kw: True))
    assert store.get_state("news_last_sweep_failed") == "1"
    assert store.get_state("news_swept_at") == NOW.isoformat()


def test_network_guard_assertion_propagates():
    """Catches `except Exception` swallowing AssertionError, which hides a test reaching the network."""
    def boom(kw):
        raise AssertionError("network")

    with pytest.raises(AssertionError):
        news.sweep_news(NOW, crawler=FakeCrawler(fail=boom))


def test_sweep_uses_bulk_kind_and_stops_on_block():
    """Catches a sweep that queues as interactive (starving user refreshes of the pacer's
    priority rule), no item cap, and a sweep that keeps asking after a block, stamps
    news_swept_at, or drops the unfetched feeds from `failed`."""
    crawler = FakeCrawler()
    news.sweep_news(NOW, crawler=crawler)
    assert {c["kind"] for c in crawler.calls} == {"bulk"} and all("limit" not in c for c in crawler.calls)
    total = len(crawler.calls)
    store.delete_state("news_swept_at")

    class BlockingCrawler(FakeCrawler):
        def crawl(self, **kw):
            if len(self.calls) == 3:
                self.calls.append(kw)
                raise NewsBlocked("blocked", NOW + timedelta(hours=12))
            return super().crawl(**kw)

    blocking = BlockingCrawler()
    report = news.sweep_news(NOW, crawler=blocking)
    assert len(blocking.calls) == 4
    assert len(report.failed) == total - 3 and report.fetched == 3
    assert report.failed == [job[0] for job in news._feed_jobs(())][3:]
    assert report.attempted == total
    assert store.get_state("news_swept_at") is None


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


def test_select_window():
    """Catches a wrong window (start - days_before .. release or today)."""
    _save("too early", "https://x/e", "2026-09-30", topic="macro:cpi")
    _save("edge start", "https://x/s", "2026-10-01", topic="macro:oil")  # start 10-08 minus 7 = 10-01
    _save("in window", "https://x/w", "2026-10-12", topic="macro:cpi")
    _save("after release", "https://x/l", "2026-10-15", topic="macro:cpi")
    got = news.select_alert_news(_alert(release=date(2026, 10, 12)), date(2026, 10, 19), RULES)
    assert {i.title for i in got.items} == {"edge start", "in window"}


def _fill(n_macro, n_industry):
    for i in range(n_macro):
        _save(f"CPI {i}", f"https://x/m{i}", "2026-10-10", topic="macro:cpi")
    for i in range(n_industry):
        _save(f"Theme {i}", f"https://x/i{i}", "2026-10-10", topic="theme:ai_semis")
    got = news.select_alert_news(_alert(), date(2026, 10, 19), RULES)
    kinds = [i.kind for i in got.items]
    return kinds.count("macro"), kinds.count("industry"), kinds


@pytest.mark.parametrize("n_macro, n_industry, expect", [
    (35, 5, (25, 5)),     # industry short: its unused slots go to macro
    (35, 30, (15, 15)),   # both plentiful: macro capped at half
    (3, 40, (3, 27)),     # macro short: its unused slots go to industry
])
def test_select_mixes_macro_and_industry(n_macro, n_industry, expect):
    """Catches no half cap on macro (industry starved), no backfill to macro, no backfill to industry."""
    macro, industry, kinds = _fill(n_macro, n_industry)
    assert (macro, industry) == expect
    assert kinds == ["macro"] * macro + ["industry"] * industry


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
    before = news.macro_figures(fred, date(2026, 8, day - 1))  # Jul CPI is out on Aug `day`
    cpi_before = next(f for f in before if f.series == "CPIAUCSL")
    assert cpi_before.latest["period"] == "2026-06" and cpi_before.prior["period"] == "2026-05"
    after = news.macro_figures(fred, date(2026, 8, day))
    cpi_after = next(f for f in after if f.series == "CPIAUCSL")
    assert (cpi_after.kind, cpi_after.latest["period"], cpi_after.prior["period"]) == ("mm_pct", "2026-07", "2026-06")
    assert cpi_after.latest["value"] == pytest.approx(1.0) and cpi_after.topic == "cpi"
    assert cpi_after.label == {"ko": "CPI", "en": "CPI"}
    dgs_fig = next(f for f in news.macro_figures(fred, date(2026, 10, 1)) if f.series == "DGS10")
    assert (dgs_fig.kind, dgs_fig.latest, dgs_fig.prior) == (
        "level", {"period": "2026-09-30", "value": 4.3}, {"period": "2026-09-29", "value": 4.1})
    same_day = news.macro_figures(fred, date(2026, 9, 30))  # 09-30 value known from 10-01
    assert next(f for f in same_day if f.series == "DGS10").latest["period"] == "2026-09-29"
    assert not [f for f in news.macro_figures({}, date(2026, 10, 1))]


def test_crawler_ko_url(monkeypatch):
    """Catches a Korean crawl that still requests the US edition, or ignores the raw query."""
    seen: list[tuple] = []
    monkeypatch.setattr(
        "apps.api.services.webscrap.Crawler.StockNewsCrawler.google_news",
        lambda query, lang, kind, **_: seen.append((query, lang, kind)) or [],
    )
    StockNewsCrawler().crawl("NVDA", lang="ko", query="엔비디아 주가")
    StockNewsCrawler().crawl("NVDA")
    assert seen == [("엔비디아 주가", "ko", "interactive"), ("NVDA stock news", "en", "interactive")]
    # The edition and the encoding are the pacer's URL builder's job; assert the URL it builds.
    from apps.api.services.news_feed.rss import search_url

    assert "hl=ko&gl=KR&ceid=KR:ko" in search_url("엔비디아 주가", "ko") and "q=%EC%97%94" in search_url("엔비디아 주가", "ko")
    assert search_url("NVDA stock news", "en").endswith("&hl=en-US&gl=US&ceid=US:en")


def test_crawler_maps_feed_items_and_slices(monkeypatch):
    """Catches a crawler that drops published_at or the publisher, defaults the publisher to
    'Google News', or applies offset/limit wrongly (limit None must keep everything after offset)."""
    from apps.api.services.news_feed.rss import FeedItem

    feed = [FeedItem(f"T{i}", f"https://x/{i}", f"Pub{i}", "2026-10-25", f"2026-10-25T10:0{i}:00Z", f"g{i}")
            for i in range(5)]
    monkeypatch.setattr("apps.api.services.webscrap.Crawler.StockNewsCrawler.google_news",
                        lambda query, lang, kind, **_: feed)
    everything = StockNewsCrawler().crawl("NVDA", offset=1)
    assert [r.title for r in everything] == ["T1", "T2", "T3", "T4"]
    assert (everything[0].source, everything[0].date, everything[0].published_at, everything[0].matched_keywords) == (
        "Pub1", "2026-10-25", "2026-10-25T10:01:00Z", ["NVDA stock news"])
    assert [r.title for r in StockNewsCrawler().crawl("NVDA", limit=2, offset=1)] == ["T1", "T2"]


def test_include_topics_false_fetches_tickers_only():
    """Catches a flag that is ignored (macro and theme feeds still fetched) or that also drops the ticker feeds."""
    crawler = FakeCrawler()
    report = news.sweep_news(NOW, crawler=crawler, tickers=["NVDA"], include_topics=False)
    assert [(c["ticker"], c["lang"]) for c in crawler.calls] == [("NVDA", "en"), ("NVDA", "ko")]
    assert report.attempted == 2 and not report.failed


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


def test_ticker_only_sweep_leaves_macro_state_alone():
    """Catches an alert-ticker sweep moving the macro 12 h timer (the macro sweep would be skipped)
    or overwriting the macro failure flag (the alert card's feed_failed note would vanish)."""
    store.set_state("news_swept_at", "2026-10-18T00:00:00+00:00")
    store.set_state("news_last_sweep_failed", "1")
    news.sweep_news(NOW, crawler=FakeCrawler(), tickers=["NVDA"], include_topics=False)
    assert store.get_state("news_swept_at") == "2026-10-18T00:00:00+00:00"
    assert store.get_state("news_last_sweep_failed") == "1"
    store.set_state("news_last_sweep_failed", "0")
    news.sweep_news(NOW, crawler=FakeCrawler(fail=lambda kw: True), tickers=["NVDA"], include_topics=False)
    assert store.get_state("news_last_sweep_failed") == "0"


def test_blocked_macro_sweep_sets_the_failure_flag():
    """Catches a Google block leaving news_last_sweep_failed at "0" (the alert card would not say
    the feed failed), or a blocked sweep stamping news_swept_at."""
    store.set_state("news_last_sweep_failed", "0")

    class Blocked(FakeCrawler):
        def crawl(self, **kw):
            raise NewsBlocked("blocked", NOW + timedelta(hours=12))

    news.sweep_news(NOW, crawler=Blocked())
    assert store.get_state("news_last_sweep_failed") == "1"
    assert store.get_state("news_swept_at") is None


def test_blocked_ticker_only_sweep_leaves_the_flag_alone():
    """Catches the block branch writing the macro flag for an alert-ticker sweep."""
    store.set_state("news_last_sweep_failed", "0")

    class Blocked(FakeCrawler):
        def crawl(self, **kw):
            raise NewsBlocked("blocked", NOW + timedelta(hours=12))

    news.sweep_news(NOW, crawler=Blocked(), tickers=["NVDA"], include_topics=False)
    assert store.get_state("news_last_sweep_failed") == "0"


def test_stop_propagates_without_touching_sweep_state():
    """Catches a shutdown stop swallowed as a feed failure: the sweep would carry on through every
    feed and could flag the feed as failed."""
    from apps.api.services.news_feed import pacer

    news_stopped = getattr(pacer, "NewsStopped")
    store.set_state("news_last_sweep_failed", "0")

    class Stopping(FakeCrawler):
        def crawl(self, **kw):
            self.calls.append(kw)
            raise news_stopped("stopping")

    crawler = Stopping()
    with pytest.raises(news_stopped):
        news.sweep_news(NOW, crawler=crawler)
    assert len(crawler.calls) == 1
    assert store.get_state("news_last_sweep_failed") == "0"
    assert store.get_state("news_swept_at") is None
