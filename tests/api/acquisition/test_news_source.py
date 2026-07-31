from types import SimpleNamespace
import urllib.error

import pytest

from apps.api.services.acquisition.sources.news import fetch_news


def _fake_crawler(items):
    return SimpleNamespace(crawl=lambda **kwargs: items)


def test_maps_crawler_items_to_news_articles():
    items = [
        SimpleNamespace(title="Blackwell demand beats guidance",
                        url="https://example.com/a", source="Reuters", date="2026-07-31"),
    ]

    articles = fetch_news("nvda", "NVIDIA", crawler=_fake_crawler(items))

    assert len(articles) == 1
    assert articles[0].ticker == "NVDA"
    assert articles[0].headline == "Blackwell demand beats guidance"
    assert articles[0].url == "https://example.com/a"
    assert articles[0].source == "Reuters"
    assert articles[0].published_date == "2026-07-31"


def test_an_empty_crawl_returns_an_empty_list():
    assert fetch_news("NOPE", crawler=_fake_crawler([])) == []


def test_a_crawler_that_raises_propagates():
    """A provider failure must reach acquire_point_in_time as an exception so it records
    FAILED. Swallowing it into [] would record EMPTY -- indistinguishable from 'this
    ticker has no news' -- and suppress retry for a whole hour."""
    class Raises:
        def crawl(self, **kwargs):
            raise RuntimeError("provider down")

    with pytest.raises(RuntimeError):
        fetch_news("BAD", crawler=Raises())


def test_a_malformed_item_is_skipped_not_fatal():
    """One bad item costs us that item, not the ticker."""
    items = [
        SimpleNamespace(title="Good headline", url="u", source="s", date="2026-07-31"),
        SimpleNamespace(),  # no title attribute
    ]

    articles = fetch_news("AAPL", crawler=_fake_crawler(items))

    assert [a.headline for a in articles] == ["Good headline"]


def test_the_source_never_persists():
    """fetch is not save. acquire_point_in_time calls the saver; if the source also wrote,
    rows would be written twice and persistence would live in the wrong layer."""
    from apps.api.services import db as db_service

    items = [SimpleNamespace(title="H", url="u", source="s", date="2026-07-31")]
    fetch_news("AAPL", crawler=_fake_crawler(items))

    with db_service.get_db() as conn:
        assert conn.execute("SELECT COUNT(*) AS n FROM news").fetchone()["n"] == 0


def test_feedparser_bozo_with_no_entries_raises(monkeypatch):
    """When feedparser's bozo flag is set and no entries were parsed, a fetch failure
    occurred. This must raise so acquire_point_in_time records FAILED, not EMPTY."""
    import feedparser

    def parse_with_error(*args, **kwargs):
        # Simulate feedparser.parse() on a failed fetch: bozo=True, bozo_exception set, entries=[]
        exc = urllib.error.URLError("Connection timeout")
        return SimpleNamespace(bozo=True, bozo_exception=exc, entries=[])

    monkeypatch.setattr(feedparser, "parse", parse_with_error)

    from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

    crawler = StockNewsCrawler()
    with pytest.raises(urllib.error.URLError):
        fetch_news("TEST", crawler=crawler)


def test_feedparser_bozo_with_entries_still_parses(monkeypatch):
    """When feedparser's bozo flag is set but entries are present, the feed is malformed
    but usable. Do not raise; parse what came back. feedparser sets bozo for warnings too."""
    import feedparser

    def parse_malformed_but_usable(*args, **kwargs):
        # bozo=True (well-formedness warning) but we got useful entries
        entry = SimpleNamespace(title="News headline", link="http://example.com", published="2026-07-31")
        return SimpleNamespace(bozo=True, bozo_exception=None, entries=[entry])

    monkeypatch.setattr(feedparser, "parse", parse_malformed_but_usable)

    from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

    crawler = StockNewsCrawler()
    articles = fetch_news("TEST", crawler=crawler)

    assert len(articles) == 1
    assert articles[0].headline == "News headline"


def test_feedparser_no_bozo_with_no_entries_returns_empty(monkeypatch):
    """When feedparser has bozo=False and entries=[], this is a genuine no-news ticker.
    Return [] without raising, so acquire_point_in_time records EMPTY not FAILED."""
    import feedparser

    def parse_empty_but_successful(*args, **kwargs):
        # bozo=False (successful fetch), entries=[] (no news for this ticker)
        return SimpleNamespace(bozo=False, bozo_exception=None, entries=[])

    monkeypatch.setattr(feedparser, "parse", parse_empty_but_successful)

    from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

    crawler = StockNewsCrawler()
    articles = fetch_news("NOPE", crawler=crawler)

    assert articles == []


def test_urllib_fallback_still_raises_on_error(monkeypatch):
    """When feedparser is not installed, the urllib+ElementTree fallback is used.
    A network error in that path must still propagate."""
    import sys
    import urllib.request

    # Hide feedparser to force fallback to urllib
    monkeypatch.setitem(sys.modules, "feedparser", None)

    def raise_timeout(*args, **kwargs):
        raise urllib.error.URLError("Connection timeout")

    monkeypatch.setattr(urllib.request, "urlopen", raise_timeout)

    from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

    crawler = StockNewsCrawler()
    with pytest.raises(urllib.error.URLError):
        fetch_news("TEST", crawler=crawler)
