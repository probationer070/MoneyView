# Hermetic Test Suite — Design

Date: 2026-07-28
Status: draft, pending review
Scope: `tests/api` (273 tests), plus two production files the failures implicate
Predecessor: `docs/superpowers/specs/2026-07-27-data-acquisition-design.md` (sub-project 2)

---

## 1. Problem

`python -m pytest tests/api -q` reports **6 failed / 267 passed**. The figure has been
carried forward as a known baseline across several branches without being diagnosed, and
two of the six trade places depending on execution order, so the baseline is not even
stable — `test_perf_capture` and `test_dev_monitor_foundation` each pass when the other
fails.

The six observed failures reduce to three independent root causes. Only one reflects
incorrect production behavior; the remaining failures stem from non-hermetic test
infrastructure — tests that measure the machine they run on rather than the code they
name.

| # | Test | Root cause |
| --- | --- | --- |
| 1 | `test_corporate_companies_registry.py::test_corporate_companies_includes_all_stock_targets_json_entries` | A (dead path) |
| 2-4 | `test_stock_price_lookup.py` — `..._returns_fetching_on_cold_miss`, `..._returns_stale_cache_and_schedules_refresh`, `..._returns_not_found_after_failed_background_refresh` | A (dead path) |
| 5 | `test_perf_analysis.py::test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` | B (product defect) |
| 6 | `test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events` | C (shared database) |
| 6' | `test_perf_capture.py::test_middleware_terminal_event_carries_closes_span_id_and_bytes` | D (lifespan leakage) |

Failure 6 and 6' are one slot in the count because they alternate. Resolving C and D
independently is what makes the count stable rather than merely smaller.

A full-suite probe under database isolation (Section 7) surfaced a seventh and eighth
latent failure that the shared database had been masking. They are in scope: they are the
same defect class, revealed rather than introduced.

---

## 2. Design invariants

These four statements summarize the whole proposal. Each is checkable against the diff.

1. **Test execution becomes hermetic.** After this change no test in `tests/api` reads or
   writes `data/processed/moneyview.db`, and no test makes a network call.
2. **Every test owns its database instance**, unless it explicitly opts out via the
   `virgin_db` marker — and an opt-out changes only whether the schema is created, never
   whether the path is isolated.
3. **Public APIs are unchanged.** No function signature, route, response model, or
   database schema is modified.
4. **Production behavior changes in exactly two places, both intentional and both
   named.** Workstream B changes it deliberately — a deep span tree currently raises
   `RecursionError` and will instead truncate, which is the behavior the test always
   specified. Workstream D adds a startup gate that is inert unless
   `MONEYVIEW_DISABLE_STARTUP_JOBS` is set, so default production startup is byte-for-byte
   the same. Every other workstream is test-only.

Invariant 4 is stated this way rather than as a blanket "production behavior is unchanged"
because the blanket version would be false, and a reviewer trusting it would skip the two
diffs that most deserve reading.

---

## 3. Out of scope

This design intentionally does **not**:

- redesign the database layer or its access patterns;
- change default production startup behavior (the gate is opt-in; see invariant 4);
- add cooperative cancellation to `prewarm_configured_tickers()` — see Section 8 for why
  the surviving thread is documented rather than fixed;
- optimize application runtime outside the test environment;
- rewrite unrelated flaky tests, or refactor the tests being repaired beyond the lines
  causing the failure;
- address the six pre-existing failures' *history* — why they were allowed to persist is a
  process question, not a design one.

---

## 4. Non-goals

This design focuses on deterministic and isolated testing. It is not intended as a
performance optimization of the application itself, although shorter test execution is an
expected side effect: the probe measured wall-clock falling from 403s to 205s purely
because tests stopped touching the real database and the network. That number describes
the suite, not the product, and must not be cited as an application speedup.

---

## 5. Workstream A — machine-specific temporary path

### Problem

Four tests across two files construct a temporary directory under a hardcoded absolute
path on a drive that does not exist on this machine:

```python
# tests/api/test_corporate_companies_registry.py:15
# tests/api/test_stock_price_lookup.py:51
temp_root = Path(r"E:\MoneyView\data\processed")
temp_root.mkdir(parents=True, exist_ok=True)
```

The repository is at `C:\Learn\Economy\MoneyView`. `mkdir(parents=True)` walks up to `E:\`
and raises `FileNotFoundError: [WinError 3]` before either test reaches a single
assertion. Whatever these four tests were written to verify has been unverified since the
workspace moved drives.

Both files already `import tempfile` and call `tempfile._get_candidate_names()` — a
private CPython API with no stability guarantee — solely to generate unique filenames
beneath that fixed root.

### Evidence

Both files were repointed at a valid temporary directory and executed: **9 passed**. The
assertions are sound; only the root was wrong. This is a dead path, not a broken test.

### Design

Replace the hardcoded root with pytest's `tmp_path` fixture and delete the
`_workspace_temp_path` / `_db_path` helpers along with the `tempfile` import they exist to
serve.

`tmp_path` is preferred over any hand-rolled equivalent because it provides automatic
lifecycle management (pytest creates and reaps the directory, retaining only the last few
runs), cross-platform path construction, and per-test isolation by construction — which
together make the custom temporary-directory logic unnecessary rather than merely
relocatable.

### Verification

The tests become platform-independent and require no filesystem setup or pre-existing
drive.

### Acceptance

✓ All four tests pass on any machine, with no `E:\MoneyView` present.
✓ No reference to `_get_candidate_names` or any hardcoded absolute path remains in
`tests/`.

---

## 6. Workstream B — recursive span-tree construction

### Problem

`apps/api/services/perf_analysis.py:335`, `_to_node`, recurses once per level of the span
tree:

```python
children=[_to_node(child) for child in span.children],
```

`test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` builds a deep, narrow
chain to exercise the subtree-collapse fallback. The recursion exhausts the interpreter
stack at roughly 478 levels and raises `RecursionError` before the truncation logic under
test is ever reached.

This is the one **product defect** among the six. A deep span tree crashes `/dev/perf`
analysis instead of truncating it — precisely the outcome the test was written to prevent.
The test is correct and the current implementation cannot satisfy it at any input depth
near the limit.

### Evidence

Isolated run of the single test reproduces `RecursionError: maximum recursion depth
exceeded` at `perf_analysis.py:335`, with the failing span reported as `c0-478` — the
478th link of the chain, well short of any tree a truncation test should be unable to
handle.

### Design

Convert `_to_node` to an explicit-stack iterative walk: materialize nodes bottom-up into a
map keyed by span id, then attach each node's children as its parent is constructed. Tree
depth becomes heap-bound rather than stack-bound. The function signature, its return type,
and every caller are unchanged.

An explicit stack is chosen over raising `sys.setrecursionlimit()` because increasing the
recursion limit only postpones the failure and couples correctness to interpreter
configuration — and past a certain limit CPython segfaults instead of raising, converting
a catchable exception into a hard process crash. Capping depth at ingest was also
considered and rejected: it discards observability data to work around a rendering
constraint, and the analyzer is the layer that already owns truncation.

Child ordering is preserved exactly (see the risk table, Section 10) — the iterative form
must append children in the same sequence the recursive comprehension produced, or
waterfall output shifts for every consumer.

This defect gets an `ERROR-LOG.md` entry per CLAUDE.md §7: it is a confirmed defect that
produced incorrect behavior.

### Verification

The existing test passes without modification. A supplementary test asserts a chain deeper
than the former recursion ceiling produces a correctly-shaped tree.

### Acceptance

✓ Deep span trees no longer raise `RecursionError`; they truncate as specified.
✓ Waterfall child ordering is byte-identical to the pre-change output for existing
fixtures.

---

## 7. Workstream C — suite-wide database isolation

### Problem

`test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events` clears
the in-memory `MarketDataService._provider_fetch_cache` but never isolates the database.
`_get_stock_ohlcv_with_metadata("AAPL", period="1mo")` therefore reads the real
`data/processed/moneyview.db`, finds fresh rows, and correctly reports `source='cache'`
while the test asserts `source in {"live_fetch", "live_refresh"}`.

The test does not encode a wrong expectation — it encodes an unstated precondition (an
empty cache for AAPL) that nothing establishes. It passes only on a machine whose database
happens to lack fresh AAPL bars.

### Evidence

The real database holds **1,307 AAPL rows spanning 2021-04-09 to 2026-07-27**. Under the
probe fixture described below, this test **passes**.

The same probe run across all 273 tests surfaced two further dependents that the shared
database had been masking:

- `test_corporate_comparison.py::test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables`
  fails with `sqlite3.OperationalError: table corporate_comparison_snapshots already
  exists`. It deliberately creates a legacy-shaped table and then calls `init_db()` to
  prove the migration adds the new columns — so it needs an isolated path but an *empty*
  schema.
- `test_perf_capture.py::test_request_waterfall_has_exactly_one_root` fails for the
  Workstream D reason, not this one; it is listed here only because the probe is where it
  appeared.

### Design

Add an autouse fixture to `tests/conftest.py`, alongside the existing rate-limiter reset:

```python
@pytest.fixture(autouse=True)
def _isolated_db(request, tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    if "virgin_db" not in request.keywords:
        db_service.init_db()
```

`_DB_PATH` is a module-level attribute read at call time by `get_db()` and `init_db()`, so
`monkeypatch.setattr` on the module is the correct seam and unwinds automatically.

The `virgin_db` marker is the narrow escape hatch the probe proved necessary. A marked
test still receives an isolated path — only schema creation is skipped. The marker is
registered in the pytest configuration so it does not emit an unknown-marker warning.

Tests that already monkeypatch `_DB_PATH` themselves — every test under
`tests/api/acquisition` — continue to work unchanged: their `setattr` runs after this
fixture and wins. The redundancy is harmless and deliberate; those tests keep documenting
their own requirement rather than inheriting it silently.

### Rollback

Removing the autouse fixture restores the previous shared-database behavior. No production
code depends on it, and the `virgin_db` marker becomes inert rather than erroneous.

### Verification

Every test receives a fresh SQLite file under its own `tmp_path`. The real
`data/processed/moneyview.db` is untouched by a suite run — checkable by comparing its
mtime across a run.

### Acceptance

✓ Each test receives an isolated SQLite database.
✓ `data/processed/moneyview.db` mtime is unchanged after a full suite run.
✓ `test_market_data_emits_cache_and_provider_events` passes deterministically, in any
order.

---

## 8. Workstream D — lifespan startup jobs leaking into tests

### Problem

`test_perf_capture.py` is the only file that uses `with TestClient(app)`, the form that
runs the FastAPI lifespan. `lifespan` (`apps/api/main.py:106`) creates three background
tasks, two of which do real work against the network and the database:
`corporate_snapshot_cycle` and `stock_prewarm_cycle`.

`stock_prewarm_cycle` calls `asyncio.to_thread(MarketDataService().prewarm_configured_tickers)`.
On exit, `task_stock_prewarm.cancel()` cancels the *asyncio task*, but the threadpool
worker it dispatched cannot be cancelled and continues running — fetching live data and
emitting dev-monitor events into whatever sink is current at that moment.

Two tests read the shared sink through a fixed window and select events positionally:

```python
events = sink.recent(limit=500)
start = next(event for event in events if event.operation == "api.request_start")
```

Once leftover prewarm threads from an earlier test in the same file flood that window, the
events under test are evicted and `next()` raises. Whether that happens depends on network
latency and on how warm the cache was — hence the order sensitivity, and hence why this
test and the Workstream C test appear to trade places.

### Evidence

`test_middleware_terminal_event_carries_closes_span_id_and_bytes` passes in isolation and
in a two-file run, and fails in the full suite. `test_request_waterfall_has_exactly_one_root`
fails under the isolation probe, where an empty database changes prewarm timing. Both read
the sink through `recent(limit=N)`; both run after other lifespan-entering tests in the
same file.

### Design

`lifespan` reads `MONEYVIEW_DISABLE_STARTUP_JOBS` **at call time** — not at import — and
skips `corporate_snapshot_cycle` and `stock_prewarm_cycle` when it is set. `wal_flush_cycle`
is unaffected: it touches only the local database and is cheap.

`tests/conftest.py` sets the variable for the whole session. Cutting the jobs at the source
fixes both tests, removes the suite's remaining live network calls, and provides a genuine
operational switch for running the API without startup warming.

The shutdown path additionally gains `await asyncio.gather(*tasks, return_exceptions=True)`
after the cancels, so shutdown does not return while cancellation is still propagating.

**Documented limitation, not a fix:** an in-flight `asyncio.to_thread` worker cannot be
forcibly terminated — this is a CPython constraint, not a defect in this codebase. After
this change the thread can still outlive the application in production when startup jobs
are enabled. A real fix requires a cooperative stop flag checked between tickers inside
`prewarm_configured_tickers()`, which is out of scope (Section 3). This limitation is
recorded here so the next reader does not mistake the gate for a solution to it.

### Verification

No dev-monitor event produced by a background job appears during a test run, and no test
performs an outbound HTTP request.

### Acceptance

✓ Startup background jobs never execute during pytest.
✓ Both `test_perf_capture` failures pass in the full suite and in isolation.
✓ The default (unset) startup path is unchanged.

---

## 9. Success criteria

- `python -m pytest tests/api -q` reports **0 failed**.
- The run is repeated **three times consecutively**, all green. A single green run does not
  close this work: two of these failures alternate by execution order, so one green run is
  consistent with having merely reshuffled them.
- Order dependence is attacked directly rather than by randomization (`pytest-randomly` is
  not a dependency of this project and adding one is out of scope). Two checks:
  **(a)** the full suite is run once with test files passed in reverse order on the command
  line, which pytest honors; **(b)** each of the four tests that were order-sensitive —
  both `test_perf_capture` failures, the `test_dev_monitor_foundation` failure, and the
  `test_corporate_comparison` failure the probe surfaced — is run in isolation *and* in the
  full suite, and must pass in both.
- No test reads or writes `data/processed/moneyview.db`.
- No test makes a network call.
- The Workstream B defect has an `ERROR-LOG.md` entry.
- `guideline/sop/todo.md` records the resolved baseline, so "6 known failures" stops being
  inherited by the next branch.

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Database isolation breaks tests with hidden dependencies on real data | A full-suite probe across all 273 tests already ran and identified every dependent: two, both designed for in Sections 7 and 8. A third would receive real isolation, never a marker used to dodge the problem. |
| The `virgin_db` marker becomes a general-purpose escape hatch | It skips schema creation only, never path isolation, so it cannot reintroduce shared state. Its single use is documented in Section 7; any second use requires justification at review. |
| The startup gate masks a production startup bug | The gate is enabled only under pytest; the default path is unchanged and still exercised by running the application. It suppresses no assertion — it removes non-determinism the tests never intended to measure. |
| Iterative traversal changes waterfall child ordering | Children are appended in the same sequence the recursive comprehension produced. Existing waterfall fixtures are asserted byte-identical before and after. |
| The surviving prewarm thread is mistaken for fixed | Recorded explicitly as a limitation in Section 8 and excluded in Section 3, with the real fix named. |
| Repairing four long-dead tests reveals genuine product bugs | Already checked: all four pass once the path is valid (Section 5 evidence). No product change is implied by Workstream A. |
