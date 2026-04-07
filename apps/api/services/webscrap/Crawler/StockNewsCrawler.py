from __future__ import annotations

from datetime import datetime
from email.utils import parsedate_to_datetime
from typing import List, Optional
import logging
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from ..DAO.Economic import RiskNews

logger = logging.getLogger(__name__)


class StockNewsCrawler:
    """Google News RSS crawler for stock-specific market news."""

    def _normalize_date(self, value: Optional[str]) -> str:
        if not value:
            return datetime.now().strftime("%Y-%m-%d")
        try:
            return parsedate_to_datetime(value).date().isoformat()
        except Exception:
            return value[:10]

    def crawl(self, ticker: str, company_name: str = "", limit: int = 10, offset: int = 0) -> List[RiskNews]:
        query = f"{company_name} stock news" if company_name else f"{ticker} stock news"

        encoded_search = urllib.parse.quote(query)
        url = f"https://news.google.com/rss/search?q={encoded_search}&hl=en-US&gl=US&ceid=US:en"
        results: List[RiskNews] = []

        try:
            try:
                import feedparser

                entries = feedparser.parse(url).entries[offset:offset + limit]
                for entry in entries:
                    title = getattr(entry, "title", "")
                    link = getattr(entry, "link", "")
                    published = getattr(entry, "published", "")
                    if not title:
                        continue
                    results.append(
                        RiskNews(
                            source="Google News",
                            title=title,
                            url=link,
                            date=self._normalize_date(published),
                            matched_keywords=[query],
                        )
                    )
                return results
            except ImportError:
                pass

            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=10) as response:
                xml_payload = response.read()
            root = ET.fromstring(xml_payload)
            for item in root.findall("./channel/item")[offset:offset + limit]:
                title = item.findtext("title") or ""
                link = item.findtext("link") or ""
                published = item.findtext("pubDate") or ""
                if not title:
                    continue
                results.append(
                    RiskNews(
                        source="Google News",
                        title=title,
                        url=link,
                        date=self._normalize_date(published),
                        matched_keywords=[query],
                    )
                )
        except Exception as exc:
            logger.warning("Stock news crawl failed for %s: %s", ticker, exc)

        return results
