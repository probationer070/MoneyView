"""RegulationCrawler through the pacer. Each docstring names the mutation its test catches."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from apps.api.services.news_feed import NewsBlocked
from apps.api.services.news_feed.rss import FeedItem
from apps.api.services.webscrap.Crawler import RegulationCrawler as module

PATH = "apps.api.services.webscrap.Crawler.RegulationCrawler.google_news"


def test_missing_date_stays_empty_not_today(monkeypatch, tmp_path):
    """Catches a missing publish date replaced by today's date."""
    item = FeedItem("T", "https://x/1", "Pub", "", None, "g")
    monkeypatch.setattr(PATH, lambda *a, **k: [item])
    (result,) = module.RegulationCrawler().crawl(query="q", filepath=str(tmp_path / "log.csv"), save_log=False)
    assert result.date == ""


def test_block_stops_the_keyword_loop(monkeypatch, tmp_path):
    """Catches a loop that logs the block and goes on to the next keyword."""
    calls: list[str] = []

    def blocked(query, *a, **k):
        calls.append(query)
        raise NewsBlocked("blocked", datetime(2026, 10, 26, tzinfo=timezone.utc))

    monkeypatch.setattr(PATH, blocked)
    with pytest.raises(NewsBlocked):
        module.RegulationCrawler().crawl(filepath=str(tmp_path / "log.csv"), save_log=False)
    assert len(calls) == 1
