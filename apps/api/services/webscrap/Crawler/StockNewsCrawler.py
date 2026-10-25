from __future__ import annotations

from typing import List, Optional
import logging

from apps.api.services.news_feed import google_news
from apps.api.services.news_feed.pacer import Kind

from ..DAO.Economic import RiskNews

logger = logging.getLogger(__name__)


class StockNewsCrawler:
    """Google News RSS crawler for stock-specific market news."""

    def crawl(
        self,
        ticker: str,
        company_name: str = "",
        limit: int | None = None,
        offset: int = 0,
        lang: str = "en",
        query: Optional[str] = None,
        kind: Kind = "interactive",
    ) -> List[RiskNews]:
        if query is None:
            query = f"{company_name} stock news" if company_name else f"{ticker} stock news"

        try:
            items = google_news(query, "ko" if lang == "ko" else "en", kind)
        except Exception as exc:
            logger.warning("Stock news crawl failed for %s: %s", ticker, exc)
            raise
        selected = items[offset:] if limit is None else items[offset:offset + limit]
        return [
            RiskNews(
                source=item.source,
                title=item.title,
                url=item.url,
                date=item.published_date,
                matched_keywords=[query],
                published_at=item.published_at,
            )
            for item in selected
        ]
