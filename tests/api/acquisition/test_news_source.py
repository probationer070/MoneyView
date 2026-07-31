from types import SimpleNamespace

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
