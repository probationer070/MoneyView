"""News service wrapping backend crawlers and SQLite news storage."""

from __future__ import annotations

import hashlib
import logging
from typing import List, Optional

from apps.api.services.db import get_db
from apps.api.models.schemas import NewsArticle, SentimentEnum

logger = logging.getLogger(__name__)


class NewsService:
    """Read / write news articles with deduplication via MD5 hash."""

    @staticmethod
    def _hash(headline: str, url: str) -> str:
        return hashlib.md5(f"{headline}{url}".encode()).hexdigest()

    def get_news(
        self,
        ticker:  Optional[str] = None,
        limit:   int = 20,
        keyword: Optional[str] = None,
        offset:  int = 0,
    ) -> List[NewsArticle]:
        """Fetch news from SQLite, optionally filtered by ticker or keyword."""
        with get_db() as conn:
            if ticker:
                rows = conn.execute(
                    """SELECT * FROM news
                       WHERE ticker = ?
                       ORDER BY published_date DESC
                       LIMIT ? OFFSET ?""",
                    (ticker, limit, offset),
                ).fetchall()
            elif keyword:
                rows = conn.execute(
                    """SELECT * FROM news
                       WHERE headline LIKE ?
                       ORDER BY published_date DESC
                       LIMIT ? OFFSET ?""",
                    (f"%{keyword}%", limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT * FROM news
                       ORDER BY published_date DESC
                       LIMIT ? OFFSET ?""",
                    (limit, offset),
                ).fetchall()

        articles = [
            NewsArticle(
                id=r["id"],
                ticker=r["ticker"],
                headline=r["headline"],
                url=r["url"] or "",
                source=r["source"] or "",
                published_date=r["published_date"] or "",
                sentiment=SentimentEnum(r["sentiment"] or "neutral"),
                importance=int(r["importance"] or 1),
            )
            for r in rows
        ]
        if articles or ticker or keyword:
            return articles

        return self._latest_indicators_as_news(limit=limit, offset=offset)

    def _latest_indicators_as_news(self, limit: int, offset: int = 0) -> List[NewsArticle]:
        """Use local macro indicators as first-run Market Intelligence content."""
        with get_db() as conn:
            rows = conn.execute(
                """SELECT category, name, code, value, unit, date, source
                   FROM indicators
                   WHERE value IS NOT NULL
                   ORDER BY date DESC
                   LIMIT ?""",
                ((limit + offset) * 10,),
            ).fetchall()

        articles: List[NewsArticle] = []
        seen_codes = set()
        for row in rows:
            if row["code"] in seen_codes:
                continue
            seen_codes.add(row["code"])
            if len(articles) >= limit + offset:
                break
            unit = row["unit"] or ""
            source = row["source"] or "Local indicators"
            articles.append(NewsArticle(
                id=-(len(articles) + 1),
                ticker=None,
                headline=f"{row['name']} updated to {row['value']}{unit}",
                url="",
                source=source,
                published_date=str(row["date"] or ""),
                sentiment=SentimentEnum.neutral,
                importance=1,
            ))
        return articles[offset:offset + limit]

    def save_article(self, article: NewsArticle) -> bool:
        """Persist a single article; skip if duplicate (hash collision)."""
        h = self._hash(article.headline, article.url)
        try:
            with get_db() as conn:
                conn.execute(
                    """INSERT OR IGNORE INTO news
                       (ticker, headline, url, source, published_date,
                        sentiment, importance, hash)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (article.ticker, article.headline, article.url,
                     article.source, article.published_date,
                     article.sentiment.value, article.importance, h),
                )
            return True
        except Exception as exc:
            logger.error("Failed to save article: %s", exc)
            return False

    def crawl_and_save(
        self,
        query:  str,
        ticker: Optional[str] = None,
        limit:  int = 10,
    ) -> List[NewsArticle]:
        """Use the existing RegulationCrawler to fetch news and persist it."""
        try:
            from apps.api.services.webscrap.Crawler.RegulationCrawler import RegulationCrawler
            crawler = RegulationCrawler()
            # crawl() returns RiskNews dataclass list
            raw = crawler.crawl(query=query, limit=limit, filepath=None)
            saved = []
            for r in raw:
                art = NewsArticle(
                    ticker=ticker,
                    headline=getattr(r, "title", str(r)),
                    url=getattr(r, "url", ""),
                    source=getattr(r, "source", "Web"),
                    published_date=getattr(r, "date", ""),
                )
                self.save_article(art)
                saved.append(art)
            return saved
        except Exception as exc:
            logger.warning("Crawl failed for '%s': %s", query, exc)
            return []

    def crawl_stock_and_save(
        self,
        ticker: str,
        company_name: str = "",
        limit: int = 10,
        offset: int = 0,
    ) -> List[NewsArticle]:
        """Crawl stock-specific news and persist normalized articles."""
        try:
            from apps.api.services.webscrap.Crawler.StockNewsCrawler import StockNewsCrawler

            crawler = StockNewsCrawler()
            raw = crawler.crawl(ticker=ticker, company_name=company_name, limit=limit, offset=offset)
            saved: List[NewsArticle] = []
            for item in raw:
                article = NewsArticle(
                    ticker=ticker.upper(),
                    headline=getattr(item, "title", str(item)),
                    url=getattr(item, "url", ""),
                    source=getattr(item, "source", "Google News"),
                    published_date=getattr(item, "date", ""),
                    sentiment=SentimentEnum.neutral,
                    importance=1,
                )
                self.save_article(article)
                saved.append(article)
            return saved
        except Exception as exc:
            logger.warning("Stock crawl failed for '%s': %s", ticker, exc)
            return []
