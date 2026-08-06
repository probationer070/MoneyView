"""Fetch stock news for one ticker and return it, without persisting.

Deliberately does not call NewsService.crawl_stock_and_save. That method saves as it goes
and catches Exception, returning []. Routed through acquire_point_in_time it would write
rows the saver is meant to write, and would turn every provider failure into an EMPTY
status -- a ticker that looks like it has no news, and is not retried until the next
boundary.

The crawler is injected so this is testable without a network.
"""
from __future__ import annotations

from apps.api.models.schemas import NewsArticle, SentimentEnum


def _default_crawler():
    from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

    return StockNewsCrawler()


def fetch_news(
    ticker: str,
    company_name: str = "",
    *,
    crawler=None,
    limit: int = 10,
) -> list[NewsArticle]:
    handle = crawler if crawler is not None else _default_crawler()
    raw = handle.crawl(ticker=ticker, company_name=company_name, limit=limit, offset=0)

    normalized_ticker = ticker.upper()
    articles: list[NewsArticle] = []
    for item in raw or []:
        try:
            headline = item.title
        except (AttributeError, KeyError, TypeError, ValueError):
            # One malformed item costs that item, not the ticker. Anything outside this
            # tuple is our bug and must reach the caller.
            continue
        if not headline:
            continue
        articles.append(
            NewsArticle(
                ticker=normalized_ticker,
                headline=str(headline),
                url=str(getattr(item, "url", "") or ""),
                source=str(getattr(item, "source", "") or ""),
                published_date=str(getattr(item, "date", "") or ""),
                sentiment=SentimentEnum.neutral,
                importance=1,
            )
        )
    return articles
