"""An article's identity is its URL under a ticker, not its headline.

Google News rewrites the publisher suffix on a headline between fetches -- the same
story arrives once as "... $AXP - MarketBeat" and again as "... $AXP - marketbeat.com".
Dedup hashed `headline + url`, so a cosmetic relabelling minted a second row for the
same article, and the tile then rendered two children keyed on the same `article.url`:

    Encountered two children with the same key, `https://news.google.com/rss/...`

Measured in the live database: 32 duplicated (ticker, url) pairs, 400 distinct urls
across 432 rows, and zero duplicate (ticker, hash) groups -- the constraint was doing
exactly what it was told, on the wrong identity.

The pre-existing dedup test only ever repeated an *identical* article, so it could not
see this: the headline has to vary while the url holds still.
"""

from __future__ import annotations

from apps.api.models.schemas import NewsArticle
from apps.api.services.acquisition.store import save_news
from apps.api.services.db import get_db
from apps.api.services.news_service import NewsService

_URL = "https://news.google.com/rss/articles/CBMi8AFBVV95cUxQU3IyODlmSllVSFRoM05Vbkh1"

# The two headlines observed for news id 376 and 506, differing only in how Google
# spelled the publisher.
_HEADLINE_A = "Arizona State Retirement System Sells 3,525 Shares of American Express Company $AXP - MarketBeat"
_HEADLINE_B = "Arizona State Retirement System Sells 3,525 Shares of American Express Company $AXP - marketbeat.com"


def _article(headline: str, url: str = _URL, ticker: str = "AXP") -> NewsArticle:
    return NewsArticle(
        ticker=ticker,
        headline=headline,
        url=url,
        source="Google News",
        published_date="2026-09-08",
    )


def _rows(ticker: str = "AXP") -> list:
    with get_db() as conn:
        return conn.execute(
            "SELECT headline, url FROM news WHERE ticker = ?", (ticker,)
        ).fetchall()


def test_a_relabelled_publisher_does_not_mint_a_second_article():
    """The exact pair found in the live database."""
    save_news("AXP", [_article(_HEADLINE_A)])
    save_news("AXP", [_article(_HEADLINE_B)])

    assert len(_rows()) == 1


def test_the_service_write_path_agrees_with_the_store_write_path():
    """Two implementations hashed the same way; they must stay dedup-equivalent."""
    service = NewsService()

    service.save_article(_article(_HEADLINE_A))
    service.save_article(_article(_HEADLINE_B))

    assert len(_rows()) == 1


def test_a_genuinely_different_article_still_lands():
    save_news("AXP", [_article(_HEADLINE_A)])
    save_news("AXP", [_article("A wholly different story", url=_URL + "-other")])

    assert len(_rows()) == 2


def test_one_url_covering_two_tickers_is_kept_for_both():
    """Guards the latent half: the old hash omitted the ticker entirely.

    An article naming two companies is one row per ticker, not one row total -- and
    dedup keyed on url alone would silently drop the second ticker's copy. There are
    no such rows in the live database today, which is why this never bit.
    """
    save_news("AXP", [_article(_HEADLINE_A, ticker="AXP")])
    save_news("V", [_article(_HEADLINE_A, ticker="V")])

    assert len(_rows("AXP")) == 1
    assert len(_rows("V")) == 1


def test_the_bulk_read_serves_no_duplicate_urls_from_a_database_that_holds_them():
    """The 32 duplicate rows already stored must not reach the tile.

    Written directly with distinct hashes to reproduce a pre-fix database, since the
    write path now refuses them.
    """
    with get_db() as conn:
        conn.executemany(
            """INSERT OR IGNORE INTO news
                   (ticker, headline, url, source, published_date, sentiment, importance, hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                ("AXP", _HEADLINE_A, _URL, "Google News", "2026-09-08", "neutral", 1, "hash-a"),
                ("AXP", _HEADLINE_B, _URL, "Google News", "2026-09-08", "neutral", 1, "hash-b"),
                ("AXP", "Third story", _URL + "-3", "Google News", "2026-09-07", "neutral", 1, "hash-c"),
            ],
        )

    articles = NewsService().get_news_bulk(["AXP"], per_ticker=3)["AXP"]["articles"]
    urls = [article.url for article in articles]

    assert len(urls) == len(set(urls)), f"duplicate urls reached the tile: {urls}"


def test_the_bulk_read_still_fills_the_tile_when_enough_distinct_articles_exist():
    """Deduping must not cost an article: three distinct stories still return three."""
    with get_db() as conn:
        conn.executemany(
            """INSERT OR IGNORE INTO news
                   (ticker, headline, url, source, published_date, sentiment, importance, hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                ("AXP", "Dup one", _URL, "Google News", "2026-09-08", "neutral", 1, "h1"),
                ("AXP", "Dup two", _URL, "Google News", "2026-09-08", "neutral", 1, "h2"),
                ("AXP", "Story two", _URL + "-2", "Google News", "2026-09-07", "neutral", 1, "h3"),
                ("AXP", "Story three", _URL + "-3", "Google News", "2026-09-06", "neutral", 1, "h4"),
            ],
        )

    articles = NewsService().get_news_bulk(["AXP"], per_ticker=3)["AXP"]["articles"]

    assert len(articles) == 3
    assert len({article.url for article in articles}) == 3
