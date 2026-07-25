# Error Log

Purpose: capture notable or recurring build, lint, test, and runtime failures so the same issue is not rediscovered from scratch.

Use this file when `guideline/sop/build-error-resolver.md` calls for a concise error record.

Template:

```text
Date:
Command:
Failure:
Root cause:
Fix:
Files changed:
Prevention:
```

## 2026-07-26: Full API suite fails intermittently with unrelated 429s

Date: 2026-07-26
Command: `python -m pytest tests/api -q`
Failure: Full-suite runs intermittently reported 3-5 failed instead of the documented
baseline of 1 failed (only `test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events`
is a known pre-existing failure). The extra failures landed on tests with no
relationship to the change under test -- e.g. `test_portfolio_attribution.py::test_post_report_export_returns_backend_static_content`
and `test_watchlist_resync.py::test_portfolio_preferences_round_trip_total_investment_amount` --
and both passed reliably when run in isolation. The failures themselves were plain
`AssertionError`s on status code (expected 200, got 429), with no log line in the
failing test's own output pointing at rate limiting; the only signal was a
`Global rate limit exceeded for testclient` warning emitted earlier in the same
session, from an unrelated test file.
Root cause: `apps/api/core/middleware.py:75` creates one process-wide
`limiter = RateLimiter(rate=10, capacity=50)` singleton, keyed by client IP.
Every `TestClient` instance in the whole pytest process reports the same IP
(`"testclient"`), so the token bucket is shared and never reset across tests
or files. `tests/conftest.py` had no fixture to reset it. Any test file that
adds enough real HTTP traffic (via `TestClient`) can deplete the shared budget
enough that later, unrelated tests intermittently get 429s instead of 200s --
timing-sensitive (token refill is wall-clock based), so the exact failing set
varied run to run. Route-specific "strict" sub-limiters
(`middleware.py:94-96`, attached lazily as `strict_<client_ip>_<path>` attributes
on the same `limiter` object) are separate `RateLimiter` instances with their
own `clients` dicts and needed clearing too.
Fix: Added an autouse `_reset_rate_limiter` fixture in `tests/conftest.py` that
clears `middleware.limiter.clients` and deletes every `strict_*` attribute on
`limiter` before and after each test. Test-only; `apps/api/core/middleware.py`
(the production rate limiter) was not changed.
Files changed: `tests/conftest.py`
Prevention: Any new test file that exercises HTTP endpoints through `TestClient`
now gets isolated rate-limiter state automatically (autouse, no per-file opt-in
needed). If a future middleware introduces another process-wide singleton keyed
by a fixed test identity (e.g. IP, session id), add a similar reset fixture
rather than working around symptoms by reducing request counts in individual
test files.
