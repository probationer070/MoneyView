# Hermetic Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take `pytest tests/api` from 6 inherited failures to 0, by repairing four tests that have never executed, fixing the one genuine product defect among them, and making every test own its own database and stop making network calls.

**Architecture:** Four independent workstreams, executed in dependency order. A and B touch only the tests and the module they name. C adds one autouse fixture to `tests/conftest.py` that isolates the database for all 273 tests, with a `virgin_db` marker for the single test that needs an empty schema. D gates the lifespan's network-bound startup jobs behind an environment variable that `conftest.py` sets for the session. C must land before D, because D's two tests are only diagnosable once the database is isolated.

**Tech Stack:** Python 3.11.5, pytest 7.4.0 (no `pytest-randomly`, no `pytest-xdist`), FastAPI + Starlette `TestClient`, SQLite via `apps/api/services/db.py`, pydantic v2 models.

**Spec:** `docs/superpowers/specs/2026-07-28-test-suite-failures-design.md`

## Global Constraints

- **No test may make a network call.** This is the rule that Workstream D exists to enforce; do not weaken it to make a test pass.
- **No test may read or write `data/processed/moneyview.db`.** That file holds the developer's real data (142 tickers, 1,307 AAPL rows).
- **Public APIs are unchanged.** No function signature, route, response model, or database schema changes anywhere in this plan.
- **Production behavior changes in exactly two places:** the four walkers in `apps/api/services/perf_analysis.py` (Tasks 2 and 3) and the startup gate in `apps/api/main.py` (Task 6). Nothing else may touch `apps/`.
- **Match surrounding style.** This codebase writes long explanatory docstrings on non-obvious code and uses `# noqa: BLE001` with a trailing reason on deliberate broad excepts. Follow it.
- **Do not "improve" adjacent code.** Every changed line traces to this plan.
- Confirmed defects get an `ERROR-LOG.md` entry (CLAUDE.md §7). Task 3 carries the only one.
- Run tests with `python -m pytest` (not bare `pytest`) — this environment resolves them differently.

---

## File Structure

| File | Change | Responsibility after this plan |
| --- | --- | --- |
| `tests/api/test_corporate_companies_registry.py` | Modify | Task 1 — uses `tmp_path`, no hardcoded root |
| `tests/api/test_stock_price_lookup.py` | Modify | Task 1 — uses `tmp_path`, no hardcoded root |
| `apps/api/services/perf_analysis.py` | Modify | Tasks 2, 3 — four walkers become iterative |
| `tests/api/test_perf_analysis.py` | Modify | Tasks 2, 3 — gains the depth-2000 regression test |
| `tests/conftest.py` | Modify | Tasks 4, 6 — database isolation fixture, `virgin_db` marker, startup-job env var |
| `pyproject.toml` | Modify | Task 4 — registers the `virgin_db` marker |
| `tests/api/test_corporate_comparison.py` | Modify | Task 5 — one test gains `@pytest.mark.virgin_db` |
| `apps/api/main.py` | Modify | Task 6 — startup gate, awaited shutdown |
| `ERROR-LOG.md` | Append | Task 3 — the recursion defect |
| `guideline/sop/todo.md` | Modify | Task 7 — records the resolved baseline |

---

## Task 1: Replace the hardcoded `E:\MoneyView` temp root

**Files:**
- Modify: `tests/api/test_corporate_companies_registry.py:14-17` (helper), `:26-27` (call sites)
- Modify: `tests/api/test_stock_price_lookup.py:50-53` (helper), `:57`, `:80`, `:108` (call sites)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing later tasks rely on. Fully self-contained.

**Context you need:** These four tests have never run to completion on this machine. Both files build a temp directory under `Path(r"E:\MoneyView\data\processed")`; there is no `E:` drive, so `mkdir(parents=True)` walks up to `E:\` and raises `FileNotFoundError: [WinError 3]` before any assertion executes. The assertions themselves are correct — this has already been verified by pointing both files at a real temp directory and running them (9 passed). Do not change any assertion.

- [ ] **Step 1: Confirm the failure is what the plan says it is**

Run: `python -m pytest tests/api/test_corporate_companies_registry.py tests/api/test_stock_price_lookup.py -q`

Expected: 4 failed, 5 passed. Each failure ends in `FileNotFoundError: [WinError 3]` with `'E:\\'` in the message. If you see any other error, stop and report — the plan's premise is wrong.

- [ ] **Step 2: Fix `test_corporate_companies_registry.py`**

Delete the `_workspace_temp_path` helper and the now-unused `import tempfile`:

```python
def _workspace_temp_path(name: str) -> Path:
    temp_root = Path(r"E:\MoneyView\data\processed")
    temp_root.mkdir(parents=True, exist_ok=True)
    return temp_root / f"{name}-{next(tempfile._get_candidate_names())}"
```

Change the test signature to request `tmp_path`, and build both paths from it:

```python
def test_corporate_companies_includes_all_stock_targets_json_entries(monkeypatch, tmp_path):
    db_path = tmp_path / "companies-registry.db"
    json_path = tmp_path / "stock-targets.json"
```

`tmp_path` is a `pathlib.Path` that pytest creates per-test and reaps automatically, so the uniqueness suffix `_get_candidate_names()` provided is no longer needed. Leave `_write_watchlist_json` alone — it already calls `path.parent.mkdir(parents=True, exist_ok=True)`.

- [ ] **Step 3: Fix `test_stock_price_lookup.py`**

Delete the `_db_path` helper and the now-unused `import tempfile`:

```python
def _db_path() -> Path:
    temp_root = Path(r"E:\MoneyView\data\processed")
    temp_root.mkdir(parents=True, exist_ok=True)
    return temp_root / f"test-stock-price-{next(tempfile._get_candidate_names())}.db"
```

Add `tmp_path` to the signature of each of the three tests and replace the call. All three currently begin with the identical two lines:

```python
def test_get_stock_price_lookup_returns_fetching_on_cold_miss(monkeypatch, tmp_path):
    db_path = tmp_path / "moneyview.db"
    monkeypatch.setattr(db_service, "_DB_PATH", db_path)
```

Apply the same change at `:57`, `:80` and `:108`. Keep the existing `monkeypatch.setattr(db_service, "_DB_PATH", db_path)` and `db_service.init_db()` lines exactly as they are — Task 4 makes them redundant but they stay as local documentation of the requirement.

Check whether `Path` is still used elsewhere in each file before removing its import; in `test_stock_price_lookup.py` it is used at module level for `sys.path.insert`, so keep it there.

- [ ] **Step 4: Run the tests**

Run: `python -m pytest tests/api/test_corporate_companies_registry.py tests/api/test_stock_price_lookup.py -q`

Expected: **9 passed**.

- [ ] **Step 5: Confirm nothing was left behind**

Run: `python -m pytest tests/api -q -k "corporate_companies or stock_price_lookup" --collect-only -q | tail -3`

Then grep for stragglers — expected: no output at all.

Run: `grep -rn "E:\\\\MoneyView\|_get_candidate_names" tests/`

- [ ] **Step 6: Commit**

```bash
git add tests/api/test_corporate_companies_registry.py tests/api/test_stock_price_lookup.py
git commit -m "test: use tmp_path instead of a hardcoded E:\\ temp root

Four tests built their temp directory under E:\\MoneyView\\data\\processed.
No E: drive exists on this machine, so mkdir(parents=True) walked up to
E:\\ and raised FileNotFoundError before any assertion ran -- these tests
have not executed since the workspace changed drives. The assertions are
sound: all nine pass once the root is valid.

tmp_path gives per-test isolation, automatic lifecycle management and
cross-platform paths, which also removes the reason the helpers reached
for the private tempfile._get_candidate_names()."
```

**Acceptance:** ✓ All four tests pass on any machine with no `E:\MoneyView` present. ✓ No reference to `_get_candidate_names` or a hardcoded absolute path remains under `tests/`.

---

## Task 2: Make `_to_node` iterative

**Files:**
- Modify: `apps/api/services/perf_analysis.py:316-344` (`_to_node`)
- Test: `tests/api/test_perf_analysis.py` (existing `test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` at `:304`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `_to_node(span: Span) -> SpanNode` — unchanged signature and return type. Task 3 converts three sibling walkers in the same file and must not alter this one.

**Context you need:** `perf_analysis.py` has five recursive tree walkers. Only `_to_node` raises today, because its list comprehension `[_to_node(child) for child in span.children]` costs a second Python frame per level — 668 levels at 2 frames each exceeds CPython's 1,000-frame default. The other three converted in Task 3 use 1 frame per level and survive this input with margin; `_subtree_size` is left alone because it only ever runs on already-collapsed subtrees (measured depth: 1).

Child ordering must be preserved exactly. `SpanNode.children` order drives the rendered waterfall, and any change is a silent visual regression.

- [ ] **Step 1: Run the failing test to see the current error**

Run: `python -m pytest "tests/api/test_perf_analysis.py::test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees" -q`

Expected: FAIL with `RecursionError: maximum recursion depth exceeded` at `perf_analysis.py:335`, inside `_to_node`.

- [ ] **Step 2: Replace `_to_node` with an explicit-stack version**

Replace the whole function. Every field in the `SpanNode(...)` construction must be carried over verbatim — omitting one silently drops data from the waterfall:

```python
def _to_node(span: Span) -> SpanNode:
    """Build the DTO tree bottom-up with an explicit stack.

    Deliberately not recursive: the comprehension form cost two Python frames
    per level (the call plus the comprehension's own frame), so a ~670-deep
    span chain exhausted the default 1000-frame stack and raised
    RecursionError instead of truncating -- the exact outcome truncation
    exists to prevent. Depth is now bounded by the heap. Keyed on id() because
    Span is a mutable dataclass and is not hashable.
    """
    order: list[Span] = []
    stack = [span]
    while stack:
        current = stack.pop()
        order.append(current)
        stack.extend(current.children)

    built: dict[int, SpanNode] = {}
    # reversed(order) guarantees every child is built before its parent: a
    # parent is always appended before the children it pushes.
    for current in reversed(order):
        node = SpanNode(
            id=current.id,
            parent_id=current.parent_id,
            operation=current.operation,
            scope=current.scope,
            status=current.status,
            total_ms=current.total_ms,
            self_ms=current.self_ms,
            offset_ms=current.offset_ms,
            clock_skew=current.clock_skew,
            orphaned=current.orphaned,
            ticker=current.ticker,
            table=current.table,
            component=current.component,
            rows=current.rows,
            bytes=current.bytes,
            series_points=current.series_points,
            cache_state=current.cache_state,
            children=[built[id(child)] for child in current.children],
        )
        # The collapsed marker lives in the DTO so the UI cannot render an elided
        # subtree as "no children" (spec 04.10).
        if current.collapsed is not None:
            count, total_ms, scope = current.collapsed
            node.children.append(
                CollapsedNode(collapsed_count=count, total_ms=total_ms, deepest_scope=scope)
            )
        built[id(current)] = node
    return built[id(span)]
```

Note `children=[built[id(child)] for child in current.children]` iterates `current.children` in its original order, so ordering is preserved regardless of the stack's pop order.

- [ ] **Step 3: Run the previously-failing test**

Run: `python -m pytest "tests/api/test_perf_analysis.py::test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees" -q`

Expected: **PASS**.

- [ ] **Step 4: Prove ordering and output are unchanged for every existing case**

Run: `python -m pytest tests/api/test_perf_analysis.py tests/api/test_perf_capture.py -q`

Expected: **1 failed, 75 passed** — the single remaining failure is `test_perf_capture.py::test_middleware_terminal_event_carries_closes_span_id_and_bytes`, which Task 6 fixes. If any *other* test in these files changed state, ordering was broken: stop and report.

- [ ] **Step 5: Commit**

```bash
git add apps/api/services/perf_analysis.py
git commit -m "fix: build the span DTO tree iteratively

_to_node recursed once per span level and its list comprehension cost a
second frame, so ~670 levels exceeded CPython's 1000-frame limit. A deep
span tree crashed /dev/perf analysis with RecursionError instead of
truncating -- precisely what the truncation path exists to prevent.

Explicit stack, bottom-up, children attached in their original order so
waterfall rendering is byte-identical for every tree that worked before."
```

**Acceptance:** ✓ `test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` passes. ✓ No other test in `test_perf_analysis.py` or `test_perf_capture.py` changes state.

---

## Task 3: Make the remaining three walkers iterative

**Files:**
- Modify: `apps/api/services/perf_analysis.py:239-291` (`_assign_self_ms`), `:294-313` (`_assign_offsets`), `:347-350` (`_depth_map`)
- Modify: `tests/api/test_perf_analysis.py` (add one test)
- Modify: `ERROR-LOG.md` (append)

**Interfaces:**
- Consumes: `_to_node` from Task 2 — already iterative; do not touch it again.
- Produces: `_assign_self_ms(span: Span) -> bool`, `_assign_offsets(span: Span, root_start_ms: float, parent_span: Span | None) -> None`, `_depth_map(span: Span, depth: int, acc: list[tuple[int, Span]]) -> None`. All three keep their exact current signatures, including the parameters that only the recursive form needed — callers at `:373`, `:399` pass them positionally.

**Context you need:** These three survive the depth-700 test at 1 frame per level, so no existing test fails on them. They are converted because the spec's acceptance criterion is "deep span trees no longer raise `RecursionError`", and leaving them recursive merely moves the cliff from ~500 levels to ~1,000 — the same objection the spec raises against `sys.setrecursionlimit()`.

Two of the three have ordering or sequencing requirements that a careless stack conversion breaks:
- `_assign_self_ms` is **post-order with an accumulator**: a span's `self_ms` subtracts its children's `total_ms`, and the `bool` return propagates overlap up from any descendant.
- `_assign_offsets` is **pre-order**: a child clamps against `parent_span.offset_ms`, which must already be assigned.
- `_depth_map` appends to `acc` in DFS order and `_truncate` consumes that order, so the traversal sequence must be identical, not merely complete.

- [ ] **Step 1: Write the failing regression test**

Add to `tests/api/test_perf_analysis.py`, next to the existing truncation tests:

```python
def test_a_chain_far_deeper_than_the_recursion_limit_truncates_instead_of_raising():
    """Depth 2000 is past the reach of every recursive walker in perf_analysis:
    _assign_self_ms, _assign_offsets and _depth_map each burn one frame per
    level against CPython's 1000-frame default, and _to_node burned two. A
    single deep chain is the realistic shape -- one ticker's mostly-linear
    span chain -- not a synthetic worst case, and the whole point of
    truncation is that an oversized tree degrades rather than explodes."""
    events = [ev("root", id="r", ms=10_000.0, offset_ms=10_000)]
    parent_id = "r"
    for level in range(2000):
        span_id = f"deep-{level}"
        events.append(ev(f"op-{level}", id=span_id, parent=parent_id, ms=1.0, offset_ms=level))
        parent_id = span_id

    waterfall = build_waterfall(events, "req-1")

    assert waterfall.truncated is True
    assert len(_flatten(waterfall.root)) <= WATERFALL_SPAN_CAP
```

Depth 2000 is chosen for two reasons at once: it is past CPython's 1,000-frame default for the one-frame-per-level walkers, and 2,001 spans is past `WATERFALL_SPAN_CAP`, which is also 2000 — so `truncated is True` is a real assertion rather than a tautology. `ev`, `_flatten`, `build_waterfall` and `WATERFALL_SPAN_CAP` are all already imported or defined in this test module.

- [ ] **Step 2: Run it and confirm it fails on a walker Task 2 did not convert**

Run: `python -m pytest "tests/api/test_perf_analysis.py::test_a_chain_far_deeper_than_the_recursion_limit_truncates_instead_of_raising" -q`

Expected: FAIL with `RecursionError`, with the repeating frame being **`_assign_self_ms` at `perf_analysis.py:271`** (`if _assign_self_ms(child):`). This has been verified against the current code: `build_waterfall` calls `_assign_self_ms` before `_to_node`, so it is the first walker to exhaust the stack at this depth. If the traceback instead names `_to_node`, Task 2 is incomplete; stop and report.

- [ ] **Step 3: Convert `_assign_self_ms`**

Keep the existing docstring verbatim — it documents the partial-child, negative-duration and synthetic-root rules and is the only record of them. Replace only the body below the docstring:

```python
    order: list[Span] = []
    stack = [span]
    while stack:
        current = stack.pop()
        order.append(current)
        stack.extend(current.children)

    overlap = False
    # reversed(order) is post-order: a parent's children are all processed
    # before it, which is what lets it subtract their settled total_ms.
    for current in reversed(order):
        if current.total_ms is None:
            current.self_ms = None
            continue

        children_total = 0.0
        for child in current.children:
            total = child.total_ms
            if total is None:
                continue
            if total < 0:
                child.clock_skew = True
                continue
            children_total += total

        raw_self = current.total_ms - children_total
        if current.id != SYNTHETIC_ROOT_ID and raw_self < -EPSILON_MS:
            overlap = True
        current.self_ms = round(max(0.0, raw_self), 1)
    return overlap
```

The `continue` on `total_ms is None` preserves the original's `return overlap` short-circuit: overlap already accumulated from descendants survives, and no further work happens for that span.

- [ ] **Step 4: Convert `_assign_offsets`**

Keep the inline comments verbatim — they cite spec 04.9 and explain the partial-parent clamp:

```python
def _assign_offsets(span: Span, root_start_ms: float, parent_span: Span | None) -> None:
    # Explicit stack, pre-order: a child clamps against its parent's
    # offset_ms, so the parent must be assigned before its children pop.
    stack: list[tuple[Span, Span | None]] = [(span, parent_span)]
    while stack:
        current, parent = stack.pop()
        raw_offset = _start_ms(current) - root_start_ms
        parent_offset = parent.offset_ms if parent else 0.0
        if parent is not None and parent.total_ms is None:
            # Partial parent (still in flight, or its start was evicted from the
            # ring buffer): there is no known window to clamp into. Enforce only
            # the lower bound -- a child can't be reported before its parent
            # starts -- rather than collapsing every child to a zero-width
            # window and flagging ordinary partial-parent structure as clock
            # skew (spec 04.9: partial is a diagnostic, not skew).
            clamped = max(parent_offset, raw_offset)
        else:
            parent_limit = parent.total_ms if parent else (current.total_ms or 0.0)
            clamped = max(parent_offset, min(raw_offset, parent_offset + parent_limit))
        # OR, not overwrite: a child's clock_skew may already have been set by
        # _assign_self_ms (a negative total_ms) and must survive this pass.
        current.clock_skew = current.clock_skew or (abs(clamped - raw_offset) > EPSILON_MS)
        current.offset_ms = round(max(0.0, clamped), 1)
        for child in current.children:
            stack.append((child, current))
```

- [ ] **Step 5: Convert `_depth_map`**

```python
def _depth_map(span: Span, depth: int, acc: list[tuple[int, Span]]) -> None:
    # reversed() on push so the pop order matches the recursive form's DFS
    # sequence exactly -- _truncate consumes acc in order, so this is a
    # behavioural requirement, not a style choice.
    stack = [(span, depth)]
    while stack:
        current, current_depth = stack.pop()
        acc.append((current_depth, current))
        for child in reversed(current.children):
            stack.append((child, current_depth + 1))
```

- [ ] **Step 6: Run the new test and the whole perf suite**

Run: `python -m pytest "tests/api/test_perf_analysis.py::test_a_chain_far_deeper_than_the_recursion_limit_truncates_instead_of_raising" -q`

Expected: **PASS**.

Run: `python -m pytest tests/api/test_perf_analysis.py tests/api/test_perf_capture.py -q`

Expected: **1 failed, 77 passed** — again only `test_middleware_terminal_event_carries_closes_span_id_and_bytes`, which Task 6 fixes. Any other change of state means a traversal order or accumulator rule was broken.

- [ ] **Step 7: Append the `ERROR-LOG.md` entry**

Append, following the template at the top of the file:

```text

## 2026-07-28: Deep span trees crashed /dev/perf analysis instead of truncating

Date: 2026-07-28
Command: `python -m pytest tests/api -q`
Failure: `test_truncation_falls_back_to_subtree_collapse_for_non_bushy_trees` failed with
`RecursionError: maximum recursion depth exceeded` at `apps/api/services/perf_analysis.py:335`.
The user-visible defect: a request producing a deep, narrow span tree crashed waterfall
analysis rather than truncating it -- the exact outcome the truncation path exists to
produce. The test had been carried as a known failure across several branches without being
diagnosed.
Root cause: `perf_analysis.py` contained five recursive tree walkers. `_to_node` spent two
Python frames per level -- the call plus its list comprehension's own frame -- so a 668-level
chain reached ~1,336 frames against CPython's 1,000-frame default. `_assign_self_ms`,
`_assign_offsets` and `_depth_map` walk the same depth at one frame per level and merely had
not reached their own ceiling yet; measured max depth on the failing input was 701 for each.
Fix: all four converted to explicit-stack iterative traversals, preserving each one's
sequencing contract -- post-order with an overlap accumulator for `_assign_self_ms`,
pre-order for `_assign_offsets`, and exact DFS append order for `_depth_map`, which
`_truncate` consumes positionally. `_subtree_size` was left recursive: it is only ever
invoked on already-collapsed subtrees, measured at depth 1. Regression test builds a
depth-2,000 chain, which fails on all four walkers before the change.
Files changed: `apps/api/services/perf_analysis.py`, `tests/api/test_perf_analysis.py`.
Prevention: recursion depth in a tree walker is bounded by input, not by code review.
When a module walks user- or telemetry-shaped trees, frames-per-level is the number that
matters and it is not visible from reading one function -- the comprehension inside
`_to_node` doubled it invisibly. Prefer explicit stacks for any traversal whose depth is
attacker- or workload-determined, and measure depth rather than assuming it.
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/services/perf_analysis.py tests/api/test_perf_analysis.py ERROR-LOG.md
git commit -m "fix: convert the remaining perf_analysis tree walkers to explicit stacks

_assign_self_ms, _assign_offsets and _depth_map each walk the same depth
as _to_node at one frame per level, so they had not yet hit CPython's
limit -- converting only _to_node would have moved the cliff from ~500
levels to ~1000 rather than removing it.

Sequencing contracts preserved: post-order with the overlap accumulator,
pre-order for offsets, and exact DFS append order for _depth_map, which
_truncate consumes positionally. _subtree_size stays recursive; it only
runs on already-collapsed subtrees.

Regression test builds a depth-2000 chain, which fails on all four
walkers before this change."
```

**Acceptance:** ✓ A depth-2,000 chain truncates instead of raising. ✓ No existing perf test changes state. ✓ `ERROR-LOG.md` records the defect.

---

## Task 4: Isolate the database for every test

**Files:**
- Modify: `tests/conftest.py` (add fixture)
- Modify: `pyproject.toml:45-53` (register the marker)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: an autouse fixture named `_isolated_db` and a `virgin_db` pytest marker. Task 5 applies that marker. Task 6 adds a second fixture to the same file.

**Context you need:** `apps/api/services/db.py:30` defines `_DB_PATH = Path(os.getenv("DB_PATH", "data/processed/moneyview.db"))` as a module attribute, read at call time by `get_db()` and `init_db()`. `monkeypatch.setattr` on the module attribute is therefore the correct seam and unwinds automatically.

A full-suite probe of this exact fixture has already been run. It fixed `test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events`, cut wall-clock from 403s to 205s, and surfaced exactly one test needing the marker (handled in Task 5) plus one Workstream D failure (handled in Task 6). Expect no other surprises; if one appears, give it real isolation rather than reaching for the marker.

`tests/conftest.py` already has one autouse fixture (`_reset_rate_limiter`) with a long docstring explaining why. Match that shape.

- [ ] **Step 1: Add the fixture to `tests/conftest.py`**

Add the import at the top, beside the existing ones:

```python
from apps.api.services import db as db_service
```

Then add the fixture after `_reset_rate_limiter`:

```python
@pytest.fixture(autouse=True)
def _isolated_db(request, tmp_path, monkeypatch):
    """Give every test its own SQLite file instead of the developer's real one.

    apps/api/services/db.py:30 defines _DB_PATH as a module attribute read at
    call time, so pointing it at tmp_path redirects get_db() and init_db()
    for the duration of the test and unwinds automatically.

    Without this, tests read data/processed/moneyview.db -- 142 tickers and
    1,307 AAPL rows on a developer machine, empty on a fresh clone -- so a
    test asserting "this fetch was live" passes or fails depending on whose
    machine it runs on rather than on the code. That is what made
    test_market_data_emits_cache_and_provider_events alternate with an
    unrelated failure depending on execution order.

    virgin_db opts out of schema creation only, never out of path isolation:
    a test that exercises a migration needs an empty database file, not a
    shared one.
    """
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    if "virgin_db" not in request.keywords:
        db_service.init_db()
```

- [ ] **Step 2: Register the marker in `pyproject.toml`**

Add to the existing `[tool.pytest.ini_options]` block, after `filterwarnings`:

```toml
markers = [
    "virgin_db: test needs an isolated but uninitialised database file (it creates its own schema)",
]
```

- [ ] **Step 3: Verify the fixture works and the marker is registered**

Run: `python -m pytest tests/api/test_dev_monitor_foundation.py -q`

Expected: all pass, including `test_market_data_emits_cache_and_provider_events` — which fails without this fixture.

Run: `python -m pytest tests/api -q --collect-only 2>&1 | grep -i "unknown marker"`

Expected: no output.

- [ ] **Step 4: Confirm the real database was not touched**

```bash
python -c "import pathlib,datetime; p=pathlib.Path('data/processed/moneyview.db'); print(datetime.datetime.fromtimestamp(p.stat().st_mtime))"
```

Record the timestamp, run `python -m pytest tests/api/test_dev_monitor_foundation.py -q`, then run the same command again. Expected: **identical timestamp**.

- [ ] **Step 5: Commit**

```bash
git add tests/conftest.py pyproject.toml
git commit -m "test: give every test its own database

Tests read data/processed/moneyview.db -- the developer's real data, with
142 tickers and 1,307 AAPL rows, and empty on a fresh clone. A test
asserting a fetch was live therefore passed or failed on machine state
rather than on code, which is why two unrelated failures traded places
depending on execution order.

The virgin_db marker skips schema creation only, never path isolation."
```

**Acceptance:** ✓ Each test receives an isolated SQLite database. ✓ `data/processed/moneyview.db` mtime is unchanged after a run. ✓ `test_market_data_emits_cache_and_provider_events` passes deterministically.

---

## Task 5: Mark the migration test `virgin_db`

**Files:**
- Modify: `tests/api/test_corporate_comparison.py` (one decorator, around `:650-665`)

**Interfaces:**
- Consumes: the `virgin_db` marker from Task 4.
- Produces: nothing.

**Context you need:** `test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables` deliberately creates a *legacy-shaped* `corporate_comparison_snapshots` table and then calls `init_db()` to prove the migration adds the new columns. Task 4's fixture calls `init_db()` first, so the test's `executescript` hits `sqlite3.OperationalError: table corporate_comparison_snapshots already exists`. It needs an isolated path with no schema — exactly what the marker provides.

This is the one legitimate use of the marker. A second use needs justification at review.

- [ ] **Step 1: Reproduce the failure introduced by Task 4**

Run: `python -m pytest "tests/api/test_corporate_comparison.py::test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables" -q`

Expected: FAIL with `sqlite3.OperationalError: table corporate_comparison_snapshots already exists` at roughly `test_corporate_comparison.py:660`.

- [ ] **Step 2: Add the marker**

Add the decorator directly above the test's `def`, and confirm `import pytest` is already present at the top of the file (it is):

```python
@pytest.mark.virgin_db
def test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables(tmp_path, monkeypatch):
```

The existing signature is `(tmp_path, monkeypatch)` in that order at `test_corporate_comparison.py:655` — leave it exactly as it is and add only the decorator line above it.

Do not otherwise change the test. Its existing `_DB_PATH` monkeypatch, if any, still runs after the fixture and wins.

- [ ] **Step 3: Run it**

Run: `python -m pytest "tests/api/test_corporate_comparison.py::test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables" -q`

Expected: **PASS**.

- [ ] **Step 4: Run the whole file**

Run: `python -m pytest tests/api/test_corporate_comparison.py -q`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add tests/api/test_corporate_comparison.py
git commit -m "test: mark the migration test virgin_db

It creates a legacy-shaped snapshot table and calls init_db() to prove
the migration adds the new columns, so it needs an isolated database file
with no schema -- not the initialised one the autouse fixture builds."
```

**Acceptance:** ✓ The migration test passes under the autouse fixture. ✓ The marker is used exactly once in the repository.

---

## Task 6: Gate the lifespan's network-bound startup jobs

**Files:**
- Modify: `apps/api/main.py:105-125` (`lifespan`)
- Modify: `tests/conftest.py` (add session fixture)

**Interfaces:**
- Consumes: the `tests/conftest.py` established in Task 4.
- Produces: the `MONEYVIEW_DISABLE_STARTUP_JOBS` environment variable contract.

**Context you need:** `test_perf_capture.py` is the only file using `with TestClient(app)`, the form that runs the FastAPI lifespan. `lifespan` starts `corporate_snapshot_cycle` and `stock_prewarm_cycle`; the latter calls `asyncio.to_thread(MarketDataService().prewarm_configured_tickers)`. On exit, `task.cancel()` cancels the asyncio task but **cannot** stop the threadpool worker it dispatched, which keeps fetching live data and emitting dev-monitor events into whatever sink is current.

Two tests read the shared sink through a fixed window — `sink.recent(limit=500)` and `recent(limit=2000)` — and select events positionally with `next(...)`. Once leftover prewarm threads flood that window, the events under test are evicted and `next()` raises. That is why the failure is timing- and order-dependent.

`wal_flush_cycle` is **not** gated: it touches only the local database and is cheap.

The environment variable must be read **inside** `lifespan`, not at module import, or `conftest.py` setting it will have no effect on an already-imported module.

- [ ] **Step 1: Reproduce both failures**

Run: `python -m pytest tests/api/test_perf_capture.py -q`

Expected: this may pass in isolation — that is the nature of the bug. Then run the two together, which is the shape that fails:

Run: `python -m pytest tests/api/test_perf_analysis.py tests/api/test_perf_capture.py -q`

Record which of `test_middleware_terminal_event_carries_closes_span_id_and_bytes` and `test_request_waterfall_has_exactly_one_root` fail. At least one will.

- [ ] **Step 2: Add the gate to `lifespan`**

Add `import os` at the top of `apps/api/main.py` if not already present, then modify the task-creation block:

```python
    task_wal = asyncio.create_task(wal_flush_cycle())

    # Read at call time, not import time, so a test process that sets this in
    # conftest still takes effect on an already-imported module.
    #
    # These two cycles fetch live market data on startup. Under pytest that
    # means real network traffic, and stock_prewarm_cycle's asyncio.to_thread
    # worker cannot be cancelled -- it outlives the TestClient block, keeps
    # emitting into the dev-monitor sink, and evicts the events a test is
    # asserting on from its recent(limit=N) window.
    startup_jobs_disabled = os.getenv("MONEYVIEW_DISABLE_STARTUP_JOBS", "").lower() in {
        "1", "true", "yes",
    }
    background = [task_wal]
    if not startup_jobs_disabled:
        background.append(asyncio.create_task(corporate_snapshot_cycle()))
        background.append(asyncio.create_task(stock_prewarm_cycle()))

    yield

    for task in background:
        task.cancel()
    # Await the cancellations so shutdown does not return while they are still
    # propagating. An in-flight asyncio.to_thread worker still cannot be killed
    # -- that is a CPython constraint, not something this gather fixes -- so a
    # prewarm started before shutdown can still outlive the app in production.
    # The real fix is a cooperative stop flag inside prewarm_configured_tickers,
    # which is out of scope here.
    await asyncio.gather(*background, return_exceptions=True)
```

Replace the existing `task_corporate_snapshot` / `task_stock_prewarm` variables and their three `.cancel()` calls entirely. Leave everything after the `gather` — the dev-monitor sink shutdown block — exactly as it is.

- [ ] **Step 3: Set the variable for the test session**

Add to `tests/conftest.py`:

```python
@pytest.fixture(autouse=True, scope="session")
def _disable_startup_jobs():
    """Stop the FastAPI lifespan starting its live-data warmers under pytest.

    corporate_snapshot_cycle and stock_prewarm_cycle both fetch from the
    network on startup, and prewarm's asyncio.to_thread worker cannot be
    cancelled -- it outlives the TestClient block that started it and keeps
    emitting into the dev-monitor sink, evicting the events a test asserts on
    from its fixed recent(limit=N) window. Session-scoped and set before any
    TestClient is constructed.
    """
    os.environ["MONEYVIEW_DISABLE_STARTUP_JOBS"] = "1"
    yield
    os.environ.pop("MONEYVIEW_DISABLE_STARTUP_JOBS", None)
```

`os` is already imported in `tests/conftest.py`.

- [ ] **Step 4: Verify both tests pass, in isolation and together**

Run: `python -m pytest tests/api/test_perf_capture.py -q`

Expected: all pass.

Run: `python -m pytest tests/api/test_perf_analysis.py tests/api/test_perf_capture.py -q`

Expected: all pass — **0 failed**.

- [ ] **Step 5: Verify the default production path is unchanged**

The gate must be inert when the variable is unset, empty, or set to anything other than the three accepted values — otherwise a stray environment variable silently disables warming in production.

```bash
python - <<'EOF'
for value in (None, "", "0", "false", "no", "off", "1", "true", "TRUE", "yes"):
    resolved = "" if value is None else value
    disabled = resolved.lower() in {"1", "true", "yes"}
    print(f"{value!r:10} -> disabled={disabled}")
EOF
```

Expected: `True` only for `"1"`, `"true"`, `"TRUE"`, `"yes"`. Everything else — including unset, empty, `"0"`, `"false"`, `"off"` — must be `False`.

Then confirm the un-gated path still starts both cycles by reading the diff: with the variable unset, `background` must contain three tasks.

- [ ] **Step 6: Commit**

```bash
git add apps/api/main.py tests/conftest.py
git commit -m "fix: gate live-data startup jobs behind an env var

corporate_snapshot_cycle and stock_prewarm_cycle fetch from the network on
startup. Under pytest that is real traffic, and prewarm's asyncio.to_thread
worker cannot be cancelled -- it outlived the TestClient block, kept
emitting into the dev-monitor sink, and evicted the events two tests assert
on from their fixed recent(limit=N) window. Order- and timing-dependent,
which is why those tests traded places with an unrelated failure.

Shutdown now awaits the cancellations rather than returning while they
propagate. The surviving to_thread worker is a CPython constraint and is
documented, not claimed fixed. The gate is inert unless set, so default
production startup is unchanged."
```

**Acceptance:** ✓ Startup background jobs never execute during pytest. ✓ Both `test_perf_capture` failures pass in isolation and together. ✓ An unset variable leaves production startup unchanged.

---

## Task 7: Full-suite verification and baseline update

**Files:**
- Modify: `guideline/sop/todo.md`

**Interfaces:**
- Consumes: Tasks 1-6, all committed.
- Produces: nothing.

**Context you need:** Two of these failures alternate by execution order, so a single green run is consistent with having merely reshuffled them. `pytest-randomly` is not a dependency and adding one is out of scope, so order variation is done by passing test files in reverse order, which pytest honors.

- [ ] **Step 1: Run the full suite three times**

```bash
for i in 1 2 3; do python -m pytest tests/api -q 2>&1 | tail -2; done
```

Expected: **0 failed** all three times. Note the wall-clock — it should land near 205s rather than 403s.

- [ ] **Step 2: Run it in reverse file order**

```bash
python -m pytest $(ls tests/api/test_*.py | sort -r) tests/api/acquisition -q 2>&1 | tail -3
```

Expected: **0 failed**.

- [ ] **Step 3: Run each formerly order-sensitive test in isolation**

```bash
for t in \
  "tests/api/test_perf_capture.py::test_middleware_terminal_event_carries_closes_span_id_and_bytes" \
  "tests/api/test_perf_capture.py::test_request_waterfall_has_exactly_one_root" \
  "tests/api/test_dev_monitor_foundation.py::test_market_data_emits_cache_and_provider_events" \
  "tests/api/test_corporate_comparison.py::test_init_db_adds_comparison_universe_columns_for_legacy_snapshot_tables" ; do
  python -m pytest "$t" -q 2>&1 | tail -1
done
```

Expected: all four pass.

- [ ] **Step 4: Confirm the real database was never touched**

Record `data/processed/moneyview.db` mtime, run the full suite, compare. Expected: identical.

- [ ] **Step 5: Update `guideline/sop/todo.md`**

Replace the acquisition track's recorded baseline — it currently reads `6 failed / 267 passed, the six pre-existing failures only` — and add a short track recording that the baseline is now zero, what the three root causes were, and that four tests had never executed. Include the note that `_subtree_size` was deliberately left recursive and why, so it is not "fixed" later by someone reading only the diff.

- [ ] **Step 6: Commit**

```bash
git add guideline/sop/todo.md
git commit -m "docs: record the zero-failure test baseline

Six inherited failures resolved across four workstreams. The '6 known
failures' baseline had been carried across branches undiagnosed; it is
now 0 and must not be re-inherited."
```

**Acceptance:** ✓ `python -m pytest tests/api -q` reports 0 failed, three consecutive runs. ✓ 0 failed in reverse file order. ✓ All four formerly order-sensitive tests pass in isolation. ✓ The real database is untouched. ✓ `todo.md` records the new baseline.

---

## Deliberate exclusions

Recorded so they are not mistaken for oversights:

- **Cooperative cancellation in `prewarm_configured_tickers()`.** The surviving `asyncio.to_thread` worker is documented in Task 6 and in the spec, not fixed. It needs a stop flag checked between tickers.
- **`_subtree_size` stays recursive.** Only ever invoked on already-collapsed subtrees; measured depth 1 on the failing input.
- **No randomization plugin.** Order dependence is attacked by reverse-order and isolation runs instead.
- **The `tests/api/acquisition` suite's own `_isolated_db` fixtures stay.** Task 4 makes them redundant, but they document each test's requirement locally and removing them is churn.
- **Why the baseline was allowed to persist across branches** is a process question, not a design one.
