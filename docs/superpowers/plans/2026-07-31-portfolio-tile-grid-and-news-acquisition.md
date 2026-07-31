# Portfolio Tile Grid and News Acquisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2,726-line vertical stack on `/portfolio` with a tile grid plus a sticky icon rail whose icons open the existing analytical sections as side panels, and make news a proper acquisition data class refreshed for every visible stock in one action.

**Architecture:** News joins the existing acquisition layer as a `news` data class on a new `Hourly` boundary, so the refresh button goes through `acquire_point_in_time` rather than around it and a second press within the hour costs nothing. The frontend gains four components — a shell, a slide-over panel, a tile grid and a tile — while `page.tsx` keeps its query wiring and shrinks to composition.

**Tech Stack:** FastAPI + SQLite + Pydantic (backend), Next.js 16 / React 19 / TanStack Query v5 / Tailwind (frontend), pytest (backend tests), Playwright (frontend tests).

**Design:** `docs/superpowers/specs/2026-07-31-portfolio-tile-grid-and-news-acquisition-design.md`

## Global Constraints

- **There is no frontend unit-test runner.** `apps/web/package.json` defines only `test:e2e` (Playwright). Every frontend test in this plan is a Playwright spec using the existing route-mocking helpers. Do not add Jest, Vitest, or Testing Library.
- **Backend suite must stay at 386 passed, 2 warnings or better.** Run `python -m pytest tests/core_finance/ tests/api/ -q` from the repo root.
- **`npx tsc --noEmit` must pass from `apps/web`** after every frontend task.
- **No network in tests.** `tests/conftest.py::_forbid_network` fails any test that reaches out, through sockets and through curl_cffi (sync and async). Every news test injects a crawler.
- **Missing values stay missing.** `guideline/sop/finance-logic.md` prohibits false precision; never substitute `0.0` or `""` for an absent figure.
- **Sources catch only `(AttributeError, KeyError, TypeError, ValueError)`.** Anything wider swallows bugs into a `FAILED` status. `acquire_point_in_time` catches `Exception` broadly but re-raises `AssertionError`.
- **Batch execution is sequential**, inside one `asyncio.to_thread` worker. Measured 2026-07-31: one crawl is 0.8–1.0 s, so twelve tiles is ~11 s. Do not introduce concurrency.
- **Commit after every task.** End commit messages with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

**Backend — create**

| File | Responsibility |
|---|---|
| `apps/api/services/acquisition/sources/news.py` | `fetch_news` — crawl one ticker, return articles, never persist |

**Backend — modify**

| File | Change |
|---|---|
| `apps/api/services/acquisition/boundaries.py` | Add `Hourly` |
| `apps/api/services/acquisition/store.py` | Add `save_news`, `news_coverage` |
| `apps/api/services/acquisition/registry.py` | Register the `news` data class |
| `apps/api/routes/news.py` | Add `GET /news/feed/bulk` and `POST /news/acquire` |
| `apps/api/models/schema_parts/news.py` | Response models for both new routes |
| `apps/api/routes/portfolio.py` | Include `id` in the watchlist response |
| `apps/api/models/schema_parts/watchlist.py` | `id` on `PortfolioStock` |

**Frontend — create**

| File | Responsibility |
|---|---|
| `apps/web/app/portfolio/components/SidePanel.tsx` | Slide-over: focus trap, `Esc`, `aria-modal` |
| `apps/web/app/portfolio/components/PortfolioShell.tsx` | Two-column grid, sticky rail, one-panel-at-a-time state |
| `apps/web/app/portfolio/components/StockTile.tsx` | One tile: price header plus headlines |
| `apps/web/app/portfolio/components/StockTileGrid.tsx` | Grid, membership rule, filter and search |
| `apps/web/lib/portfolioNews.ts` | `fetchBulkNews`, `acquireNews` and their types |

**Frontend — modify**

| File | Change |
|---|---|
| `apps/web/app/portfolio/page.tsx` | Compose the shell, move section JSX into panels, wire refresh |
| `apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx` | Becomes a panel body; remove the dead stale banner |
| `apps/web/tests/e2e/helpers/portfolioPageMock.ts` | Mock the two new routes; update selectors |

---

## Task 1: `Hourly` freshness boundary

**Files:**
- Modify: `apps/api/services/acquisition/boundaries.py`
- Test: `tests/api/acquisition/test_boundaries.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `Hourly(at_minute: int = 0)` with `most_recent_instant(now: datetime) -> datetime`, importable from `apps.api.services.acquisition.boundaries`.

**Context:** `Daily` and `Weekly` already live in this file. Read them first — `Hourly` mirrors their structure exactly: a frozen dataclass, `__post_init__` validation that fails at declaration rather than deep inside a later `replace()`, and a `most_recent_instant` that rejects naive datetimes. The file's docstring explains why boundaries are pure (`now` is a parameter, never a clock read).

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/acquisition/test_boundaries.py`, and add `Hourly` to the existing import on line 5:

```python
def test_hourly_most_recent_instant_is_this_hour_when_past_the_minute():
    boundary = Hourly(at_minute=0)
    now = datetime(2026, 7, 31, 14, 30, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 31, 14, 0, tzinfo=UTC)


def test_hourly_most_recent_instant_is_previous_hour_when_before_the_minute():
    boundary = Hourly(at_minute=30)
    now = datetime(2026, 7, 31, 14, 5, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 31, 13, 30, tzinfo=UTC)


def test_hourly_boundary_instant_itself_counts_as_passed():
    """At exactly the boundary the new window has begun. An off-by-one here serves a
    whole hour of staleness as fresh."""
    boundary = Hourly(at_minute=0)
    now = datetime(2026, 7, 31, 14, 0, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 31, 14, 0, tzinfo=UTC)


def test_hourly_rolls_back_across_midnight():
    boundary = Hourly(at_minute=30)
    now = datetime(2026, 8, 1, 0, 10, tzinfo=UTC)
    assert boundary.most_recent_instant(now) == datetime(2026, 7, 31, 23, 30, tzinfo=UTC)


def test_hourly_rejects_a_naive_datetime():
    with pytest.raises(ValueError, match="timezone-aware"):
        Hourly(at_minute=0).most_recent_instant(datetime(2026, 7, 31, 14, 0))


def test_hourly_rejects_an_out_of_range_minute():
    """Validation at declaration: a boundary silently governs every freshness decision
    for its class, so a typo must fail here rather than at the first acquisition."""
    with pytest.raises(ValueError, match="at_minute must be 0-59"):
        Hourly(at_minute=60)
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/acquisition/test_boundaries.py -q`
Expected: FAIL — `ImportError: cannot import name 'Hourly'`.

- [ ] **Step 3: Implement `Hourly`**

Add to `apps/api/services/acquisition/boundaries.py`, after `Weekly`:

```python
@dataclass(frozen=True)
class Hourly:
    """Invalid once the next occurrence of `:at_minute` UTC passes.

    News is the only class using this, and the choice is a rate-limit decision as much as
    a freshness one: the refresh button is the control a user is most likely to press
    repeatedly, so the boundary is what stands between an impatient click and unbounded
    provider load. Daily would leave the button inert for 23 hours out of 24; per-press
    crawling would remove the limit entirely.
    """

    at_minute: int = 0

    def __post_init__(self) -> None:
        if not 0 <= self.at_minute <= 59:
            raise ValueError(f"at_minute must be 0-59, got {self.at_minute}")

    def most_recent_instant(self, now: datetime) -> datetime:
        if now.tzinfo is None:
            raise ValueError("Boundary comparisons require a timezone-aware datetime (UTC)")
        candidate = now.replace(minute=self.at_minute, second=0, microsecond=0)
        if candidate > now:
            candidate -= timedelta(hours=1)
        return candidate
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/acquisition/test_boundaries.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/boundaries.py tests/api/acquisition/test_boundaries.py
git commit -m "feat: add an Hourly freshness boundary

News needs a boundary short enough that a refresh button does something,
and long enough to stand between repeated clicks and unbounded provider
load. Mirrors Daily and Weekly: frozen, pure, validated at declaration,
rejects naive datetimes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ `Hourly` rolls back across midnight. ✓ The boundary instant itself counts as passed. ✓ An out-of-range minute fails at declaration.

---

## Task 2: `fetch_news` acquisition source

**Files:**
- Create: `apps/api/services/acquisition/sources/news.py`
- Test: `tests/api/acquisition/test_news_source.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `fetch_news(ticker: str, company_name: str = "", *, crawler=None) -> list[NewsArticle]`.

**Context — read this before writing code.** `NewsService.crawl_stock_and_save` looks like the obvious thing to call. **Do not call it.** Two reasons:

1. It **persists** (`self.save_article(article)` per item). The acquisition layer separates `fetcher` from `saver`, and `acquire_point_in_time` calls the saver itself. Using it would write rows twice and put persistence in the wrong layer.
2. It catches `Exception` and returns `[]`. A provider failure would therefore reach `acquire_point_in_time` as an **empty result**, recording `EMPTY` instead of `FAILED` — the ticker would look like "no news exists" and, because `last_checked_at` still advances, would not be retried for an hour.

So `fetch_news` drives `StockNewsCrawler` directly. Its `crawl(ticker, company_name="", limit=10, offset=0) -> list[RiskNews]` returns dataclasses with `source, title, url, date` (see `apps/api/services/webscrap/DAO/Economic.py`). The crawler's `_normalize_date` already returns ISO `YYYY-MM-DD`.

Model the injection on `sources/statements.py`, which takes `ticker_factory` for exactly this reason.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/acquisition/test_news_source.py`:

```python
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/acquisition/test_news_source.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.acquisition.sources.news'`.

- [ ] **Step 3: Implement the source**

Create `apps/api/services/acquisition/sources/news.py`:

```python
"""Fetch stock news for one ticker and return it, without persisting.

Deliberately does not call NewsService.crawl_stock_and_save. That method saves as it goes
and catches Exception, returning []. Routed through acquire_point_in_time it would write
rows the saver is meant to write, and would turn every provider failure into an EMPTY
status -- a ticker that looks like it has no news, and is not retried until the next
boundary.

The crawler is injected so this is testable without a network.
"""
from __future__ import annotations

from apps.api.models.schemas import NewsArticle
from apps.api.models.schema_parts.enums import SentimentEnum


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
```

Check the import path for `SentimentEnum` first — `apps/api/services/news_service.py` imports it; copy whatever that file uses.

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/acquisition/test_news_source.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/sources/news.py tests/api/acquisition/test_news_source.py
git commit -m "feat: news acquisition source that fetches without persisting

Drives StockNewsCrawler directly rather than NewsService.crawl_stock_and_save,
which saves as it goes and catches Exception into []. Through
acquire_point_in_time that method would write rows the saver is meant to
write, and would record every provider failure as EMPTY -- a ticker that
looks like it has no news and is not retried for an hour.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Crawler items map to `NewsArticle` with an upper-cased ticker. ✓ A raising crawler propagates. ✓ A malformed item is skipped. ✓ Nothing is written to the `news` table.

---

## Task 3: `save_news` and `news_coverage`

**Files:**
- Modify: `apps/api/services/acquisition/store.py`
- Test: `tests/api/acquisition/test_store.py`

**Interfaces:**
- Consumes: `fetch_news` from Task 2 (for the `NewsArticle` type only).
- Produces: `save_news(ticker: str, articles: list[NewsArticle]) -> None` and `news_coverage(articles: list[NewsArticle]) -> tuple[date, date]`.

**Context:** The `news` table already exists with `hash TEXT UNIQUE`, so dedupe is `INSERT OR IGNORE` and needs no schema change. `NewsService._hash` is `md5(f"{headline}{url}")` — reuse that exact formula or duplicate rows will appear under a second hash. Read `save_statements` above your insertion point: it upper-cases the **subject parameter**, not `row.ticker`, and the comment explains why. Do the same.

`acquire_point_in_time` requires `coverage(rows) -> (date, date)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/acquisition/test_store.py`:

```python
def test_save_news_persists_and_dedupes_by_hash():
    articles = [
        NewsArticle(ticker="AAPL", headline="Same headline", url="https://x/1",
                    source="s", published_date="2026-07-31"),
        NewsArticle(ticker="AAPL", headline="Same headline", url="https://x/1",
                    source="s", published_date="2026-07-31"),
        NewsArticle(ticker="AAPL", headline="Other", url="https://x/2",
                    source="s", published_date="2026-07-30"),
    ]

    save_news("AAPL", articles)
    save_news("AAPL", articles)  # a second acquisition of the same articles

    with db_service.get_db() as conn:
        rows = conn.execute("SELECT headline FROM news WHERE ticker = 'AAPL'").fetchall()

    assert len(rows) == 2


def test_save_news_normalises_the_subject_ticker():
    """The subject is the authority, as in save_statements. If writes stored 'aapl' while
    reads upper-case, rows would be unreadable while acquisition_state said OK."""
    save_news("aapl", [NewsArticle(ticker="whatever", headline="H", url="u",
                                   source="s", published_date="2026-07-31")])

    with db_service.get_db() as conn:
        assert conn.execute(
            "SELECT COUNT(*) AS n FROM news WHERE ticker = 'AAPL'"
        ).fetchone()["n"] == 1


def test_news_coverage_spans_the_published_dates():
    articles = [
        NewsArticle(ticker="A", headline="a", url="1", source="s", published_date="2026-07-28"),
        NewsArticle(ticker="A", headline="b", url="2", source="s", published_date="2026-07-31"),
    ]

    assert news_coverage(articles) == (date(2026, 7, 28), date(2026, 7, 31))


def test_news_coverage_falls_back_to_today_when_no_article_is_dated():
    """An undated batch still happened today. Returning a wrong date range would corrupt
    the coverage record that a later range-planning class may depend on."""
    today = datetime.now(timezone.utc).date()
    articles = [NewsArticle(ticker="A", headline="a", url="1", source="s", published_date="")]

    assert news_coverage(articles) == (today, today)
```

Add `datetime`, `timezone` and `NewsArticle` to the file's imports, plus `news_coverage` and `save_news` to the `store` import.

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/acquisition/test_store.py -q`
Expected: FAIL — `ImportError: cannot import name 'save_news'`.

- [ ] **Step 3: Implement both functions**

Add to `apps/api/services/acquisition/store.py`, after `save_quote_facts`:

```python
def news_coverage(articles: list[NewsArticle]) -> tuple[date, date]:
    published = []
    for article in articles:
        if not article.published_date:
            continue
        try:
            published.append(date.fromisoformat(article.published_date))
        except ValueError:
            # A provider date we cannot parse is not a date. Guessing one would put a
            # fabricated range into the coverage record.
            continue
    if not published:
        today = datetime.now(timezone.utc).date()
        return today, today
    return min(published), max(published)


def save_news(ticker: str, articles: list[NewsArticle]) -> None:
    # Same rule as save_statements: the subject parameter is authoritative, not
    # article.ticker. acquisition_state is keyed by subject and the bulk read upper-cases,
    # so a disagreement stores rows nobody can read while the state table reports OK.
    ticker = ticker.upper()
    with get_db() as conn:
        conn.executemany(
            """INSERT OR IGNORE INTO news
                   (ticker, headline, url, source, published_date, sentiment, importance, hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    ticker,
                    article.headline,
                    article.url,
                    article.source,
                    article.published_date,
                    article.sentiment.value,
                    article.importance,
                    hashlib.md5(f"{article.headline}{article.url}".encode()).hexdigest(),
                )
                for article in articles
            ],
        )
```

Add `import hashlib` and `from apps.api.models.schemas import NewsArticle` to the imports.

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/acquisition/test_store.py -q`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/acquisition/store.py tests/api/acquisition/test_store.py
git commit -m "feat: news store with hash dedupe and coverage

Reuses the existing news.hash UNIQUE constraint and NewsService's md5
formula, so a re-acquisition inserts nothing new. The subject parameter is
authoritative as in save_statements. Undated batches fall back to today
rather than fabricating a coverage range.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Re-saving the same articles adds no rows. ✓ A lowercase subject stores under the upper-cased ticker. ✓ Coverage spans published dates and falls back to today when none parse.

---

## Task 4: Register the `news` data class and add `POST /news/acquire`

**Files:**
- Modify: `apps/api/services/acquisition/registry.py`, `apps/api/routes/news.py`, `apps/api/models/schema_parts/news.py`
- Test: `tests/api/test_news_acquire.py` (create)

**Interfaces:**
- Consumes: `Hourly` (Task 1), `fetch_news` (Task 2), `save_news` / `news_coverage` (Task 3).
- Produces: `POST /api/v1/news/acquire`, and `acquire_news_batch(tickers, *, now, fetcher=fetch_news) -> list[dict]` in `apps/api/routes/news.py`.

**Context:** `acquire_point_in_time(data_class_name, subject, *, now, fetcher, saver, coverage)` calls `fetcher(subject)` with **one positional argument**, so `fetch_news`'s `company_name` must be bound by the caller — build a small closure per ticker, the same way `acquire_comparison_datasets` injects its fetchers.

`crawl_stock_and_save` is synchronous and blocking, and so is the crawler underneath `fetch_news`. Twelve tickers is ~11 s measured. Running that on the event loop would stall every other request, so the loop runs inside `asyncio.to_thread`. A `to_thread` worker cannot be cancelled once started — that is why the design states the batch continues server-side if the client leaves.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_news_acquire.py`:

```python
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.models.schemas import NewsArticle
from apps.api.routes.news import acquire_news_batch
from apps.api.services import db as db_service
from apps.api.services.acquisition.state import record_success

NOW = datetime(2026, 7, 31, 14, 30, tzinfo=timezone.utc)


def _seed_watchlist(tickers):
    with db_service.get_db() as conn:
        for ticker in tickers:
            conn.execute(
                "INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                " VALUES (?, ?, '', 'core', 0.0)",
                (ticker, ticker),
            )


def _article(ticker):
    return NewsArticle(ticker=ticker, headline=f"{ticker} headline",
                       url=f"https://x/{ticker}", source="s", published_date="2026-07-31")


def test_a_stale_ticker_is_acquired(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])

    results = acquire_news_batch(
        ["AAPL"], now=NOW, fetcher=lambda ticker, company_name="": [_article(ticker)]
    )

    assert results == [{"ticker": "AAPL", "status": "acquired", "articles": 1, "detail": None}]


def test_a_fresh_ticker_is_skipped_without_fetching(tmp_path, monkeypatch):
    """Freshness asks 'have I asked since the boundary'. A second press within the hour
    must perform no provider work at all -- that is what makes the button safe to press."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])
    record_success("news", "AAPL", now=NOW, covered_from=NOW.date(), covered_to=NOW.date())

    calls = []
    results = acquire_news_batch(
        ["AAPL"], now=NOW,
        fetcher=lambda ticker, company_name="": calls.append(ticker) or [],
    )

    assert calls == []
    assert results[0]["status"] == "fresh"


def test_one_failing_ticker_does_not_abort_the_batch(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL", "MSFT"])

    def flaky(ticker, company_name=""):
        if ticker == "AAPL":
            raise RuntimeError("provider timeout")
        return [_article(ticker)]

    results = acquire_news_batch(["AAPL", "MSFT"], now=NOW, fetcher=flaky)

    by_ticker = {row["ticker"]: row for row in results}
    assert by_ticker["AAPL"]["status"] == "failed"
    assert "provider timeout" in by_ticker["AAPL"]["detail"]
    assert by_ticker["MSFT"]["status"] == "acquired"


def test_duplicates_collapse_to_one_acquisition(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])

    calls = []
    results = acquire_news_batch(
        ["AAPL", "aapl", "AAPL"], now=NOW,
        fetcher=lambda ticker, company_name="": calls.append(ticker) or [_article(ticker)],
    )

    assert calls == ["AAPL"]
    assert len(results) == 1


def test_the_route_rejects_an_empty_and_an_oversized_request(tmp_path, monkeypatch):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])
    client = TestClient(app)

    assert client.post("/api/v1/news/acquire", json={"tickers": []}).status_code == 400
    assert client.post(
        "/api/v1/news/acquire", json={"tickers": [f"T{i}" for i in range(101)]}
    ).status_code == 400


def test_a_ticker_outside_the_watchlist_is_reported_not_crawled(tmp_path, monkeypatch):
    """This is what stops the endpoint becoming a generic crawler. Skipping rather than
    400ing keeps an ordinary remove-during-session race from failing the whole batch."""
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
    db_service.init_db()
    _seed_watchlist(["AAPL"])

    calls = []
    results = acquire_news_batch(
        ["AAPL", "ZZZZ"], now=NOW,
        fetcher=lambda ticker, company_name="": calls.append(ticker) or [],
    )

    assert calls == ["AAPL"]
    assert [row["ticker"] for row in results] == ["AAPL"]
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_news_acquire.py -q`
Expected: FAIL — `ImportError: cannot import name 'acquire_news_batch'`.

- [ ] **Step 3: Register the data class**

In `apps/api/services/acquisition/registry.py`, add `Hourly` to the `boundaries` import, then add to `REGISTRY`:

```python
    # Hourly is a rate-limit decision as much as a freshness one: the refresh button is
    # the control most likely to be pressed repeatedly, and the boundary is what bounds
    # the provider load that results.
    "news": DataClass(
        name="news",
        scope=Scope.PER_TICKER,
        boundary=Hourly(at_minute=0),
        store="news",
        calendar="us_equity",
    ),
```

If the module docstring still says the registry declares only the two bar classes, update it — Task 5 of the previous plan already made that stale once.

- [ ] **Step 4: Implement the batch function and the route**

In `apps/api/models/schema_parts/news.py`:

```python
class NewsAcquireRequest(BaseModel):
    tickers: List[str]


class NewsAcquireResult(BaseModel):
    ticker: str
    status: str          # acquired | fresh | empty | failed
    articles: int = 0
    detail: Optional[str] = None


class NewsAcquireResponse(BaseModel):
    results: List[NewsAcquireResult]
    skipped_unknown: List[str] = Field(default_factory=list)
```

In `apps/api/routes/news.py`:

```python
MAX_ACQUIRE_TICKERS = 100


def _watchlist_names() -> dict[str, str]:
    with get_db() as conn:
        rows = conn.execute("SELECT ticker, name FROM watchlist").fetchall()
    return {str(row["ticker"]).upper(): str(row["name"] or "") for row in rows}


def acquire_news_batch(tickers, *, now, fetcher=fetch_news) -> list[dict]:
    """Acquire news for each ticker in turn.

    Sequential by decision, not by omission. Measured 2026-07-31, one crawl is 0.8-1.0s,
    so twelve tiles is about eleven seconds -- acceptable behind a progress counter, and
    it matches the rest of the acquisition layer. A bounded pool would trade that known
    cost for an unmeasured rate-limit risk on an action the hourly boundary already caps
    at once per ticker per hour.
    """
    names = _watchlist_names()
    seen: set[str] = set()
    results: list[dict] = []

    for raw in tickers:
        ticker = str(raw).upper().strip()
        if not ticker or ticker in seen or ticker not in names:
            continue
        seen.add(ticker)
        company_name = names[ticker]
        outcome = acquire_point_in_time(
            "news",
            ticker,
            now=now,
            fetcher=lambda subject: fetcher(subject, company_name=company_name),
            saver=save_news,
            coverage=news_coverage,
        )
        results.append({
            "ticker": ticker,
            "status": outcome.status,
            "articles": outcome.fetched,
            "detail": read_state("news", ticker).detail if outcome.status == "failed" else None,
        })
    return results


@router.post("/acquire", response_model=NewsAcquireResponse)
async def acquire_news(request: NewsAcquireRequest):
    """Refresh news for the given tickers, through the acquisition layer."""
    if len(request.tickers) > MAX_ACQUIRE_TICKERS:
        raise HTTPException(status_code=400,
                            detail=f"at most {MAX_ACQUIRE_TICKERS} tickers per request")

    names = _watchlist_names()
    requested = [str(t).upper().strip() for t in request.tickers if str(t).strip()]
    known = [t for t in requested if t in names]
    skipped = sorted({t for t in requested if t not in names})
    if not known:
        raise HTTPException(status_code=400, detail="no known tickers in request")

    # to_thread because the crawler blocks: ~11s on the event loop would stall every
    # other request. The worker cannot be cancelled once started, which is why the batch
    # continues server-side if the client navigates away.
    results = await asyncio.to_thread(
        acquire_news_batch, known, now=datetime.now(timezone.utc)
    )
    return NewsAcquireResponse(results=results, skipped_unknown=skipped)
```

Add the imports: `asyncio`, `datetime`/`timezone`, `HTTPException`, `get_db`, `acquire_point_in_time`, `read_state`, `fetch_news`, `save_news`, `news_coverage`, and the three new models.

Note the closure captures `company_name` per iteration via the loop variable — because `acquire_point_in_time` calls the fetcher immediately inside the same iteration, this is safe.

- [ ] **Step 5: Run to verify they pass**

Run: `python -m pytest tests/api/test_news_acquire.py tests/api/acquisition/ -q`
Expected: all pass.

- [ ] **Step 6: Run the full backend suite**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 0 failed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/acquisition/registry.py apps/api/routes/news.py apps/api/models/schema_parts/news.py tests/api/test_news_acquire.py
git commit -m "feat: news data class and batch acquire route

News joins the acquisition registry on an Hourly boundary, so the refresh
button goes through acquire_point_in_time and a second press within the hour
performs no provider work.

The route validates rather than trusts: upper-case and dedupe, intersect with
the watchlist so this cannot become a generic crawler, 400 on an empty
post-validation list or over 100 tickers. Unknown tickers are reported in
skipped_unknown rather than rejected, because a stock removed mid-session is
a race and not a client error.

Sequential by decision -- measured 0.8-1.0s per crawl -- inside a worker
thread, since the crawler blocks and 11s on the event loop would stall every
other request.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Stale acquires, fresh skips without fetching. ✓ One failure does not abort the batch and the response is still 200. ✓ Duplicates collapse. ✓ Unknown tickers are never crawled. ✓ Empty and >100 return 400.

---

## Task 5: `GET /news/feed/bulk` with acquisition-state join

**Files:**
- Modify: `apps/api/routes/news.py`, `apps/api/services/news_service.py`, `apps/api/models/schema_parts/news.py`
- Test: `tests/api/test_news_bulk_feed.py` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /api/v1/news/feed/bulk?tickers=A,B&per_ticker=3` returning `{"tickers": {ticker: {"articles": [...], "last_checked_at": str | None}}}`.

**Context:** Twelve tiles must cost one request, not twelve. The response also carries `last_checked_at` from `acquisition_state` so a tile can tell "checked, nothing found" from "never checked" — without it an empty tile is ambiguous.

Ordering is `published_date DESC, id DESC` **with empty dates last**. `news.published_date` is `TEXT DEFAULT ''`, and in SQLite `'' < '2026-07-31'`, so a plain `DESC` already puts empty last — but make it explicit with a `CASE`, because a future `NULL` would sort differently and the intent must survive.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_news_bulk_feed.py`:

```python
import sys
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services import db as db_service
from apps.api.services.acquisition.state import record_success

NOW = datetime(2026, 7, 31, 14, 0, tzinfo=timezone.utc)


def _insert(ticker, headline, published_date, url):
    with db_service.get_db() as conn:
        conn.execute(
            "INSERT INTO news (ticker, headline, url, source, published_date, sentiment,"
            " importance, hash) VALUES (?, ?, ?, 's', ?, 'neutral', 1, ?)",
            (ticker, headline, url, published_date, url),
        )


def test_every_requested_ticker_is_a_key_even_with_no_news(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert("AAPL", "Apple headline", "2026-07-31", "u1")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=AAPL,MSFT").json()["data"]

    assert set(payload["tickers"]) == {"AAPL", "MSFT"}
    assert payload["tickers"]["MSFT"]["articles"] == []


def test_last_checked_at_distinguishes_checked_empty_from_never_checked(tmp_path, monkeypatch):
    """The two states a tile must not conflate: MSFT was checked and had nothing, GOOGL
    was never checked at all. Without this the tile cannot say which."""
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    record_success("news", "MSFT", now=NOW, covered_from=NOW.date(), covered_to=NOW.date())

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=MSFT,GOOGL").json()["data"]

    assert payload["tickers"]["MSFT"]["last_checked_at"] is not None
    assert payload["tickers"]["GOOGL"]["last_checked_at"] is None


def test_articles_are_newest_first_with_undated_last(tmp_path, monkeypatch):
    """An undated article must never displace a dated one from a three-item tile."""
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert("AAPL", "undated", "", "u0")
    _insert("AAPL", "older", "2026-07-28", "u1")
    _insert("AAPL", "newest", "2026-07-31", "u2")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=AAPL&per_ticker=3").json()["data"]

    assert [a["headline"] for a in payload["tickers"]["AAPL"]["articles"]] == [
        "newest", "older", "undated",
    ]


def test_per_ticker_limit_is_applied(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    for day in range(1, 6):
        _insert("AAPL", f"h{day}", f"2026-07-0{day}", f"u{day}")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=AAPL&per_ticker=2").json()["data"]

    assert len(payload["tickers"]["AAPL"]["articles"]) == 2


def test_a_lowercase_ticker_is_normalised(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert("AAPL", "Apple headline", "2026-07-31", "u1")

    client = TestClient(app)
    payload = client.get("/api/v1/news/feed/bulk?tickers=aapl").json()["data"]

    assert payload["tickers"]["AAPL"]["articles"][0]["headline"] == "Apple headline"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_news_bulk_feed.py -q`
Expected: FAIL — 404, the route does not exist.

- [ ] **Step 3: Implement the service method**

Add to `apps/api/services/news_service.py`:

```python
    def get_news_bulk(self, tickers: List[str], per_ticker: int = 3) -> dict:
        """One query per ticker inside one request, plus the acquisition state join.

        Newest first. published_date is TEXT DEFAULT '', so the CASE pins undated rows
        last explicitly rather than relying on '' sorting below any date -- an undated
        article must never displace a dated one from a three-item tile.
        """
        normalized = [str(t).upper().strip() for t in tickers if str(t).strip()]
        out: dict[str, dict] = {}
        with get_db() as conn:
            for ticker in dict.fromkeys(normalized):
                rows = conn.execute(
                    """SELECT * FROM news
                       WHERE ticker = ?
                       ORDER BY CASE WHEN published_date IS NULL OR published_date = ''
                                     THEN 1 ELSE 0 END,
                                published_date DESC,
                                id DESC
                       LIMIT ?""",
                    (ticker, per_ticker),
                ).fetchall()
                state = conn.execute(
                    "SELECT last_checked_at FROM acquisition_state"
                    " WHERE data_class = 'news' AND subject = ?",
                    (ticker,),
                ).fetchone()
                out[ticker] = {
                    "articles": [NewsArticle(**dict(row)) for row in rows],
                    "last_checked_at": state["last_checked_at"] if state else None,
                }
        return out
```

If `NewsArticle(**dict(row))` rejects a column, select the columns explicitly instead of `*`.

- [ ] **Step 4: Add the route**

In `apps/api/routes/news.py`:

```python
class BulkNewsEntry(BaseModel):
    articles: List[NewsArticle]
    last_checked_at: Optional[str] = None


class BulkNewsResponse(BaseModel):
    tickers: Dict[str, BulkNewsEntry]


@router.get("/feed/bulk", response_model=BulkNewsResponse)
async def get_news_feed_bulk(
    tickers: str = Query(..., description="comma-separated tickers"),
    per_ticker: int = Query(default=3, ge=1, le=20),
):
    """One request for the whole tile grid, with acquisition state per ticker."""
    requested = [part for part in tickers.split(",") if part.strip()]
    if not requested:
        raise HTTPException(status_code=400, detail="tickers is required")
    if len(requested) > MAX_ACQUIRE_TICKERS:
        raise HTTPException(status_code=400,
                            detail=f"at most {MAX_ACQUIRE_TICKERS} tickers per request")
    return BulkNewsResponse(tickers=_svc.get_news_bulk(requested, per_ticker=per_ticker))
```

Declare `/feed/bulk` **before** any `/feed/{something}` path route if one exists, or FastAPI may match the wrong one.

- [ ] **Step 5: Run to verify they pass**

Run: `python -m pytest tests/api/test_news_bulk_feed.py -q`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/routes/news.py apps/api/services/news_service.py apps/api/models/schema_parts/news.py tests/api/test_news_bulk_feed.py
git commit -m "feat: bulk news read with acquisition state

Twelve tiles cost one request instead of twelve. Every requested ticker is a
key, so the frontend maps by ticker and never depends on object order.

last_checked_at is joined from acquisition_state, which is what lets a tile
say 'checked at 14:00, nothing found' rather than leaving an empty tile
ambiguous with 'never looked'.

Ordering pins undated articles last explicitly, so one cannot displace a
dated article from a three-item tile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Every requested ticker is a key. ✓ `last_checked_at` separates checked-empty from never-checked. ✓ Newest first, undated last. ✓ `per_ticker` limits.

---

## Task 6: Expose `id` on the watchlist payload

**Files:**
- Modify: `apps/api/models/schema_parts/watchlist.py`, `apps/api/routes/portfolio.py`
- Test: `tests/api/test_watchlist_id.py` (create)

**Interfaces:**
- Produces: `PortfolioStock.id: int` in the `GET /portfolio/watchlist` response.

**Context:** The grid's fallback shows the twelve most recently added stocks, but `watchlist` has no `created_at` — insertion order survives only in `id INTEGER PRIMARY KEY AUTOINCREMENT`. The route already does `SELECT *`, so `id` is present in the row; it is simply dropped by the response model. No migration.

Keep the route's existing `ORDER BY group_name, ticker` — the table view depends on it, and the grid sorts client-side.

- [ ] **Step 1: Write the failing test**

Create `tests/api/test_watchlist_id.py`:

```python
import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from apps.api.main import app
from apps.api.services import db as db_service


def test_watchlist_rows_expose_id_for_recency_ordering(tmp_path, monkeypatch):
    """The grid's no-weights fallback shows the most recently added stocks. watchlist has
    no created_at, so insertion order lives only in the autoincrement id."""
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    with db_service.get_db() as conn:
        for ticker in ("AAPL", "MSFT", "NVDA"):
            conn.execute(
                "INSERT INTO watchlist (ticker, name, sector, group_name, weight)"
                " VALUES (?, ?, '', 'core', 0.0)",
                (ticker, ticker),
            )

    rows = TestClient(app).get("/api/v1/portfolio/watchlist").json()["data"]

    ids = {row["ticker"]: row["id"] for row in rows}
    assert ids["NVDA"] > ids["MSFT"] > ids["AAPL"]
```

Adjust `["data"]` if the watchlist route returns a bare list rather than the `APIResponse` envelope — check `routes/portfolio.py:48` before running.

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest tests/api/test_watchlist_id.py -q`
Expected: FAIL — `KeyError: 'id'`.

- [ ] **Step 3: Add the field**

In `apps/api/models/schema_parts/watchlist.py`, add to `PortfolioStock`:

```python
    # Insertion order. watchlist has no created_at, so this is the only recency signal,
    # and the portfolio grid's no-weights fallback needs it.
    id: int = 0
```

In `apps/api/routes/portfolio.py`, pass `id=int(row["id"])` where `PortfolioStock(...)` is constructed.

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest tests/api/test_watchlist_id.py -q`
Expected: PASS.

- [ ] **Step 5: Run the full backend suite and commit**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`

```bash
git add apps/api/models/schema_parts/watchlist.py apps/api/routes/portfolio.py tests/api/test_watchlist_id.py
git commit -m "feat: expose watchlist row id for recency ordering

The portfolio grid falls back to the most recently added stocks when no
weights are set, but watchlist has no created_at -- insertion order survives
only in its autoincrement id, which SELECT * already returns and the response
model was dropping. No migration.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Watchlist rows carry `id`, ascending with insertion order.

---

## Task 7: `SidePanel` component

**Files:**
- Create: `apps/web/app/portfolio/components/SidePanel.tsx`
- Test: covered by Task 12's Playwright specs.

**Interfaces:**
- Produces: `<SidePanel open title onClose>{children}</SidePanel>`.

**Context:** `apps/web/components/ui/ModalShell.tsx` already implements `Esc` to close, a focus trap, focus restore to the previously focused element, and `aria-modal`. **Read it first and copy its effect structure** rather than reinventing it — the panel differs from a modal only in position and width. Do not modify `ModalShell`; other pages depend on it.

- [ ] **Step 1: Implement the panel**

Create `apps/web/app/portfolio/components/SidePanel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { X } from "lucide-react";

interface SidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function SidePanel({ open, title, onClose, children }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      data-testid="portfolio-side-panel"
      className={clsx(
        "absolute inset-y-0 right-0 z-30 w-full max-w-[480px] overflow-y-auto",
        "border-l border-[var(--border)] bg-[var(--bg-surface)] shadow-lg",
        "focus-visible:outline-none",
      )}
    >
      <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
        <IconButton icon={<X className="h-4 w-4" />} label="Close panel" onClick={onClose} />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
```

The panel is `absolute` because `PortfolioShell` (Task 8) positions it against a `relative` main area — that is what keeps the grid visible behind it rather than replacing the page.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/portfolio/components/SidePanel.tsx
git commit -m "feat: SidePanel slide-over for the portfolio rail

Copies ModalShell's Esc, focus and focus-restore structure rather than
reinventing it; differs only in position and width. Absolute against the
shell's relative main area, so the tile grid stays visible behind an open
panel and the user keeps their place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Renders nothing when closed. ✓ `Esc` closes. ✓ Focus moves in and is restored on close. ✓ `role="dialog"` with `aria-modal`.

---

## Task 8: `PortfolioShell` — grid, rail, panel host

**Files:**
- Create: `apps/web/app/portfolio/components/PortfolioShell.tsx`
- Test: covered by Task 12.

**Interfaces:**
- Consumes: `SidePanel` (Task 7).
- Produces: `<PortfolioShell rail={RailItem[]} panels={Record<string, {title, body}>}>{grid}</PortfolioShell>` where `RailItem = { id: string; icon: ReactNode; label: string }`.

**Context:** This owns the two-column layout and the one-panel-at-a-time state. The tile grid is the only vertically scrolling region: the shell sets `h-[calc(100vh-var(--header-h))]` on itself and `overflow-y-auto` on the main column only. Below `lg` the rail becomes a bottom bar.

- [ ] **Step 1: Implement the shell**

Create `apps/web/app/portfolio/components/PortfolioShell.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { SidePanel } from "./SidePanel";

export interface RailItem {
  id: string;
  icon: ReactNode;
  label: string;
}

interface PortfolioShellProps {
  rail: RailItem[];
  panels: Record<string, { title: string; body: ReactNode }>;
  onRailAction?: (id: string) => boolean; // return true if handled as an action, not a panel
  children: ReactNode;
}

export function PortfolioShell({ rail, panels, onRailAction, children }: PortfolioShellProps) {
  const [openPanel, setOpenPanel] = useState<string | null>(null);
  const active = openPanel ? panels[openPanel] : undefined;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* Main column: the only vertically scrolling region on the page. */}
      <div className="relative flex-1 overflow-y-auto" data-testid="portfolio-scroll-region">
        {children}
        {active ? (
          <SidePanel open title={active.title} onClose={() => setOpenPanel(null)}>
            {active.body}
          </SidePanel>
        ) : null}
      </div>

      <nav
        aria-label="Portfolio sections"
        data-testid="portfolio-rail"
        className={clsx(
          "flex shrink-0 items-center gap-2 border-[var(--border)] bg-[var(--bg-surface)]",
          "border-t p-2 lg:w-14 lg:flex-col lg:items-center lg:border-l lg:border-t-0 lg:py-4",
        )}
      >
        {rail.map((item) => (
          <IconButton
            key={item.id}
            icon={item.icon}
            label={item.label}
            variant={openPanel === item.id ? "outlined" : "ghost"}
            onClick={() => {
              if (onRailAction?.(item.id)) return;
              setOpenPanel((current) => (current === item.id ? null : item.id));
            }}
          />
        ))}
      </nav>
    </div>
  );
}
```

`onRailAction` is what lets the refresh icon run a command instead of opening a panel, without the shell knowing anything about news.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/portfolio/components/PortfolioShell.tsx
git commit -m "feat: PortfolioShell two-column layout with a sticky icon rail

The main column is the only vertically scrolling region, which is what
removes the long scroll rather than shortcutting it. One panel open at a
time; clicking an active icon closes it. Below lg the rail becomes a bottom
bar. onRailAction lets an icon run a command instead of opening a panel, so
the shell needs to know nothing about news.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Exactly one scrolling region. ✓ One panel at a time, toggled by its icon. ✓ Rail is a bottom bar below `lg`.

---

## Task 9: `StockTile`

**Files:**
- Create: `apps/web/app/portfolio/components/StockTile.tsx`
- Test: covered by Task 12.

**Interfaces:**
- Consumes: `PortfolioStock` from `../page` (or wherever it is exported), `BulkNewsEntry` from `@/lib/portfolioNews` (Task 11 creates that module — define the type there and import it; if Task 11 has not run yet, declare the type inline in this file and Task 11 will move it).
- Produces: `<StockTile stock news lastCheckedAt showWeight onOpen />`.

**Context:** The price header is a pure re-render of data already in `PortfolioStock`. Reuse `Sparkline` and `DeltaBadge` from `@/components/ui`. Colour convention in this codebase is **red for a gain, blue for a loss** — see the Watchlist Holdings tooltip in `page.tsx`. `DeltaBadge` already encodes it; do not hand-roll colours.

`showWeight` is false when the grid is in fallback mode, because every fallback stock has `weight = 0` and twelve tiles reading `wt 0.0%` assert something uninformative.

- [ ] **Step 1: Implement the tile**

Create `apps/web/app/portfolio/components/StockTile.tsx`:

```tsx
"use client";

import { Sparkline } from "@/components/ui/Sparkline";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import type { NewsArticle, PortfolioStock } from "../page";

function relativeAge(published: string): string {
  if (!published) return "";
  const then = new Date(published).getTime();
  if (Number.isNaN(then)) return "";
  const hours = Math.floor((Date.now() - then) / 3_600_000);
  if (hours < 1) return "now";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface StockTileProps {
  stock: PortfolioStock;
  news: NewsArticle[];
  lastCheckedAt: string | null;
  showWeight: boolean;
  onOpen: (stock: PortfolioStock) => void;
}

export function StockTile({ stock, news, lastCheckedAt, showWeight, onOpen }: StockTileProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(stock)}
      data-testid={`stock-tile-${stock.ticker}`}
      className="flex flex-col gap-0 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] text-left transition-colors hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)]"
    >
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-bold text-[var(--text-primary)]">{stock.ticker}</span>
          <DeltaBadge value={stock.delta.percent} />
        </div>
        <span className="text-lg tabular-nums text-[var(--text-primary)]">
          {stock.last_close.toLocaleString(undefined, { style: "currency", currency: "USD" })}
        </span>
        <div className="flex items-center justify-between gap-2">
          <Sparkline data={stock.sparkline} />
          {showWeight ? (
            <span className="text-[length:var(--type-helper)] text-[var(--text-muted)]">
              wt {stock.weight.toFixed(1)}%
            </span>
          ) : null}
        </div>
      </div>

      <div className="border-t border-[var(--border)] p-3">
        {news.length === 0 ? (
          <p className="text-[length:var(--type-helper)] text-[var(--text-muted)]">
            {lastCheckedAt
              ? `No recent news · last checked ${new Date(lastCheckedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Never checked for news"}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {news.slice(0, 3).map((article) => (
              <li key={article.url || article.headline} className="flex gap-2 text-[length:var(--type-helper)]">
                <span className="line-clamp-2 flex-1 text-[var(--text-primary)]">{article.headline}</span>
                <span className="shrink-0 text-[var(--text-muted)]">{relativeAge(article.published_date)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </button>
  );
}
```

Check `DeltaBadge`'s and `Sparkline`'s actual prop names before running — adapt the call sites, not the components.

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/portfolio/components/StockTile.tsx
git commit -m "feat: StockTile with price header and headlines

Price header is a pure re-render of PortfolioStock; only the headlines are a
new read. An empty tile distinguishes 'no recent news, last checked HH:MM'
from 'never checked' using the acquisition state from the bulk endpoint,
because otherwise the two are indistinguishable.

The weight line is suppressed in fallback mode rather than printing wt 0.0%
on every tile.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Price header renders from `PortfolioStock` alone. ✓ Up to three headlines with relative age. ✓ Empty state names which of the two cases it is. ✓ Weight hidden when `showWeight` is false.

---

## Task 10: `StockTileGrid` — membership, filter, search

**Files:**
- Create: `apps/web/app/portfolio/components/StockTileGrid.tsx`
- Test: covered by Task 12.

**Interfaces:**
- Consumes: `StockTile` (Task 9).
- Produces: `<StockTileGrid stocks newsByTicker filter onFilterChange search onSearchChange onOpenStock />`, and the exported pure function `selectVisibleStocks(stocks, filter, search)` returning `{ stocks: PortfolioStock[]; isFallback: boolean }`.

**Context:** Membership is the rule most likely to be got wrong, so it lives in one exported pure function that Task 12 tests directly through the UI. The rule:

- If **any** stock has `weight > 0`, the grid shows held stocks only. Fallback is off entirely — never "held plus recent", which would mix two meanings of membership in one grid.
- If **none** does, show the twelve highest `id`s and set `isFallback`.
- Filter `all` shows everything regardless; `sector` groups are out of scope for this task's first cut — implement `held` and `all` only, and leave the dropdown extensible.
- Search filters the already-selected set by ticker or name, case-insensitively.

- [ ] **Step 1: Implement the grid**

Create `apps/web/app/portfolio/components/StockTileGrid.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { StockTile } from "./StockTile";
import type { NewsArticle, PortfolioStock } from "../page";

export const FALLBACK_TILE_COUNT = 12;

export type GridFilter = "held" | "all";

export function selectVisibleStocks(
  stocks: PortfolioStock[],
  filter: GridFilter,
  search: string,
): { stocks: PortfolioStock[]; isFallback: boolean } {
  const held = stocks.filter((stock) => stock.weight > 0);
  const anyHeld = held.length > 0;

  // All-or-nothing: the moment any weight exists the fallback is off entirely. Mixing
  // held and recent would leave the user unable to tell which tiles are holdings.
  let base: PortfolioStock[];
  let isFallback = false;
  if (filter === "all") {
    base = stocks;
  } else if (anyHeld) {
    base = held;
  } else {
    base = [...stocks].sort((a, b) => b.id - a.id).slice(0, FALLBACK_TILE_COUNT);
    isFallback = true;
  }

  const needle = search.trim().toUpperCase();
  const filtered = needle
    ? base.filter(
        (stock) =>
          stock.ticker.toUpperCase().includes(needle) ||
          stock.name.toUpperCase().includes(needle),
      )
    : base;

  return { stocks: filtered, isFallback };
}

interface StockTileGridProps {
  stocks: PortfolioStock[];
  newsByTicker: Record<string, { articles: NewsArticle[]; last_checked_at: string | null }>;
  filter: GridFilter;
  onFilterChange: (filter: GridFilter) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onOpenStock: (stock: PortfolioStock) => void;
}

export function StockTileGrid({
  stocks, newsByTicker, filter, onFilterChange, search, onSearchChange, onOpenStock,
}: StockTileGridProps) {
  const { stocks: visible, isFallback } = useMemo(
    () => selectVisibleStocks(stocks, filter, search),
    [stocks, filter, search],
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-[var(--bg-page)] pb-2">
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.target.value as GridFilter)}
          aria-label="Grid filter"
          data-testid="grid-filter"
          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        >
          <option value="held">Held</option>
          <option value="all">All</option>
        </select>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search ticker or name"
          aria-label="Search stocks"
          data-testid="grid-search"
          className="flex-1 min-w-[12rem] rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-sm"
        />
      </div>

      {isFallback ? (
        <p data-testid="grid-fallback-banner" className="text-[length:var(--type-helper)] text-[var(--text-muted)]">
          No weights set — showing {FALLBACK_TILE_COUNT} most recent. Set allocation weights
          to make this your holdings view.
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState title="No stocks to show" description="Add stocks from the allocation panel, or switch the filter to All." />
      ) : (
        <div
          data-testid="stock-tile-grid"
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
        >
          {visible.map((stock) => (
            <StockTile
              key={stock.ticker}
              stock={stock}
              news={newsByTicker[stock.ticker]?.articles ?? []}
              lastCheckedAt={newsByTicker[stock.ticker]?.last_checked_at ?? null}
              showWeight={!isFallback}
              onOpen={onOpenStock}
            />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/portfolio/components/StockTileGrid.tsx
git commit -m "feat: StockTileGrid with membership rule, filter and search

Membership is one exported pure function because it is the rule most likely
to be got wrong. All-or-nothing: the moment any weight exists the fallback is
off entirely, never held-plus-recent, which would mix two meanings of
membership in one grid.

The fallback states itself in a banner, so an unexpected-looking grid is
never unexplained.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ Held-only when any weight exists. ✓ Twelve highest ids with a banner when none does. ✓ `all` overrides. ✓ Search matches ticker or name.

---

## Task 11: Wire the page — panels, news client, refresh reporting

**Files:**
- Create: `apps/web/lib/portfolioNews.ts`
- Modify: `apps/web/app/portfolio/page.tsx`, `apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx`
- Test: covered by Task 12.

**Interfaces:**
- Consumes: everything from Tasks 5–10.
- Produces: the composed page.

**Context:** This is the largest task and the one most likely to sprawl. Keep to these rules:

- **Do not restructure `page.tsx`'s data layer.** Queries, session caches and request snapshots stay exactly as they are. You are moving JSX into panels and adding two queries.
- **Thread props.** Do not introduce a context; the design chose explicit props.
- The four panel bodies already exist as components. Moving them means passing the props they already receive.

- [ ] **Step 1: Write the news client**

Create `apps/web/lib/portfolioNews.ts`:

```ts
import { fetchApi, buildApiUrl } from "@/lib/api";
import type { NewsArticle } from "@/app/portfolio/page";

export interface BulkNewsEntry {
  articles: NewsArticle[];
  last_checked_at: string | null;
}

export interface BulkNewsResponse {
  tickers: Record<string, BulkNewsEntry>;
}

export interface NewsAcquireResult {
  ticker: string;
  status: "acquired" | "fresh" | "empty" | "failed";
  articles: number;
  detail: string | null;
}

export interface NewsAcquireResponse {
  results: NewsAcquireResult[];
  skipped_unknown: string[];
}

export async function fetchBulkNews(tickers: string[], perTicker = 3) {
  return fetchApi<BulkNewsResponse>("/news/feed/bulk", {
    params: { tickers: tickers.join(","), per_ticker: perTicker },
  });
}

export async function acquireNews(tickers: string[]): Promise<NewsAcquireResponse> {
  const response = await fetch(buildApiUrl("/news/acquire").toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  if (!response.ok) throw new Error(`API error: ${response.status} ${response.statusText}`);
  const json = await response.json();
  return (json.data ?? json) as NewsAcquireResponse;
}

export function summarizeAcquisition(response: NewsAcquireResponse): string {
  const acquired = response.results.filter((r) => r.status === "acquired").length;
  const current = response.results.filter((r) => r.status === "fresh" || r.status === "empty").length;
  const failed = response.results.filter((r) => r.status === "failed");

  const parts = [`${acquired} refreshed`, `${current} already current`];
  if (failed.length > 0) {
    // Name failures rather than counting them anonymously: "3 failed" tells the user
    // nothing they can act on.
    const named = failed.slice(0, 2).map((r) => r.ticker).join(", ");
    const rest = failed.length > 2 ? ` +${failed.length - 2}` : "";
    parts.push(`${failed.length} failed (${named}${rest})`);
  }
  return parts.join(" · ");
}
```

Adapt to `fetchApi`'s actual options shape — read `apps/web/lib/api.ts:140` first.

- [ ] **Step 2: Add the two queries and the refresh mutation to `page.tsx`**

```tsx
  const [gridFilter, setGridFilter] = useState<GridFilter>("held");
  const [gridSearch, setGridSearch] = useState("");
  const [refreshSummary, setRefreshSummary] = useState<string | null>(null);

  const visibleStocks = useMemo(
    () => selectVisibleStocks(stocks, gridFilter, gridSearch).stocks,
    [stocks, gridFilter, gridSearch],
  );
  const visibleTickers = useMemo(
    () => visibleStocks.map((stock) => stock.ticker),
    [visibleStocks],
  );

  const bulkNewsQuery = useQuery({
    queryKey: ["portfolio-news", visibleTickers],
    queryFn: () => fetchBulkNews(visibleTickers),
    enabled: visibleTickers.length > 0,
    refetchOnWindowFocus: false,
  });

  const refreshNews = useMutation({
    // The visible set is captured here, when Refresh is pressed. A filter change while
    // the batch is in flight must not alter what it acquires, or the reported counts
    // would describe a set the user can no longer see.
    mutationFn: () => acquireNews(visibleTickers),
    onSuccess: (response) => {
      setRefreshSummary(summarizeAcquisition(response));
      void queryClient.invalidateQueries({ queryKey: ["portfolio-news"] });
    },
    onError: (error) => {
      setRefreshSummary(error instanceof Error ? error.message : "Refresh failed");
    },
  });
```

Only `["portfolio-news"]` is invalidated. Do not touch watchlist, comparison, attribution, snapshot or history keys — news acquisition changes news rows and acquisition state and nothing else.

- [ ] **Step 3: Compose the shell**

Replace the outer `<div className="space-y-6 ...">` with:

```tsx
  <PortfolioShell
    rail={[
      { id: "snapshot", icon: <Camera className="h-4 w-4" />, label: "Latest snapshot summary" },
      { id: "attribution", icon: <PieChart className="h-4 w-4" />, label: "Attribution" },
      { id: "allocation", icon: <SlidersHorizontal className="h-4 w-4" />, label: "Allocation workspace" },
      { id: "holdings", icon: <TableIcon className="h-4 w-4" />, label: "Holdings table" },
      { id: "refresh-news", icon: <RefreshCw className="h-4 w-4" />, label: "Refresh news for visible stocks" },
    ]}
    onRailAction={(id) => {
      if (id !== "refresh-news") return false;
      if (!refreshNews.isPending) refreshNews.mutate();
      return true;
    }}
    panels={{
      snapshot: { title: "Latest Snapshot Summary", body: <PortfolioSnapshotSummary {...snapshotProps} /> },
      attribution: { title: "Attribution", body: <PortfolioAttributionSummary {...attributionProps} /> },
      allocation: {
        title: "Portfolio Allocation Workspace",
        body: (
          <>
            <PortfolioCommandCenter {...commandCenterProps} />
            <PortfolioAllocationEditor {...allocationProps} />
          </>
        ),
      },
      holdings: { title: "Watchlist Holdings", body: holdingsTableJsx },
    }}
  >
    {refreshSummary ? (
      <p data-testid="news-refresh-summary" className="px-4 pt-3 text-[length:var(--type-helper)] text-[var(--text-muted)]">
        {refreshSummary}
      </p>
    ) : null}
    <StockTileGrid
      stocks={stocks}
      newsByTicker={bulkNewsQuery.data?.tickers ?? {}}
      filter={gridFilter}
      onFilterChange={setGridFilter}
      search={gridSearch}
      onSearchChange={setGridSearch}
      onOpenStock={setSelectedStock}
    />
  </PortfolioShell>
```

`{...snapshotProps}` etc. stand for the props those components already receive at their current call sites — copy them verbatim from the JSX you are moving. `holdingsTableJsx` is the existing Watchlist Holdings `<section>` moved wholesale.

- [ ] **Step 4: Remove the dead stale banner**

In `PortfolioSnapshotSummary.tsx`, delete the `snapshot_is_stale` warning banner (around line 158-162) and any prop that becomes unused as a result. `snapshot_is_stale` is now always `false` from every backend construction site, so the banner can never render. Remove only what your deletion orphans.

- [ ] **Step 5: Typecheck and run the app**

Run: `cd apps/web && npx tsc --noEmit`
Then start the backend with `MONEYVIEW_DEV_MONITOR=true` and the frontend, and confirm by eye: the grid renders, each rail icon opens its panel, `Esc` closes it, and the refresh icon produces a summary line.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/portfolioNews.ts apps/web/app/portfolio/page.tsx apps/web/app/portfolio/components/PortfolioSnapshotSummary.tsx
git commit -m "feat: compose the portfolio page as a tile grid with a panel rail

Sections move into rail-triggered panels; the tile grid becomes the only
scrolling region. The visible ticker set is captured when Refresh is pressed,
so a filter change mid-batch cannot alter what it acquires or make the
reported counts describe a set the user can no longer see.

Only the portfolio-news query key is invalidated on success -- news
acquisition changes news rows and acquisition state and nothing else.

Removes the snapshot_is_stale banner, which has been unreachable since
snapshots became manual-only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ One scrolling region. ✓ Each icon opens its panel; `Esc` closes. ✓ Refresh reports a summary. ✓ Only the news key is invalidated. ✓ `tsc` clean.

---

## Task 12: Playwright specs and mock updates

**Files:**
- Modify: `apps/web/tests/e2e/helpers/portfolioPageMock.ts`, existing portfolio specs
- Create: `apps/web/tests/e2e/portfolio-tile-grid.spec.ts`

**Interfaces:**
- Consumes: everything.

**Context:** The existing specs target the stacked layout and will fail. Read `portfolioPageMock.ts` first: it route-mocks the API so e2e runs offline. Add mocks for `GET /news/feed/bulk` and `POST /news/acquire` in the same style.

Update existing specs by **adjusting selectors only**. If a spec fails for a reason other than the layout move, stop and report it — that is a real regression, not a selector drift.

- [ ] **Step 1: Add route mocks**

In `portfolioPageMock.ts`, alongside the existing handlers:

```ts
await page.route("**/api/v1/news/feed/bulk**", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "ok",
      data: {
        tickers: {
          AAPL: {
            articles: [
              { headline: "Apple headline one", url: "https://x/1", source: "s",
                published_date: "2026-07-31", sentiment: "neutral", importance: 1 },
            ],
            last_checked_at: "2026-07-31T14:00:00Z",
          },
          MSFT: { articles: [], last_checked_at: "2026-07-31T14:00:00Z" },
          GOOGL: { articles: [], last_checked_at: null },
        },
      },
    }),
  });
});

await page.route("**/api/v1/news/acquire", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "ok",
      data: {
        results: [
          { ticker: "AAPL", status: "acquired", articles: 3, detail: null },
          { ticker: "MSFT", status: "fresh", articles: 0, detail: null },
          { ticker: "GOOGL", status: "failed", articles: 0, detail: "provider timeout" },
        ],
        skipped_unknown: [],
      },
    }),
  });
});
```

- [ ] **Step 2: Write the new spec**

Create `apps/web/tests/e2e/portfolio-tile-grid.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { mockPortfolioPage } from "./helpers/portfolioPageMock";

test.beforeEach(async ({ page }) => {
  await mockPortfolioPage(page);
  await page.goto("/portfolio");
});

test("the page has exactly one vertically scrolling region", async ({ page }) => {
  await expect(page.getByTestId("portfolio-scroll-region")).toBeVisible();
  await expect(page.getByTestId("portfolio-scroll-region")).toHaveCount(1);
});

test("a rail icon opens its panel and Escape closes it", async ({ page }) => {
  await page.getByRole("button", { name: "Latest snapshot summary" }).click();
  const panel = page.getByTestId("portfolio-side-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("aria-modal", "true");

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});

test("only one panel is open at a time", async ({ page }) => {
  await page.getByRole("button", { name: "Latest snapshot summary" }).click();
  await page.getByRole("button", { name: "Attribution" }).click();
  await expect(page.getByTestId("portfolio-side-panel")).toHaveCount(1);
});

test("an empty tile says whether it was ever checked", async ({ page }) => {
  await expect(page.getByTestId("stock-tile-MSFT")).toContainText("last checked");
  await expect(page.getByTestId("stock-tile-GOOGL")).toContainText("Never checked");
});

test("refresh reports refreshed, current and named failures", async ({ page }) => {
  await page.getByRole("button", { name: "Refresh news for visible stocks" }).click();
  await expect(page.getByTestId("news-refresh-summary")).toContainText("1 refreshed");
  await expect(page.getByTestId("news-refresh-summary")).toContainText("1 already current");
  await expect(page.getByTestId("news-refresh-summary")).toContainText("GOOGL");
});

test("the fallback banner appears when no weights are set", async ({ page }) => {
  await expect(page.getByTestId("grid-fallback-banner")).toContainText("No weights set");
});

test("search filters the grid", async ({ page }) => {
  await page.getByTestId("grid-search").fill("AAPL");
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible();
  await expect(page.getByTestId("stock-tile-MSFT")).toHaveCount(0);
});
```

The mock's watchlist fixture must have zero weights for the fallback test, and must contain AAPL, MSFT and GOOGL. Adjust the fixture if it does not.

- [ ] **Step 3: Run the e2e suite**

Run: `cd apps/web && npx playwright test`
Expected: the new spec passes; existing portfolio specs pass after selector updates.

- [ ] **Step 4: Run the full backend suite**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 0 failed.

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/e2e/
git commit -m "test: e2e coverage for the tile grid, rail panels and news refresh

Covers the acceptance criteria that are observable in a browser: one
scrolling region, one panel at a time, Escape closes, the empty tile naming
which of checked-empty and never-checked it is, and the refresh summary
naming its failures.

Existing portfolio specs updated for the new layout by selector only.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

**Acceptance:** ✓ New spec passes. ✓ Existing portfolio specs pass. ✓ Backend suite unchanged.

---

## Self-Review

**Spec coverage.** Every design section maps to a task: layout shell → 7, 8; tile → 9; membership incl. fallback and transition → 10; bulk read with acquisition-state join and ordering → 5; `Hourly` and its rationale → 1; source → 2; store → 3; registry, `/news/acquire` contract, validation, batch execution, failure aggregation → 4; watchlist `id` → 6; data flow, refresh snapshot semantics, cache boundary, states, refresh reporting, related cleanup → 11; testing and known e2e breakage → 12.

**Acceptance criteria mapping.** (1) one scrolling region → Task 12 spec; (2) one news request → Task 5 plus Task 11's single query; (3) refresh scoped to visible → Task 11 Step 2 and Task 4's tests; (4) refresh reports outcome → Task 11 `summarizeAcquisition`, Task 12 spec; (5) panels are free → Task 8 renders panel bodies from existing state, no query; (6) empty never ambiguous → Tasks 5, 9, 12; (7) offline-safe → Global Constraints plus every news test injecting a crawler.

**Deliberately not covered by an automated test:** acceptance criterion 5 ("opening a panel performs no fetch") is asserted structurally rather than by a network assertion, because the panel bodies receive already-fetched props. If a reviewer wants it enforced, add a Playwright `page.on("request")` counter around a panel open.

**Type consistency.** `PortfolioStock` gains `id: int` in Task 6 and is consumed in Task 10's sort. `BulkNewsEntry` is defined in Task 11's `portfolioNews.ts` and consumed in Tasks 9 and 10 — Task 9 notes the ordering dependency and how to handle it if executed first. `NewsAcquireResult.status` uses the same four values as `AcquisitionResult.status` throughout. `selectVisibleStocks` has one signature, used in Tasks 10 and 11.

**Known ordering constraint:** Tasks 1–3 must precede 4; 5 and 6 are independent of each other; 7 precedes 8; 9 precedes 10; 11 requires 5, 6, 8, 10; 12 requires 11.
