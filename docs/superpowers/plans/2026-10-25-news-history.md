# News History (Risk ④-a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the daily stock-news sweep, add a cached per-ticker past-date news search, store real publish times and the publisher, and send every Google News request through one pacer that pauses in proportion to the request type and stops on a block.

**Architecture:**
- A new package `apps/api/services/news_feed/` owns all Google News traffic:
  - `rss.py` builds URLs, fetches, classifies the response and parses it.
  - `pacer.py` is a process-wide gate. It sets the gaps, gives interactive requests priority, and owns the block state and the daily cap.
  - `daily.py`, `history.py` and `loop.py` hold the sweep, the past-date search and the background loop.
- Existing callers (`StockNewsCrawler`, `RegulationCrawler`, `/news/acquire`, `sweep_news`) keep their shapes but fetch through `google_news()`.
- The hourly risk cycle stops sending news requests. It queues alert tickers for the news loop.

**Tech Stack:** Python 3.11, FastAPI, SQLite (`apps/api/services/db.py`), pytest. Network-free tests: `tests/conftest.py::_forbid_network` raises `AssertionError` on any socket.

**Spec:** `docs/superpowers/specs/2026-10-25-news-history-design.md` (decisions N-D1 to N-D13). Reference: `docs/architecture/news-crawling-guide.md`.

## Global Constraints

- **Gaps.** Bulk requests wait a random 20–60 s; interactive requests wait a random 3–8 s. Measure the gap from the end of the previous request. Never use a fixed value (N-D12).
- **Bulk vs interactive.**
  - Bulk: the daily stock sweep, the macro/theme sweep, alert-ticker feeds.
  - Interactive: `/news/acquire`, `/news/crawl/stock`, `/news/crawl`, `POST /news/history`.
- **Priority.** An interactive request waiting goes before any bulk request waiting.
- **Daily cap.** 500 requests per UTC day, counted across all kinds (N-D9).
- **Block.** A block is HTTP 429, HTTP 503, or a 200 body containing `automated queries` (case-insensitive). It refuses every request until the next 00:00 UTC. The block state and the day's count survive a restart (stored in `risk_state` through `apps.api.services.risk.store.get_state/set_state`).
- **Placeholder times.** A `pubDate` time of exactly `07:00:00` or `08:00:00` GMT means "time unknown": `published_at` is NULL and only `published_date` is kept.
- **Missing dates.** A missing or unparseable `pubDate` gives `published_date = ""` and `published_at = NULL`. Never today's date.
- **Publisher.** `source` stores the RSS `<source>` text, the publisher. The trailing `" - {publisher}"` is removed from the title (N-D10).
- **Past-date search.**
  - Window: `date-2 .. date+2`, inclusive (N-D6). Per ticker only (N-D4). Every result auto-saved (N-D3).
  - A second identical search sends no request.
  - A request that returns exactly 100 items is recorded `truncated` and not split (N-D11).
- **Freshness.** The news freshness boundary stays hourly. The daily sweep records `acquisition_state` per ticker (N-D13).
- **Test guard.** `AssertionError` (the test network guard) always propagates. It is never classified as a failure or a block.
- **No disguise.** No Selenium, headless browsers or fingerprint spoofing (N-D2).
- **Test rules.** Every new test is mutation-checked (CLAUDE.md §8). Each task's report names the mutation each test was shown to catch.

## Review Focus

1. **A 200 response that is not RSS** (an HTML consent page, a truncated body) must be `failed`, not "ok with 0 items". Otherwise a ticker silently looks newsless. Test: Task 1 `test_html_body_is_failed_not_empty`.
2. **The test network guard inside a fetch** must propagate through `fetch_feed`, the pacer and the sweeps. Test: Task 1 `test_assertion_error_propagates`; Task 2 `test_pacer_lets_assertion_error_through`.
3. **Two threads requesting at once** (a Refresh during the daily sweep) must be serialized, and both must respect their gaps. Test: Task 2 `test_concurrent_requests_are_serialized`.
4. **The UTC day boundary.** The count resets and the block lifts at 00:00 UTC, not at local midnight and not after 24 h. Test: Task 2 `test_block_lifts_at_next_utc_midnight` and `test_count_resets_at_utc_midnight`.
5. **A watchlist ticker with an empty name** must search by ticker alone, not `" AAPL"` or `"None AAPL"`. Test: Task 5 `test_query_without_company_name_uses_ticker`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/services/news_feed/__init__.py` | Package marker; re-exports `google_news`, `NewsBlocked`, `get_pacer` |
| `apps/api/services/news_feed/rss.py` (create) | URL building, HTTP fetch and response classification, RSS parsing, date/title normalization |
| `apps/api/services/news_feed/pacer.py` (create) | Process-wide pacer, block/cap state, `google_news()` entry point |
| `apps/api/services/news_feed/daily.py` (create) | Daily stock sweep and alert-ticker queue |
| `apps/api/services/news_feed/history.py` (create) | Past-date search and the search log |
| `apps/api/services/news_feed/loop.py` (create) | Background news loop (macro/theme sweep, alert queue, daily sweep) |
| `apps/api/services/db.py` (modify) | `news.published_at` column, source/title backfill, `news_history_searches` table |
| `apps/api/models/schema_parts/news.py` (modify) | `NewsArticle.published_at`, history/status response models |
| `apps/api/services/webscrap/DAO/Economic.py` (modify) | `RiskNews.published_at` |
| `apps/api/services/webscrap/Crawler/StockNewsCrawler.py`, `RegulationCrawler.py` (modify) | Fetch through `google_news()` |
| `apps/api/services/acquisition/sources/news.py`, `store.py`, `services/news_service.py` (modify) | Keep all items, carry `published_at`, persist it |
| `apps/api/routes/news.py` (modify) | Drop the 0.4 s pacing; add `POST /history`, `GET /status`, `from`/`to` on `/feed` |
| `apps/api/services/risk/news.py`, `risk/schedule.py` (modify) | Sweep through the pacer; the risk cycle queues alert tickers instead of fetching |
| `apps/api/main.py` (modify) | Start `news_cycle` next to `risk_cycle` |
| `tests/api/news_feed/` (create) | `test_rss.py`, `test_pacer.py`, `test_migration.py`, `test_daily.py`, `test_loop.py`, `test_history.py` |

---

### Task 1: RSS parsing, normalization and response classification

**Files:**
- Create: `apps/api/services/news_feed/__init__.py`, `apps/api/services/news_feed/rss.py`
- Create: `tests/api/news_feed/__init__.py`, `tests/api/news_feed/test_rss.py`
- Create: `tests/fixtures/news/google_rss_sample.xml`. Build it from the shape of a real Google News RSS response, with synthetic titles and 5 items in this order:
  1. a real time;
  2. `07:00:00 GMT`;
  3. `08:00:00 GMT`;
  4. no `pubDate`;
  5. a real time, with no `" - publisher"` suffix on the title.
  
  Keep the `<source url=...>` elements, `<guid>` and the `news.google.com/rss/articles/...` links.
- In the test module: a helper `rss_with_items(n: int) -> bytes` for the 100-item case.

**Interfaces:**
- Produces:
  - `FeedItem` (frozen dataclass): `title: str`, `url: str`, `source: str`, `published_date: str`, `published_at: str | None`, `guid: str`.
  - `FeedResult` (frozen dataclass): `status: Literal["ok", "blocked", "failed"]`, `items: list[FeedItem]`, `detail: str = ""`.
  - `normalize_pub_date(raw: str | None) -> tuple[str, str | None]`. It returns `("YYYY-MM-DD" or "", "YYYY-MM-DDTHH:MM:SSZ" or None)`.
  - `strip_source_suffix(title: str, source: str) -> str`.
  - `parse_feed(xml: bytes) -> list[FeedItem]`. It raises `ValueError` when the body is not RSS with a `<channel>`.
  - `search_url(query: str, lang: Literal["en", "ko"], *, after: date | None = None, before: date | None = None) -> str`.
  - `Opener = Callable[[str], tuple[int, bytes]]` takes the URL and returns `(HTTP status, body)`.
  - `fetch_feed(url: str, *, opener: Opener | None = None) -> FeedResult`. The default opener uses `urllib.request` with `User-Agent: Mozilla/5.0` and a 15 s timeout, and maps `urllib.error.HTTPError` to `(code, body)`.

- [ ] **Step 1: Write the failing tests** in `tests/api/news_feed/test_rss.py`:

```python
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
```

- [ ] **Step 2: Run them and confirm they fail.** Run `python -m pytest tests/api/news_feed/test_rss.py -q`. Expected: an import error, because `apps.api.services.news_feed.rss` does not exist.
- [ ] **Step 3: Implement `rss.py`.**
  - Parse with `xml.etree.ElementTree`.
  - Convert `pubDate` with `email.utils.parsedate_to_datetime(...).astimezone(UTC)`. The placeholder test reads the UTC `HH:MM:SS`.
  - Match the block text with `b"automated queries" in body.lower()`.
  - Fetch errors: `AssertionError` is re-raised; any other exception gives `failed` with `detail=str(error)`.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Mutation check.** Apply each mutation, confirm the named test fails for that reason, then restore:
  - drop the placeholder check;
  - make the missing date return today;
  - classify 503 as `failed`;
  - treat a parse `ValueError` as ok-empty;
  - catch `Exception` including `AssertionError`.
- [ ] **Step 6: Commit** `feat(news): RSS parsing and response classification for Google News`

---

### Task 2: The pacer

**Files:**
- Create: `apps/api/services/news_feed/pacer.py`, `tests/api/news_feed/test_pacer.py`
- Modify: `apps/api/services/news_feed/__init__.py`, to export `google_news`, `NewsBlocked` and `get_pacer`

**Interfaces:**
- Consumes: `fetch_feed`, `search_url`, `FeedResult`, `FeedItem` (Task 1). Also `apps.api.services.risk.store.get_state(key) -> str | None` and `set_state(key, value) -> None`.
- Produces:
  - `Kind = Literal["bulk", "interactive"]`
  - Constants: `BULK_GAP = (20.0, 60.0)`, `INTERACTIVE_GAP = (3.0, 8.0)`, `DAILY_CAP = 500`.
  - `class NewsBlocked(RuntimeError)` with attributes `reason: Literal["blocked", "daily_limit"]` and `retry_after: datetime` (the next 00:00 UTC).
  - `PacerStatus` (dataclass): `blocked_until: str | None`, `blocked_reason: str | None`, `requests_today: int`, `daily_cap: int`.
  - `class Pacer`:
    - `__init__(self, *, fetch: Callable[[str], FeedResult] = fetch_feed, clock: Callable[[], datetime], sleep: Callable[[float], None] = time.sleep, rng: random.Random | None = None)`
    - `request(self, url: str, kind: Kind) -> FeedResult`. It raises `NewsBlocked` before sending when blocked or at the cap, and after receiving a `blocked` result.
    - `status(self) -> PacerStatus`
  - `get_pacer() -> Pacer`: module singleton with the clock `lambda: datetime.now(UTC)`.
  - `google_news(query: str, lang: Literal["en", "ko"], kind: Kind, *, after: date | None = None, before: date | None = None) -> list[FeedItem]`. It returns the items on `ok`, raises `NewsBlocked` on a block or the cap, and raises `RuntimeError(detail)` on `failed`.
- State keys in `risk_state`:
  - `news_blocked_until`: ISO UTC.
  - `news_blocked_reason`: `blocked` or `daily_limit`.
  - `news_requests:{YYYY-MM-DD}`: integer as text.
  - `news_last_request_at`: ISO UTC. The gap after a restart is measured from it.

- [ ] **Step 1: Write the failing tests.**

  Fixture `pacer_env(clock=None, responses=None, fetch=None, cap_already=0)` provides:
  - a fake clock whose `sleep` advances it;
  - `random.Random(7)`;
  - a fake `fetch` that records `(clock(), url)` and returns `responses` in turn (default `FeedResult("ok", [])`);
  - optionally `news_requests:{today}` preset to `cap_already`.

  It returns `(pacer, calls)`, where `calls.times`, `calls.urls` and `calls.clock` are available.

```python
def test_bulk_gaps_are_random_and_within_20_60(pacer_env):
    p, calls = pacer_env()
    for i in range(6):
        p.request(f"u{i}", "bulk")
    gaps = [(b - a).total_seconds() for a, b in zip(calls.times, calls.times[1:])]
    assert all(20 <= g <= 60 for g in gaps) and len({round(g, 3) for g in gaps}) > 1

def test_interactive_gap_is_3_8_even_right_after_bulk(pacer_env):
    p, calls = pacer_env()
    p.request("bulk", "bulk"); p.request("click", "interactive")
    assert 3 <= (calls.times[1] - calls.times[0]).total_seconds() <= 8

def test_first_request_after_restart_waits_from_stored_last_request(pacer_env):
    p, calls = pacer_env(); p.request("a", "bulk")
    p2, calls2 = pacer_env(clock=calls.clock)          # new Pacer, same DB state
    p2.request("b", "interactive")
    assert (calls2.times[0] - calls.times[0]).total_seconds() >= 3

def test_block_stops_every_request_until_next_utc_midnight(pacer_env):
    p, calls = pacer_env(responses=[FeedResult("blocked", [], "429")])
    with pytest.raises(NewsBlocked) as first:
        p.request("a", "bulk")
    assert first.value.reason == "blocked"
    assert first.value.retry_after == next_utc_midnight(calls.clock())
    with pytest.raises(NewsBlocked):
        p.request("b", "interactive")
    assert len(calls.times) == 1

def test_block_lifts_at_next_utc_midnight(pacer_env): ...       # advance the clock past 00:00 UTC; the next request is sent
def test_block_survives_restart(pacer_env): ...                 # a new Pacer on the same state still refuses
def test_daily_cap_counts_all_kinds_and_refuses_at_500(pacer_env):
    p, calls = pacer_env(cap_already=499)
    p.request("a", "interactive")
    with pytest.raises(NewsBlocked) as e:
        p.request("b", "bulk")
    assert e.value.reason == "daily_limit" and len(calls.times) == 1
def test_count_resets_at_utc_midnight(pacer_env): ...
def test_interactive_waiting_goes_before_bulk_waiting(pacer_env): ...
    # fetch for request 1 blocks on a threading.Event; thread A queues a bulk, then thread B an
    # interactive; release; assert calls.urls == ["first", "interactive", "bulk"]
def test_concurrent_requests_are_serialized(pacer_env): ...
    # four threads, interactive; fetch records enter/exit on a real monotonic counter; no overlap
def test_pacer_lets_assertion_error_through(pacer_env):
    def boom(url):
        raise AssertionError("net")
    p, _ = pacer_env(fetch=boom)
    with pytest.raises(AssertionError):
        p.request("a", "bulk")
def test_google_news_raises_runtime_error_on_failed(monkeypatch): ...
```

- [ ] **Step 2: Run them and confirm they fail.** Run `python -m pytest tests/api/news_feed/test_pacer.py -q`. Expected: an import error.
- [ ] **Step 3: Implement `Pacer`.**
  - One `threading.Condition` guards the send.
  - A request waits for its turn. Bulk requests also wait while any interactive request is queued.
  - It sleeps `max(0, rng.uniform(*gap) - elapsed_since(news_last_request_at))`, sends, then updates the day count and `news_last_request_at`.
  - It checks the block and the cap before sleeping and again just before sending.
- [ ] **Step 4: Run them and confirm they pass.**
- [ ] **Step 5: Mutation check:**
  - a fixed gap of 20;
  - the bulk gap for interactive requests;
  - no persistence of `news_blocked_until`;
  - the cap check after the send;
  - no priority;
  - swallowing `AssertionError`.
- [ ] **Step 6: Commit** `feat(news): one Google News pacer with bulk/interactive gaps, block stop and daily cap`

---

### Task 3: Store publish time and publisher; route every caller through the pacer

**Files:**
- Modify: `apps/api/services/db.py`.
  - Add `published_at TEXT` to the `CREATE TABLE news` DDL (line ~429).
  - In the migration block near line 1131, add the column when missing.
  - Run the backfill once: for rows with `source = 'Google News'` whose `headline` contains `' - '`, move the text after the **last** `' - '` into `source` and cut it from `headline`. Guard it with a `risk_state` flag `news_publisher_backfill_done`, so it runs once.
- Modify: `apps/api/models/schema_parts/news.py`: `NewsArticle.published_at: Optional[str] = None`.
- Modify: `apps/api/services/webscrap/DAO/Economic.py`: `RiskNews.published_at: Optional[str] = None` as the last field.
- Modify: `apps/api/services/webscrap/Crawler/StockNewsCrawler.py`.
  - `crawl(self, ticker: str, company_name: str = "", limit: int | None = None, offset: int = 0, lang: str = "en", query: str | None = None, kind: Kind = "interactive") -> list[RiskNews]`
  - The default query is unchanged.
  - It calls `google_news(query, lang, kind)` and maps each `FeedItem` to `RiskNews(source=item.source, title=item.title, url=item.url, date=item.published_date, matched_keywords=[query], published_at=item.published_at)`.
  - It returns `items[offset:]` when `limit is None`, else `items[offset:offset + limit]`.
  - Delete the feedparser and urllib paths and `_normalize_date`.
- Modify: `apps/api/services/webscrap/Crawler/RegulationCrawler.py`: replace the `feedparser.parse(url)` fetch with `google_news(query, "ko", "interactive")`. Its CSV-log behaviour is unchanged.
- Modify: `apps/api/services/acquisition/sources/news.py`.
  - `fetch_news(ticker, company_name="", *, crawler=None, limit: int | None = None, kind: Kind = "interactive") -> list[NewsArticle]` passes `kind` and maps `published_at`.
- Modify: `apps/api/services/acquisition/store.py::save_news` and `apps/api/services/news_service.py::save_article`: insert `published_at`.
  - `crawl_stock_and_save` and `crawl_and_save` map `published_at`, and use `item.source` (no `"Google News"` default).
- Modify: `apps/api/routes/news.py`.
  - Delete `NEWS_CRAWL_DELAY_SECONDS`, `pause_owed` and `time.sleep`.
  - In `acquire_news_batch`, catch `NewsBlocked` around a ticker. Report that ticker and every later one `failed` with `detail=f"blocked until {retry_after.isoformat()}"`, and call the fetcher for none of them.
- Modify: `apps/api/services/risk/news.py::sweep_news(now, *, crawler=None, tickers=(), include_topics: bool = True)`.
  - Drop the `sleep` parameter, the `NEWS_CRAWL_DELAY_SECONDS` import and `FEED_LIMIT`.
  - Crawl with `kind="bulk"` and no limit.
  - `include_topics=False` skips the macro and theme jobs.
  - On `NewsBlocked`: stop, add the remaining labels to `failed`, do not set `news_swept_at`, and return.
- Tests:
  - Rewrite `tests/api/test_news_pacing.py`. Its subject (the 0.4 s delay) is gone. New tests:
    - `test_acquire_uses_interactive_kind`;
    - `test_block_fails_the_rest_without_fetching`;
    - `test_routes_news_has_no_sleep`, which asserts that `"time.sleep"` is not in the `routes/news.py` source.
  - Update `tests/api/acquisition/test_news_source.py`. Delete the four feedparser/urllib tests (lines 69–140), which Task 1 now covers. Add `test_all_items_kept_and_published_at_mapped`.
  - Update `tests/api/risk/test_news.py`:
    - replace `test_sweep_sleeps_between_feeds_only` with `test_sweep_uses_bulk_kind_and_stops_on_block`;
    - make `test_crawler_ko_url` assert on the URL passed to the pacer;
    - add `test_include_topics_false_fetches_tickers_only`.
  - Create `tests/api/news_feed/test_migration.py`:

```python
def test_backfill_moves_publisher_into_source(tmp_db):
    insert_news(headline="Apple up - A - B Times", source="Google News")
    run_migrations()
    row = read_one()
    assert (row["headline"], row["source"], row["published_at"]) == ("Apple up - A", "B Times", None)

def test_backfill_leaves_rows_without_suffix_and_non_google_rows(tmp_db): ...
def test_backfill_runs_once(tmp_db): ...      # a second migration run does not cut "Apple up - A" again

def test_no_module_calls_google_news_directly():
    root = Path(__file__).resolve().parents[3] / "apps" / "api"
    hits = [p.relative_to(root).as_posix() for p in root.rglob("*.py")
            if "news.google.com" in p.read_text(encoding="utf-8") and p.name != "rss.py"]
    assert hits == []
```

- [ ] **Step 1:** Write the new and updated tests above, and run them to confirm they fail.
- [ ] **Step 2:** Implement the modifications listed under **Files**.
- [ ] **Step 3:** Run `python -m pytest tests/api/news_feed tests/api/test_news_pacing.py tests/api/test_news_acquire.py tests/api/acquisition/test_news_source.py tests/api/risk/test_news.py -q`. Expected: all pass.
- [ ] **Step 4: Mutation check:**
  - the backfill cuts at the first `' - '`;
  - drop the once-only flag;
  - `save_news` omits `published_at`;
  - `sweep_news` uses `kind="interactive"`;
  - acquire keeps fetching after `NewsBlocked`;
  - put a `news.google.com` URL back in `StockNewsCrawler`.
- [ ] **Step 5: Commit** `feat(news): keep all items, store publish time and publisher, route every Google request through the pacer`

---

### Task 4: News loop, daily stock sweep and the alert-ticker queue

**Files:**
- Create: `apps/api/services/news_feed/daily.py`, `apps/api/services/news_feed/loop.py`
- Create: `tests/api/news_feed/test_daily.py`, `tests/api/news_feed/test_loop.py`
- Modify: `apps/api/services/risk/schedule.py`.
  - Remove both `sweep_news` calls, `_news_due` and `NEWS_INTERVAL`.
  - For each new alert, call `queue_alert_tickers([c.ticker for c in cards[:DECK_TICKERS]])`.
- Modify: `tests/api/risk/test_schedule.py`. Replace `test_news_skipped_within_12h` and `test_new_alert_triggers_ticker_news` with:
  - `test_risk_cycle_sends_no_news_requests`: patch `google_news` to raise `AssertionError`, and `run_once` completes.
  - `test_new_alert_queues_its_tickers`.
- Modify: `apps/api/main.py`: when startup jobs are enabled, append `asyncio.create_task(news_cycle())` right after `risk_cycle`.

**Interfaces:**
- Consumes:
  - `google_news`, `NewsBlocked` (Task 2);
  - `fetch_news(..., kind=)` and `sweep_news(now, *, crawler=None, tickers=(), include_topics=True)` (Task 3);
  - `acquire_point_in_time`, `save_news`, `news_coverage` (`services/acquisition`);
  - `_queries().ko_names` (`services/risk/news.py`);
  - `routes.news._watchlist_names()`.
- Produces:
  - `US_CLOSE_UTC = time(21, 0)`
  - `session_day(now: datetime) -> date`: `now.date()` if `now.time() >= 21:00`, else the previous day.
  - `DailyReport` (dataclass): `session_day: date`, `done: int`, `remaining: int`, `stopped: Literal["complete", "blocked", "daily_limit"]`.
  - `run_daily_sweep(now: datetime, *, watchlist: Callable[[], list[tuple[str, str]]] | None = None) -> DailyReport`. Watchlist rows are `(ticker, name)`, sorted by ticker. For each ticker not marked `news_daily:{day}:{TICKER}`, in order:
    1. `acquire_point_in_time("news", ticker, now=now, fetcher=lambda s: fetch_news(s, company_name=name, kind="bulk"), saver=save_news, coverage=news_coverage)`.
    2. If the ticker is in `ko_names`, call `google_news(f"{ko_name} 주가", "ko", "bulk")` and save each item with `lang="ko"`.
    3. Mark the ticker done.
    
    Rules:
    - A non-block failure still marks the ticker done (retried tomorrow).
    - `NewsBlocked` stops the sweep, with `stopped` equal to its `reason`.
    - When none remain, set `news_daily_done:{day}` to `"1"`.
    - Per-ticker marks older than 7 days are deleted with `store.delete_states_below`.
  - `daily_due(now: datetime) -> bool`: `news_daily_done:{session_day(now)}` is unset.
  - `queue_alert_tickers(tickers: Sequence[str]) -> None`: merges into the JSON list in state `news_alert_queue`, upper-cased and de-duplicated.
  - `drain_alert_queue(now: datetime) -> None`:
    - reads the queue and drops tickers marked done for `session_day(now)`;
    - calls `sweep_news(now, tickers=rest, include_topics=False)`;
    - then removes from the queue the tickers that were attempted. On a block the rest stay queued.
  - `run_news_once(now: datetime) -> None`, in this order:
    1. the macro/theme `sweep_news(now)` when `news_swept_at` is unset or at least 12 h old (moved from `schedule.py`);
    2. `drain_alert_queue(now)`;
    3. `run_daily_sweep(now)` when `daily_due(now)`.
    
    Each step has its own try/except. `AssertionError` propagates, `NewsBlocked` logs a warning, anything else logs the exception.
  - `async def news_cycle(interval_seconds: float = 300.0) -> None`: shaped like `risk_cycle`, it runs `await asyncio.to_thread(run_news_once, datetime.now(UTC))` and then sleeps.

- [ ] **Step 1: Write the failing tests.** Use a `fake_google` fixture that patches `google_news` and records `(query, lang, kind)`, and a `watchlist3` fixture of `AAA`, `BBB`, `CCC` with names:

```python
def test_session_day_switches_at_21_utc():
    assert session_day(dt("2026-10-26T20:59:00Z")) == date(2026, 10, 25)
    assert session_day(dt("2026-10-26T21:00:00Z")) == date(2026, 10, 26)

def test_daily_sweep_covers_every_ticker_once_and_marks_the_day(fake_google, watchlist3): ...
def test_daily_sweep_resumes_after_interruption(fake_google, watchlist3):
    fake_google.raise_on_call(3, KeyboardInterrupt)        # crash while fetching CCC
    with pytest.raises(KeyboardInterrupt):
        run_daily_sweep(NOW, watchlist=watchlist3)
    fake_google.reset()
    run_daily_sweep(NOW, watchlist=watchlist3)
    assert fake_google.tickers() == ["CCC"]
def test_daily_sweep_stops_on_block_and_leaves_rest(fake_google, watchlist3): ...
def test_daily_sweep_records_acquisition_state(fake_google, watchlist3): ...   # read_state("news", "AAA") is set
def test_korean_feed_only_for_ko_names(fake_google, watchlist3): ...
def test_daily_sweep_uses_bulk_kind(fake_google, watchlist3): ...
def test_daily_due_once_per_session_day(fake_google, watchlist3): ...
def test_alert_queue_skips_tickers_already_swept_today(fake_google): ...
def test_alert_queue_keeps_unattempted_tickers_on_block(fake_google): ...
def test_run_news_once_order_and_isolation(monkeypatch): ...   # a raising step does not stop later ones; AssertionError propagates
```

- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement `daily.py`, `loop.py`, the `schedule.py` change and the `main.py` start.
- [ ] **Step 4:** Run `python -m pytest tests/api/news_feed tests/api/risk -q`. Expected: all pass.
- [ ] **Step 5: Mutation check:**
  - never set the per-ticker mark;
  - set `news_daily_done` before the loop;
  - `kind="interactive"` in the daily sweep;
  - call `fetch_news` directly instead of `acquire_point_in_time`;
  - leave one `sweep_news` call in `schedule.py`;
  - clear the whole alert queue on a block.
- [ ] **Step 6: Commit** `feat(news): background news loop with daily stock sweep; risk cycle queues alert tickers`

---

### Task 5: Past-date search, range reads and status API

**Files:**
- Create: `apps/api/services/news_feed/history.py`, `tests/api/news_feed/test_history.py`
- Modify: `apps/api/services/db.py`. Add the table to the schema DDL:

```sql
CREATE TABLE IF NOT EXISTS news_history_searches (
    ticker      TEXT NOT NULL,
    lang        TEXT NOT NULL,
    start       TEXT NOT NULL,   -- YYYY-MM-DD, inclusive
    end         TEXT NOT NULL,   -- YYYY-MM-DD, inclusive
    searched_at TEXT NOT NULL,   -- ISO UTC
    found       INTEGER NOT NULL,
    truncated   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (ticker, lang, start, end)
);
```

- Modify: `apps/api/models/schema_parts/news.py`. Add:
  - `HistoryStatus = Literal["searched_now", "cached", "blocked", "daily_limit", "failed"]`
  - `NewsHistoryRequest {ticker: str, date: date}`
  - `NewsHistoryLang {lang: str, status: HistoryStatus, found: int, truncated: bool}`
  - `NewsHistoryResponse {ticker: str, start: date, end: date, status: HistoryStatus, retry_after: datetime | None, truncated: bool, searched: list[NewsHistoryLang], articles: list[NewsArticle]}`
  - `NewsDailyStatus {session_day: date | None, done: int, remaining: int, complete: bool}`
  - `NewsStatusResponse {blocked_until: datetime | None, blocked_reason: str | None, requests_today: int, daily_cap: int, daily: NewsDailyStatus}`
- Modify: `apps/api/services/news_service.py::get_news`.
  - Add `from_date: str | None = None` and `to_date: str | None = None`, inclusive on `substr(published_date, 1, 10)`, used with `ticker`.
  - Order: `published_date DESC, published_at DESC NULLS LAST, id DESC`.
  - Map `published_at` into `NewsArticle`.
- Modify: `apps/api/routes/news.py`:
  - `GET /feed` gains query params `from` and `to` (Python names `from_`/`to` with `alias="from"`, pattern `^\d{4}-\d{2}-\d{2}$`).
  - `POST /history` returns `APIResponse[NewsHistoryResponse]`.
  - `GET /status` returns `APIResponse[NewsStatusResponse]`. Its `daily` block comes from the `news_daily:*` and `news_daily_done:*` states for the current `session_day`.

**Interfaces:**
- Consumes: `google_news`, `NewsBlocked`, `get_pacer().status()` (Task 2); `NewsService.save_article` (Task 3); `session_day` (Task 4); `_queries().ko_names`; `routes.news._watchlist_names()`.
- Produces:
  - `history_window(d: date) -> tuple[date, date]`, which returns `(d - 2 days, d + 2 days)`.
  - `search_history(ticker: str, d: date, *, now: datetime, names: Mapping[str, str] | None = None) -> NewsHistoryResponse`.
    - English query: `f"{name} {TICKER}".strip()` with `name` from the watchlist, `""` when absent. A non-empty name gives `"Apple AAPL"`; an empty one gives `"AAPL"`.
    - Korean query: `f"{ko_name} 주가"` only when the ticker is in `ko_names`.
    - Bounds go to `google_news(query, lang, "interactive", after=start - 1 day, before=end + 1 day)`. Both operators are read as exclusive; Task 5 Step 6 confirms this.
    - A language with a row for `(TICKER, lang, start, end)` is `cached` and sends nothing.
    - On success, save every item as a `NewsArticle` with `ticker=TICKER`, `lang`, `topic=""` and `published_at`. Insert the row with `found=len(items)` and `truncated = len(items) == 100`.
    - `NewsBlocked` gives that language `blocked` or `daily_limit` with no row inserted.
    - `RuntimeError` gives `failed` with no row inserted.
    - Overall `status`: `searched_now` if any language searched now, `cached` if every language was cached, otherwise the English language's status.
    - `retry_after` comes from the `NewsBlocked`, else `None`. `truncated` is true if any language was truncated.
    - `articles` is `get_news(ticker=TICKER, from_date=start, to_date=end, limit=500)`.
- Route `POST /api/v1/news/history`:
  - 404 when the ticker is not in the watchlist;
  - 422 for a malformed date (pydantic);
  - synchronous: the pacer wait, normally 3–8 s, happens in the request thread.

- [ ] **Step 1: Write the failing tests:**

```python
def test_window_is_five_days_inclusive():
    assert history_window(date(2016, 1, 27)) == (date(2016, 1, 25), date(2016, 1, 29))

def test_first_search_requests_once_per_language_and_saves_everything(fake_google): ...
    # names={"AAPL": "Apple"}, AAPL in ko_names as "애플"
    # google called with ("Apple AAPL", "en", "interactive", after=2016-01-24, before=2016-01-30)
    # and ("애플 주가", "ko", ...); every returned item stored with ticker AAPL, its lang and published_at
def test_second_identical_search_sends_nothing(fake_google): ...
def test_hundred_items_marks_truncated(fake_google): ...
def test_blocked_returns_retry_after_and_records_no_row(fake_google): ...
def test_failed_search_can_run_again(fake_google): ...
def test_query_without_company_name_uses_ticker(fake_google):
    search_history("XYZ", date(2020, 3, 2), now=NOW, names={"XYZ": ""})
    assert fake_google.queries()[0] == "XYZ"
def test_response_includes_previously_stored_articles_in_window(fake_google): ...

def test_feed_range_filters_and_orders_nulls_last(client): ...
def test_status_reports_block_count_and_daily_progress(client): ...
def test_history_route_404_for_unknown_ticker(client): ...
```

- [ ] **Step 2:** Run them and confirm they fail.
- [ ] **Step 3:** Implement the table, `history.py`, the `get_news` range and ordering, the models and the three routes.
- [ ] **Step 4:** Run `python -m pytest tests/api/news_feed tests/api/test_news_acquire.py tests/api/test_news_pacing.py -q`. Expected: all pass.
- [ ] **Step 5: Mutation check:**
  - window ±1;
  - insert the row on `NewsBlocked`;
  - no cache lookup;
  - `truncated = len(items) > 100`;
  - `NULLS FIRST`;
  - drop `.strip()` from the query.
- [ ] **Step 6: Live boundary check (manual, not a test).**
  - With the API running, send one `POST /api/v1/news/history` for `{"ticker": "AAPL", "date": "2016-01-27"}`.
  - Confirm the English articles' `published_date` values fall in 2016-01-25..29.
  - If the window is off by a day, flip the bound adjustment and re-run once, at least 20 s later. At most 2 live requests.
  - Record the result in `docs/architecture/news-crawling-guide.md` §2.
- [ ] **Step 7: Commit** `feat(news): past-date news search with cache, feed date range and pacer status`

---

### Task 6: Records and gates

**Files:**
- Modify: `ERROR-LOG.md`. Add three entries at the top, in the file's template:
  1. A missing `pubDate` was saved as today's date (`StockNewsCrawler._normalize_date`).
  2. The publish time was discarded, and the publisher was hidden behind `source = "Google News"`.
  3. Stock news stopped after 2026-09-29.
     - Confirm the cause first: check `acquisition_state` rows for `news` and the git history of `routes/news.py` and `risk/schedule.py`.
     - Write the confirmed cause, not the spec's guess.
- Modify: `docs/architecture/news-crawling-guide.md`:
  - replace the "당시 코드의 낭비" and "당시 코드의 결함" paragraphs with what the code now does;
  - keep the measured facts.
- Modify: `docs/architecture/database-relationships.md`: `news.published_at`, the backfill rule and `news_history_searches`.
- Modify: `docs/architecture/moneyview-api-reference.md`: `POST /api/v1/news/history`, `GET /api/v1/news/status`, `from`/`to` on `/feed`, `published_at` on `NewsArticle`, and `/news/acquire` now 3–8 s per fetched ticker.
- Modify: `guideline/sop/todo.md` Track R: `R-④-a` done with a pointer to the spec and plan; `R-④` (screen, now ④-b) stays open.

- [ ] **Step 1:** Write the records above.
- [ ] **Step 2: Full backend gate.** Run `python -m pytest -q`. Expected: everything passes except the known environment baseline of 18 failures. Compare the failing test names with that baseline and report any new name.
- [ ] **Step 3: Frontend contract check.** Run `cd apps/web && npx playwright test tests/e2e/portfolio-news-failure-honesty.spec.ts tests/e2e/portfolio-tile-grid.spec.ts --reporter=line`. Expected: pass.
- [ ] **Step 4: Commit** `docs(news): records for the news history work`
