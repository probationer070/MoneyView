from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from apps.api.services.news_feed.rss import (
    FeedResult,
    fetch_feed,
    normalize_pub_date,
    parse_feed,
    search_url,
    strip_source_suffix,
)

FIXTURE = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "news" / "google_rss_sample.xml"


def rss_with_items(n: int) -> bytes:
    items = "".join(
        f"<item><title>Synthetic headline {i} - Example Wire</title>"
        f"<link>https://news.google.com/rss/articles/CBMiSynthetic{i}</link>"
        f'<guid isPermaLink="false">CBMiSynthetic{i}</guid>'
        f"<pubDate>Fri, 23 Oct 2026 17:39:50 GMT</pubDate>"
        f'<source url="https://example-wire.test">Example Wire</source></item>'
        for i in range(n)
    )
    return f'<?xml version="1.0"?><rss><channel><title>x</title>{items}</channel></rss>'.encode()


def test_real_time_is_kept_in_utc():
    assert normalize_pub_date("Fri, 23 Oct 2026 17:39:50 GMT") == ("2026-10-23", "2026-10-23T17:39:50Z")


@pytest.mark.parametrize("raw,day", [("Fri, 16 Oct 2026 07:00:00 GMT", "2026-10-16"),
                                     ("Wed, 27 Jan 2016 08:00:00 GMT", "2016-01-27")])
def test_placeholder_time_is_unknown(raw, day):
    assert normalize_pub_date(raw) == (day, None)


@pytest.mark.parametrize("raw", [None, "", "not a date"])
def test_missing_or_bad_date_is_empty_never_today(raw):
    assert normalize_pub_date(raw) == ("", None)


def test_publisher_suffix_is_removed_only_when_it_matches():
    assert strip_source_suffix("Apple hits record - Yahoo Finance", "Yahoo Finance") == "Apple hits record"
    assert strip_source_suffix("A - B report - MarketBeat", "MarketBeat") == "A - B report"
    assert strip_source_suffix("No suffix here", "CNBC") == "No suffix here"


def test_parse_sample_feed():
    items = parse_feed(FIXTURE.read_bytes())
    assert len(items) == 5
    assert items[0].source != "Google News" and not items[0].title.endswith(" - " + items[0].source)
    assert items[0].guid and items[0].url.startswith("https://news.google.com/rss/articles/")
    assert [i.published_at is None for i in items] == [False, True, True, True, False]
    assert items[3].published_date == ""


def test_html_body_is_failed_not_empty():
    result = fetch_feed("u", opener=lambda url: (200, b"<html><body>consent</body></html>"))
    assert result.status == "failed" and result.items == []


@pytest.mark.parametrize("status,body", [(429, b""), (503, b""),
                                         (200, b"<html>Our systems have detected unusual traffic ... automated queries</html>")])
def test_blocked_responses(status, body):
    assert fetch_feed("u", opener=lambda url: (status, body)).status == "blocked"


def test_other_http_error_is_failed():
    assert fetch_feed("u", opener=lambda url: (500, b"")).status == "failed"


def test_ok_with_zero_items_is_ok():
    empty = b'<?xml version="1.0"?><rss><channel><title>x</title></channel></rss>'
    assert fetch_feed("u", opener=lambda url: (200, empty)) == FeedResult("ok", [], "")


def test_all_hundred_items_are_returned():
    assert len(fetch_feed("u", opener=lambda url: (200, rss_with_items(100))).items) == 100


def test_assertion_error_propagates():
    def guard(url):
        raise AssertionError("test made a network call")
    with pytest.raises(AssertionError):
        fetch_feed("u", opener=guard)


def test_search_url_encodes_dates_and_edition():
    url = search_url("Apple AAPL", "en", after=date(2016, 1, 24), before=date(2016, 1, 30))
    assert "q=Apple%20AAPL%20after%3A2016-01-24%20before%3A2016-01-30" in url
    assert url.endswith("&hl=en-US&gl=US&ceid=US:en")
    assert search_url("애플 주가", "ko").endswith("&hl=ko&gl=KR&ceid=KR:ko")
