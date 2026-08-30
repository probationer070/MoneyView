# Over/Undervaluation Verdict Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For one ticker, produce an evidence panel of price-derived signals beside their sector comparisons, each naming its source, each refusing independently, with the direction being tested stated explicitly.

**Architecture:** A pure signal module in `packages/core_finance` computes drawdown, volume ratio and trailing-PE series from sequences. A local-store bar reader and a peer resolver supply data without touching the network. A service assembles the panel, injecting every dependency. One route exposes it.

**Tech Stack:** Python 3.11, FastAPI, pytest, SQLite via `apps/api/services/db.py`, openpyxl (workbook parsing, already a dependency).

**Spec:** `docs/superpowers/specs/2026-08-29-overvaluation-verdict-design.md`

## Global Constraints

- `packages/core_finance` must never import from `apps/api`.
- Do NOT modify `packages/core_finance/dcf.py`, `packages/core_finance/segment_valuation.py`, `apps/api/services/corporate_dcf.py`, or `apps/api/services/corporate_metrics_service.py`.
- Tests must make no network calls and must not open `data/processed/moneyview.db`. The autouse `_isolated_db` fixture in `tests/conftest.py` redirects `get_db()`; rely on it and add no new isolation fixtures.
- **Never call `market_data.get_stock_ohlcv` from verdict code.** Its docstring is "Read OHLCV from SQLite and refresh live data if locally stale" — it reaches the network. Task 2 builds a local-store-only reader.
- Refusal is **per-signal, never global**. A refused row travels inside a 200 response. No refused signal ever falls back to an absolute threshold.
- Every panel row names the source its comparison came from.
- The direction statement is mandatory on every panel: testing **undervaluation** against the top of the sector; this basis is anti-conservative for overvaluation.
- Minimum 3 peers, matching `resolve_benchmark`'s existing `minimum=3`.
- New route handlers are `def`, not `async def` — every handler in this app now runs sync-on-threadpool.
- Success criterion: the full suite passes with no test skipped, xfailed, or weakened. Baseline is 799 passing.

## File Structure

| File | Responsibility |
|---|---|
| `packages/core_finance/price_signals.py` | **Create.** Pure arithmetic on sequences: drawdown, volume ratio, PE series. No I/O. |
| `apps/api/services/acquisition/store.py` | **Modify.** Add `load_price_bars` — a local-store-only bar reader, beside the existing `load_statement_bundle`. |
| `apps/api/services/peer_set.py` | **Create.** Resolve same-industry peers from `corporate_quote_facts`. |
| `packages/core_finance/industry_benchmark.py` | **Modify.** Add `required: bool = True` to `BenchmarkColumn`; add the four new columns as optional. |
| `apps/api/services/db.py` | **Modify.** Four additive columns on `industry_benchmark`, in both schema locations. |
| `apps/api/services/industry_benchmark_store.py` | **Modify.** Require only `required` columns; persist and load the new ones. |
| `apps/api/services/valuation_verdict.py` | **Create.** Assemble the panel. |
| `apps/api/routes/valuation.py` | **Modify.** One route. |
| `apps/api/models/schema_parts/valuation.py` | **Modify.** Panel response models. |

---

### Task 1: The pure signal module

**Files:**
- Create: `packages/core_finance/price_signals.py`
- Test: `tests/core_finance/test_price_signals.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `drawdown_from_peak(closes: Sequence[float]) -> tuple[float, float, int]` — `(pct, peak_value, peak_index)`; `pct` is negative or zero
  - `volume_ratio(volumes: Sequence[int], recent: int, baseline: int) -> float | None`
  - `trailing_pe_series(closes: Sequence[tuple[str, float]], eps_by_period: dict[str, float]) -> list[tuple[str, float]]`
  - `pe_change(series: Sequence[tuple[str, float]]) -> float | None`

- [ ] **Step 1: Write the failing tests**

Create `tests/core_finance/test_price_signals.py`:

```python
import pytest

from packages.core_finance.price_signals import (
    drawdown_from_peak,
    pe_change,
    trailing_pe_series,
    volume_ratio,
)


def test_drawdown_measures_from_the_running_peak():
    # peak 174.40 at index 2, last close 120.00 -> -31.1926...%
    closes = [100.0, 150.0, 174.40, 130.0, 120.0]
    pct, peak, index = drawdown_from_peak(closes)
    assert peak == 174.40
    assert index == 2
    assert pct == pytest.approx(-0.311926605504587, rel=1e-12)


def test_a_series_at_its_peak_has_zero_drawdown():
    pct, peak, index = drawdown_from_peak([10.0, 20.0, 30.0])
    assert pct == 0.0
    assert peak == 30.0
    assert index == 2


def test_drawdown_refuses_an_empty_series():
    assert drawdown_from_peak([]) is None


def test_volume_ratio_is_recent_mean_over_baseline_mean():
    # recent 2 -> mean 300; baseline 4 -> mean 200
    assert volume_ratio([100, 100, 300, 300], recent=2, baseline=4) == pytest.approx(1.5)


def test_volume_ratio_refuses_a_zero_baseline():
    """A zero baseline MEAN would divide to infinity. A plausible-looking number
    is worse than no number -- the argument dcf.py:196 makes for the terminal
    spread."""
    assert volume_ratio([0, 0, 0, 0], recent=2, baseline=4) is None


def test_volume_ratio_tolerates_individual_zero_volume_days():
    """Only the baseline MEAN has to be positive. A halted or zero-volume day
    inside the window must not refuse the whole signal: over a 252-day baseline
    that would make the ratio almost never computable on real data.

    recent 2 -> mean 5.0; baseline 4 -> mean 2.5; ratio 2.0
    """
    assert volume_ratio([0, 0, 5, 5], recent=2, baseline=4) == pytest.approx(2.0)


def test_volume_ratio_refuses_when_the_window_exceeds_the_data():
    assert volume_ratio([100, 200], recent=2, baseline=10) is None


def test_trailing_pe_uses_the_eps_of_each_close_s_period():
    closes = [("2024-12-31", 100.0), ("2025-12-31", 120.0)]
    eps = {"2024": 5.0, "2025": 6.0}
    assert trailing_pe_series(closes, eps) == [("2024-12-31", 20.0), ("2025-12-31", 20.0)]


def test_a_non_positive_eps_yields_no_pe_for_that_period():
    """A loss-making year has no meaningful PE. Emitting a negative one would
    read as 'cheap' in any comparison that sorts ascending."""
    closes = [("2024-12-31", 100.0), ("2025-12-31", 120.0)]
    eps = {"2024": 0.0, "2025": -3.0}
    assert trailing_pe_series(closes, eps) == []


def test_pe_change_is_the_fractional_move_across_the_series():
    series = [("2024-12-31", 34.0), ("2025-12-31", 22.1)]
    assert pe_change(series) == pytest.approx(-0.35)


def test_pe_change_refuses_a_single_point():
    assert pe_change([("2025-12-31", 22.0)]) is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/core_finance/test_price_signals.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'packages.core_finance.price_signals'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core_finance/price_signals.py`:

```python
"""Price-derived signals: drawdown, volume, and trailing PE.

Pure arithmetic on sequences. Nothing here reads a database, a file or a
network -- callers supply the series, which is what lets every edge case be
tested against exact numbers instead of whatever the store happens to hold.

Every function returns None rather than a number it cannot justify. A zero
baseline volume, a loss-making year's PE, a drawdown over no data: each has a
defensible-looking answer (infinity, a negative PE, zero) that would travel
into a comparison and read as a real reading. The argument is dcf.py:196's --
a large finite number where the model has no value is worse than no number.
"""

from __future__ import annotations

from collections.abc import Sequence


def drawdown_from_peak(closes: Sequence[float]) -> tuple[float, float, int] | None:
    """Fractional decline from the running peak to the last close.

    The peak is the maximum over the window the CALLER supplied, so the choice
    of "previous peak" stays with the caller rather than being guessed here.
    Returns `(pct, peak_value, peak_index)`; `pct` is <= 0.
    """
    if not closes:
        return None
    peak = max(closes)
    index = list(closes).index(peak)
    if peak <= 0:
        return None
    return (closes[-1] - peak) / peak, peak, index


def volume_ratio(volumes: Sequence[int], recent: int, baseline: int) -> float | None:
    """Mean volume over the last `recent` bars, divided by that over `baseline`."""
    if recent <= 0 or baseline <= 0 or len(volumes) < max(recent, baseline):
        return None
    baseline_mean = sum(volumes[-baseline:]) / baseline
    if baseline_mean <= 0:
        return None
    return (sum(volumes[-recent:]) / recent) / baseline_mean


def trailing_pe_series(
    closes: Sequence[tuple[str, float]], eps_by_period: dict[str, float]
) -> list[tuple[str, float]]:
    """PE at each close, using the EPS of the year that close falls in.

    A period with non-positive EPS is OMITTED, not emitted as a negative PE: a
    loss-making year has no meaningful earnings multiple, and a negative one
    sorts as "cheap" in any ascending comparison.
    """
    series: list[tuple[str, float]] = []
    for date, close in closes:
        eps = eps_by_period.get(date[:4])
        if eps is None or eps <= 0:
            continue
        series.append((date, close / eps))
    return series


def pe_change(series: Sequence[tuple[str, float]]) -> float | None:
    """Fractional change in PE from the first point in the series to the last."""
    if len(series) < 2:
        return None
    first, last = series[0][1], series[-1][1]
    if first <= 0:
        return None
    return (last - first) / first
```

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/core_finance/test_price_signals.py -v`
Expected: 11 passed.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -q`
Expected: 810 passed (799 baseline + 11).

- [ ] **Step 6: Commit**

```bash
git add packages/core_finance/price_signals.py tests/core_finance/test_price_signals.py
git commit -m "feat: pure price-derived signal module

Drawdown from the running peak, volume ratio, and trailing-PE series, all
over caller-supplied sequences with no I/O. Each refuses rather than
returning a number it cannot justify: a zero baseline volume, a loss-making
year's PE, an empty series."
```

---

### Task 2: The local-store bar reader and the peer set

**Files:**
- Modify: `apps/api/services/acquisition/store.py` (add `load_price_bars` after `load_statement_bundle`)
- Create: `apps/api/services/peer_set.py`
- Test: `tests/api/test_peer_set.py`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `load_price_bars(ticker: str, limit: int | None = None) -> list[dict]` — rows with `date`, `close`, `volume`, oldest first
  - `resolve_peers(ticker: str) -> tuple[list[str], str | None]` — exactly one non-None

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_peer_set.py`:

```python
from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.db import get_db
from apps.api.services.peer_set import MIN_PEERS, resolve_peers


def _seed_facts(ticker, industry="Semiconductors"):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )


def _seed_bars(ticker, rows):
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(ticker, d, c, c, c, c, v) for d, c, v in rows],
        )


def test_load_price_bars_reads_the_local_store_oldest_first():
    _seed_bars("AAA", [("2025-01-02", 11.0, 200), ("2025-01-01", 10.0, 100)])
    bars = load_price_bars("AAA")
    assert [b["date"] for b in bars] == ["2025-01-01", "2025-01-02"]
    assert [b["close"] for b in bars] == [10.0, 11.0]
    assert [b["volume"] for b in bars] == [100, 200]


def test_load_price_bars_returns_empty_for_an_unknown_ticker():
    assert load_price_bars("NOPE") == []


def test_load_price_bars_limit_keeps_the_most_recent():
    _seed_bars("BBB", [(f"2025-01-0{i}", float(i), i * 10) for i in range(1, 6)])
    bars = load_price_bars("BBB", limit=2)
    assert [b["date"] for b in bars] == ["2025-01-04", "2025-01-05"]


def test_peers_are_same_industry_tickers_excluding_self():
    for t in ("TGT", "P1", "P2", "P3"):
        _seed_facts(t)
    _seed_facts("OTHER", industry="Software (System & Application)")
    peers, reason = resolve_peers("TGT")
    assert reason is None
    assert sorted(peers) == ["P1", "P2", "P3"]


def test_a_thin_peer_set_refuses_rather_than_averaging_over_too_few():
    """MIN_PEERS matches resolve_benchmark's own `minimum=3`, so the two layers
    cannot disagree about what 'enough' means."""
    assert MIN_PEERS == 3
    for t in ("TGT", "P1", "P2"):
        _seed_facts(t)
    peers, reason = resolve_peers("TGT")
    assert peers == []
    assert reason == "peer_set_too_thin: 2 peers"


def test_a_ticker_with_no_stored_industry_refuses():
    peers, reason = resolve_peers("GHOST")
    assert peers == []
    assert reason == "no_industry: GHOST"
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_peer_set.py -v`
Expected: FAIL — `ImportError: cannot import name 'load_price_bars'`.

- [ ] **Step 3: Add the bar reader**

Append to `apps/api/services/acquisition/store.py`:

```python
def load_price_bars(ticker: str, limit: int | None = None) -> list[dict]:
    """Price bars from the local store ONLY, oldest first.

    Deliberately not `market_data.get_stock_ohlcv`, which refreshes live when
    the local copy is stale and therefore reaches the network. Signal
    computation reads what the acquisition layer stored and nothing else, the
    same rule `load_statement_bundle` follows.

    `limit` keeps the most RECENT n bars, since every signal here looks
    backwards from today.
    """
    ticker = ticker.upper()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT date, close, volume FROM stocks WHERE ticker = ? ORDER BY date DESC"
            + (" LIMIT ?" if limit is not None else ""),
            (ticker, limit) if limit is not None else (ticker,),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]
```

- [ ] **Step 4: Write the peer resolver**

Create `apps/api/services/peer_set.py`:

```python
"""Same-industry peers drawn from what this installation already stores.

This is a WATCHLIST, not a sector census. Six semiconductor tickers someone
follows are not the semiconductor sector, and every consumer must report the
peer count rather than present the comparison as authoritative.
"""

from __future__ import annotations

from apps.api.services.db import get_db

# Matches `resolve_benchmark`'s own `minimum=3`. Two layers that both average
# over a peer group must not disagree about what "enough" means.
MIN_PEERS = 3


def resolve_peers(ticker: str) -> tuple[list[str], str | None]:
    """Tickers sharing `ticker`'s industry, excluding itself.

    Exactly one of (peers, reason) is non-empty/non-None.
    """
    ticker = ticker.upper()
    with get_db() as conn:
        row = conn.execute(
            "SELECT industry FROM corporate_quote_facts WHERE ticker = ?", (ticker,)
        ).fetchone()
        if row is None or not row["industry"]:
            return [], f"no_industry: {ticker}"
        peers = [
            r["ticker"]
            for r in conn.execute(
                "SELECT ticker FROM corporate_quote_facts "
                "WHERE industry = ? AND ticker != ? ORDER BY ticker",
                (row["industry"], ticker),
            ).fetchall()
        ]
    if len(peers) < MIN_PEERS:
        return [], f"peer_set_too_thin: {len(peers)} peers"
    return peers, None
```

- [ ] **Step 5: Run to verify they pass**

Run: `python -m pytest tests/api/test_peer_set.py -v`
Expected: 6 passed.

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest -q`
Expected: 819 passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/acquisition/store.py apps/api/services/peer_set.py tests/api/test_peer_set.py
git commit -m "feat: local-store bar reader and same-industry peer set

load_price_bars reads `stocks` only, never market_data.get_stock_ohlcv,
which refreshes live when stale and would put the network in a signal path.

resolve_peers draws peers from corporate_quote_facts and refuses below 3,
matching resolve_benchmark's own minimum so the two layers cannot disagree
about what 'enough' means."
```

---

### Task 3: Optional benchmark columns

**Files:**
- Modify: `packages/core_finance/industry_benchmark.py` (`BenchmarkColumn`, `BENCHMARK_COLUMNS`)
- Modify: `apps/api/services/db.py:544-558` and the `_ensure_schema_compatibility` block near `:838`
- Modify: `apps/api/services/industry_benchmark_store.py:49` (required list) and the INSERT/SELECT
- Test: `tests/api/test_industry_benchmark_store.py`, `tests/core_finance/test_industry_benchmark.py`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `BenchmarkColumn.required: bool` (default `True`); four new keys on a stored row — `trailing_pe`, `price_to_book`, `ev_sales`, `stdev_price`.

**Background:** `parse_workbook` builds its required-header list from **every** entry in `BENCHMARK_COLUMNS` (`industry_benchmark_store.py:49`). Adding the four columns without a `required` flag would make every existing workbook fail to parse — trading a missing signal for a broken loader.

- [ ] **Step 1: Write the failing tests**

Add to `tests/core_finance/test_industry_benchmark.py`:

```python
def test_the_four_price_columns_are_optional():
    """parse_workbook builds its required-header list from BENCHMARK_COLUMNS,
    so a column added as required would reject every workbook published before
    it existed -- trading a missing signal for a broken loader."""
    from packages.core_finance.industry_benchmark import BENCHMARK_COLUMNS

    by_key = {c.key: c for c in BENCHMARK_COLUMNS}
    for key in ("trailing_pe", "price_to_book", "ev_sales", "stdev_price"):
        assert key in by_key, f"{key} missing from BENCHMARK_COLUMNS"
        assert by_key[key].required is False


def test_every_pre_existing_column_stays_required():
    from packages.core_finance.industry_benchmark import BENCHMARK_COLUMNS

    for key in (
        "revenue_growth", "operating_margin", "after_tax_roc", "effective_tax_rate",
        "unlevered_beta", "debt_to_capital", "cost_of_capital", "sales_to_capital",
        "reinvestment_rate",
    ):
        assert next(c for c in BENCHMARK_COLUMNS if c.key == key).required is True
```

Add to `tests/api/test_industry_benchmark_store.py`:

```python
def test_a_workbook_without_the_optional_columns_still_parses(tmp_path):
    """The four price columns were added after several vintages were published."""
    import openpyxl

    from apps.api.services.industry_benchmark_store import parse_workbook
    from packages.core_finance.industry_benchmark import BENCHMARK_COLUMNS

    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Industry Averages"
    required = [c for c in BENCHMARK_COLUMNS if c.required]
    sheet.append(["Industry Name", "Number of firms"] + [c.source_header for c in required])
    sheet.append(["Semiconductor", 50] + [0.1] * len(required))
    path = tmp_path / "old_vintage.xlsx"
    book.save(path)

    rows = parse_workbook(path, sheet="Industry Averages")
    assert len(rows) == 1
    assert rows[0].values.get("trailing_pe") is None
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py -k "optional or pre_existing" tests/api/test_industry_benchmark_store.py -k "without_the_optional" -v`
Expected: FAIL — `AttributeError: 'BenchmarkColumn' object has no attribute 'required'`.

- [ ] **Step 3: Add the flag and the columns**

In `packages/core_finance/industry_benchmark.py`, add the field to `BenchmarkColumn` (after `high`):

```python
    # False for columns added after vintages were already published. `parse_workbook`
    # builds its required-header list from this flag, so an optional column absent
    # from an older workbook leaves that row's value None instead of rejecting the
    # whole file.
    required: bool = True
```

Append to `BENCHMARK_COLUMNS` (bands are plausibility bounds, deliberately tighter than any engine check):

```python
    BenchmarkColumn("trailing_pe", "Trailing PE", "ratio", 0.0, 200.0, required=False),
    BenchmarkColumn("price_to_book", "Price/Book", "ratio", 0.0, 50.0, required=False),
    BenchmarkColumn("ev_sales", "EV/Sales", "ratio", 0.0, 50.0, required=False),
    BenchmarkColumn(
        "stdev_price", "Std deviation in stock prices", "fraction", 0.0, 3.0, required=False
    ),
```

- [ ] **Step 4: Require only the required ones**

In `apps/api/services/industry_benchmark_store.py`, change line 49:

```python
    required = ["Industry Name", "Number of firms"] + [
        c.source_header for c in BENCHMARK_COLUMNS if c.required
    ]
```

- [ ] **Step 5: Add the database columns**

In `apps/api/services/db.py`, add to the `industry_benchmark` table in `_CREATE_SCHEMA_SQL` (after `reinvestment_rate REAL,`):

```sql
    trailing_pe        REAL,
    price_to_book      REAL,
    ev_sales           REAL,
    stdev_price        REAL,
```

Add the same four lines to the `CREATE TABLE IF NOT EXISTS industry_benchmark` statement in `_ensure_schema_compatibility`, and add guarded `ALTER TABLE`s beside the existing `corporate_quote_facts` ones, following that exact pattern:

```python
    benchmark_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(industry_benchmark)").fetchall()
    }
    for column in ("trailing_pe", "price_to_book", "ev_sales", "stdev_price"):
        if column not in benchmark_columns:
            conn.execute(f"ALTER TABLE industry_benchmark ADD COLUMN {column} REAL")
```

- [ ] **Step 6: Persist and load them**

In `apps/api/services/industry_benchmark_store.py`, the INSERT and SELECT both build their column lists from `BENCHMARK_COLUMNS`, so verify by reading `store_vintage` and `load_vintage` that the four new keys flow through with no further change. If either hardcodes a column list, extend it from `BENCHMARK_COLUMNS` rather than adding four literals.

- [ ] **Step 7: Run the tests**

Run: `python -m pytest tests/core_finance/test_industry_benchmark.py tests/api/test_industry_benchmark_store.py -v`
Expected: all pass, including the pre-existing ones.

- [ ] **Step 8: Run the full suite**

Run: `python -m pytest -q`
Expected: 825 passed.

- [ ] **Step 9: Commit**

```bash
git add packages/core_finance/industry_benchmark.py apps/api/services/db.py apps/api/services/industry_benchmark_store.py tests/
git commit -m "feat: optional benchmark columns for the price signals

Adds trailing_pe, price_to_book, ev_sales and stdev_price, which the
industry-relative spec said it was storing and did not.

They are OPTIONAL: parse_workbook builds its required-header list from
BENCHMARK_COLUMNS, so adding them as required would reject every workbook
published before they existed -- a broken loader in exchange for a missing
signal. BenchmarkColumn.required defaults True, so every existing column
behaves exactly as before."
```

---

### Task 4: The verdict service

**Files:**
- Create: `apps/api/services/valuation_verdict.py`
- Test: `tests/api/test_valuation_verdict.py`

**Interfaces:**
- Consumes: `drawdown_from_peak`, `volume_ratio`, `trailing_pe_series`, `pe_change` (Task 1); `load_price_bars` (Task 2); `resolve_peers`, `MIN_PEERS` (Task 2); `resolve_for_ticker` (existing, `apps/api/services/industry_benchmark_store.py`); `find_conservative_case_id` (existing, `apps/api/services/company_baseline.py`); `run_stored_case` (existing, `apps/api/services/valuation_case.py`, whose result carries `value_per_share_diluted`).
- Produces: `build_verdict(ticker, *, bars_loader=load_price_bars) -> dict`

**The panel shape.** Every row is `{"value": float | None, "comparison": str | None, "source": str, "reason": str | None}` — `value` and `reason` are mutually exclusive.

- [ ] **Step 1: Write the failing tests**

Create `tests/api/test_valuation_verdict.py`:

```python
import pytest

from apps.api.services.db import get_db
from apps.api.services.valuation_verdict import DIRECTION, build_verdict


def _facts(ticker, industry="Semiconductors"):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )


def _bars(ticker, rows):
    with get_db() as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(ticker, d, c, c, c, c, v) for d, c, v in rows],
        )


_SERIES = [("2025-01-0%d" % i, float(100 + i * 10), 100 * i) for i in range(1, 6)]


def test_the_panel_always_states_the_direction_being_tested():
    """Mandated by the industry-relative spec: benchmarking against the top of a
    sector is conservative for undervaluation and anti-conservative for the
    opposite, and the verdict layer must say which it is testing."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    assert panel["direction"] == DIRECTION
    assert "anti-conservative" in DIRECTION


def test_drawdown_and_volume_compute_from_stored_bars():
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, _SERIES)
    _bars("TGT", [("2025-01-06", 120.0, 900)])
    panel = build_verdict("TGT")
    assert panel["rows"]["drawdown"]["value"] == pytest.approx((120.0 - 150.0) / 150.0)
    assert panel["rows"]["drawdown"]["reason"] is None
    assert panel["rows"]["volume"]["value"] is not None


def test_a_thin_peer_set_refuses_only_the_peer_rows():
    """Refusal is per-signal: a missing peer comparison must not take the whole
    panel down with it."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["drawdown"]["reason"] == "peer_set_too_thin: 0 peers"
    assert panel["rows"]["drawdown"]["value"] is None
    assert panel["rows"] != {}


def test_a_ticker_with_no_case_refuses_only_the_dcf_row():
    for t in ("TGT", "P1", "P2", "P3"):
        _facts(t)
        _bars(t, _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["dcf_gap"]["reason"] == "no_case: TGT"
    assert panel["rows"]["drawdown"]["value"] is not None


def test_the_pe_row_refuses_when_the_vintage_has_no_trailing_pe():
    from apps.api.services.industry_benchmark_store import store_vintage
    from tests.fixtures.industry_rows_technology import TECHNOLOGY_ROWS

    store_vintage("2026-01-01", TECHNOLOGY_ROWS)
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    assert panel["rows"]["trailing_pe"]["reason"].startswith("no_sector_pe")


def test_every_row_names_its_source():
    """A reader must never have to guess whether 'the sector' meant Damodaran's
    census or the handful of tickers this installation happens to store."""
    _facts("TGT")
    _bars("TGT", _SERIES)
    panel = build_verdict("TGT")
    for name, row in panel["rows"].items():
        assert row["source"], f"{name} has no source"


def test_the_service_reaches_no_network():
    """bars_loader is injected, so a missed wire is visible rather than silently
    reaching market_data.get_stock_ohlcv, which refreshes live when stale."""
    _facts("TGT")
    calls = []

    def loader(ticker, limit=None):
        calls.append(ticker)
        return [{"date": d, "close": c, "volume": v} for d, c, v in _SERIES]

    build_verdict("TGT", bars_loader=loader)
    assert "TGT" in calls
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_valuation_verdict.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.api.services.valuation_verdict'`.

- [ ] **Step 3: Write the service**

Create `apps/api/services/valuation_verdict.py`:

```python
"""The over/undervaluation evidence panel.

Reports each price-derived signal beside its sector comparison and names the
source that comparison came from. It issues NO label and NO score: collapsing
these signals into one verdict needs weights the data does not contain, and
once collapsed the weighting -- which would BE the verdict -- is invisible to
the reader.

Refusal is per-signal. A panel with three computed rows and one refused row is
a successful result, not an error.
"""

from __future__ import annotations

from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.company_baseline import find_conservative_case_id
from apps.api.services.industry_benchmark_store import resolve_for_ticker
from apps.api.services.peer_set import resolve_peers
from apps.api.services.valuation_case import run_stored_case
from packages.core_finance.price_signals import (
    drawdown_from_peak,
    volume_ratio,
)

DIRECTION = (
    "Testing UNDERVALUATION against the top of the sector. This basis is "
    "anti-conservative for overvaluation: a company that looks expensive "
    "against the best industries in its sector may be reasonably priced "
    "against its actual peers."
)

_RECENT_DAYS = 90
_BASELINE_DAYS = 252


def _row(value=None, comparison=None, *, source, reason=None) -> dict:
    return {"value": value, "comparison": comparison, "source": source, "reason": reason}


def build_verdict(ticker: str, *, bars_loader=load_price_bars) -> dict:
    """Assemble the evidence panel for one ticker.

    `bars_loader` is injected so the whole path is testable without the
    network. Note what a missed injection would NOT hit: the default reads the
    local store and never opens a socket, so `tests/conftest.py`'s network
    guard cannot see one.
    """
    ticker = ticker.upper()
    bars = bars_loader(ticker)
    rows: dict[str, dict] = {}

    peers, peer_reason = resolve_peers(ticker)
    peer_source = f"peers: {len(peers)} stored" if peer_reason is None else "peers"

    closes = [float(b["close"]) for b in bars]
    volumes = [int(b["volume"] or 0) for b in bars]

    # --- drawdown ------------------------------------------------------------
    computed = drawdown_from_peak(closes)
    if computed is None:
        rows["drawdown"] = _row(source=peer_source, reason=f"insufficient_history: {len(bars)} bars")
    elif peer_reason is not None:
        rows["drawdown"] = _row(source=peer_source, reason=peer_reason)
    else:
        pct, peak, index = computed
        peer_pcts = [
            p[0]
            for p in (
                drawdown_from_peak([float(b["close"]) for b in bars_loader(peer)])
                for peer in peers
            )
            if p is not None
        ]
        comparison = (
            f"peer mean {sum(peer_pcts) / len(peer_pcts):.1%}" if peer_pcts else None
        )
        rows["drawdown"] = _row(
            pct, comparison, source=f"peers: {len(peer_pcts)} stored",
        )

    # --- volume --------------------------------------------------------------
    ratio = volume_ratio(volumes, _RECENT_DAYS, _BASELINE_DAYS) or volume_ratio(
        volumes, max(1, len(volumes) // 2), len(volumes)
    )
    if ratio is None:
        rows["volume"] = _row(source=peer_source, reason=f"insufficient_history: {len(bars)} bars")
    elif peer_reason is not None:
        rows["volume"] = _row(source=peer_source, reason=peer_reason)
    else:
        rows["volume"] = _row(ratio, None, source=peer_source)

    # --- trailing PE ---------------------------------------------------------
    benchmark, vintage, bench_reason = resolve_for_ticker(ticker)
    if benchmark is None:
        rows["trailing_pe"] = _row(source="Damodaran", reason=bench_reason)
    elif benchmark.columns.get("trailing_pe") is None:
        rows["trailing_pe"] = _row(
            source="Damodaran", reason=f"no_sector_pe: {vintage} has no trailing_pe"
        )
    else:
        rows["trailing_pe"] = _row(
            None,
            f"sector avg {benchmark.columns['trailing_pe'].value:.1f}",
            source=f"Damodaran {vintage}",
            reason="no_eps",
        )

    # --- DCF gap -------------------------------------------------------------
    case_id = find_conservative_case_id(ticker)
    if case_id is None:
        rows["dcf_gap"] = _row(source="conservative case", reason=f"no_case: {ticker}")
    elif not closes:
        rows["dcf_gap"] = _row(source="conservative case", reason="insufficient_history: 0 bars")
    else:
        intrinsic = run_stored_case(case_id)["value_per_share_diluted"]
        price = closes[-1]
        rows["dcf_gap"] = _row(
            (intrinsic - price) / price,
            f"intrinsic {intrinsic:.2f} vs price {price:.2f}",
            source=f"conservative case #{case_id}",
        )

    return {"ticker": ticker, "direction": DIRECTION, "rows": rows}
```

**Note for the implementer:** `benchmark.columns` is `SectorBenchmark`'s per-column mapping — read `packages/core_finance/industry_benchmark.py` to confirm the attribute name and the `ColumnAverage` field holding the number, and adjust the two `trailing_pe` accesses to match. Do not guess.

- [ ] **Step 4: Run to verify they pass**

Run: `python -m pytest tests/api/test_valuation_verdict.py -v`
Expected: 7 passed.

- [ ] **Step 5: Run the full suite**

Run: `python -m pytest -q`
Expected: 832 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/valuation_verdict.py tests/api/test_valuation_verdict.py
git commit -m "feat: the over/undervaluation evidence panel

Each price-derived signal beside its sector comparison, each naming its
source, each refusing independently. No label and no score: the weights
that would collapse these into one verdict are not in the data, and once
collapsed they would be invisible to the reader.

The direction being tested travels on every panel, as the industry-relative
spec requires."
```

---

### Task 5: The route

**Files:**
- Modify: `apps/api/models/schema_parts/valuation.py` (response models), `apps/api/models/schemas.py` (export)
- Modify: `apps/api/routes/valuation.py`
- Test: `tests/api/test_valuation_routes.py`

**Interfaces:**
- Consumes: `build_verdict`, `DIRECTION` (Task 4); `load_price_bars` (Task 2).
- Produces: `GET /api/v1/valuation/verdict/{ticker}`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_valuation_routes.py`:

```python
def _seed_verdict_inputs(ticker="VERD", industry="Semiconductors"):
    from apps.api.services.db import get_db

    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO corporate_quote_facts "
            "(ticker, market_cap, shares_outstanding, currency, beta, sector, industry, fetched_at) "
            "VALUES (?, 1.0, 1.0, 'USD', 1.0, 'Technology', ?, '2026-01-01')",
            (ticker, industry),
        )
        conn.executemany(
            "INSERT OR REPLACE INTO stocks (ticker, date, open, high, low, close, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            [(ticker, f"2025-01-0{i}", 100.0 + i, 100.0 + i, 100.0 + i, 100.0 + i, i * 100)
             for i in range(1, 6)],
        )


def test_verdict_route_returns_a_panel():
    _seed_verdict_inputs()
    response = client.get("/api/v1/valuation/verdict/VERD")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["ticker"] == "VERD"
    assert "anti-conservative" in data["direction"]
    assert "drawdown" in data["rows"]


def test_verdict_route_is_404_when_nothing_is_stored():
    assert client.get("/api/v1/valuation/verdict/NOTHING").status_code == 404


def test_verdict_route_returns_200_with_refused_rows():
    """A partially refused panel is a successful response -- that is the whole
    point of refusing per signal rather than globally."""
    _seed_verdict_inputs(ticker="LONELY")
    data = client.get("/api/v1/valuation/verdict/LONELY").json()["data"]
    assert data["rows"]["dcf_gap"]["reason"].startswith("no_case")
    assert data["rows"]["drawdown"]["reason"].startswith("peer_set_too_thin")
```

- [ ] **Step 2: Run to verify they fail**

Run: `python -m pytest tests/api/test_valuation_routes.py -k verdict -v`
Expected: FAIL — 404 from an unregistered route on the first test.

- [ ] **Step 3: Add the response models**

In `apps/api/models/schema_parts/valuation.py`, before `class ValuationCaseSummary`:

```python
class VerdictRow(BaseModel):
    """One signal. `value` and `reason` are mutually exclusive."""

    value: float | None = None
    comparison: str | None = None
    source: str
    reason: str | None = None


class VerdictPanel(BaseModel):
    ticker: str
    direction: str
    rows: dict[str, VerdictRow]
```

Export both from `apps/api/models/schemas.py`, adding them to the import block and `__all__`.

- [ ] **Step 4: Add the route**

In `apps/api/routes/valuation.py`, extend the imports and append:

```python
@router.get("/verdict/{ticker}", response_model=APIResponse[VerdictPanel])
def get_valuation_verdict(ticker: str):
    """Evidence about whether a computed gap between price and value is worth acting on.

    Individual rows refuse independently and travel inside this 200 response: a
    panel with three computed rows and one refused row is a successful result.
    A 404 means the ticker has NO stored bars, so there is no panel to build.

    Issues no buy/sell label and no score. See `valuation_verdict.build_verdict`.
    """
    if not load_price_bars(ticker):
        raise HTTPException(status_code=404, detail=f"no stored price bars for {ticker.upper()}")
    return APIResponse(data=VerdictPanel(**build_verdict(ticker)))
```

- [ ] **Step 5: Run to verify they pass**

Run: `python -m pytest tests/api/test_valuation_routes.py -k verdict -v`
Expected: 3 passed.

- [ ] **Step 6: Run the full suite**

Run: `python -m pytest -q`
Expected: 835 passed.

- [ ] **Step 7: Update the change record**

Add an entry to `guideline/sop/todo.md` under a new `## Active Track - Over/Undervaluation Verdict (sub-project 3)` heading placed before `## Archived Track`, recording: what shipped; that the four benchmark columns the industry-relative spec claimed to have stored were not stored, so this track added them as OPTIONAL columns and the PE row refuses until a workbook carrying them is loaded; and that the peer set is a watchlist rather than a sector census, which is why every peer-based row reports its peer count.

- [ ] **Step 8: Commit**

```bash
git add apps/api/routes/valuation.py apps/api/models/ tests/api/test_valuation_routes.py guideline/sop/todo.md
git commit -m "feat: GET /valuation/verdict/{ticker}

Serves the evidence panel. Refused rows travel inside the 200 body; a 404
means no stored bars at all, so there is no panel to build. Declared `def`,
matching every other handler in the app since the threadpool change."
```

---

## Self-Review

**Spec coverage.** Panel shape → Task 4. Pure signals with guards → Task 1. Peer set with `MIN_PEERS = 3` → Task 2. Local-store-only bars → Task 2. Optional benchmark columns → Task 3. Per-signal refusal → Tasks 4 and 5. Mandatory direction statement → Task 4, asserted in its own test. DCF gap from the stored conservative case → Task 4. Route with 404/200 semantics → Task 5. Records → Task 5 Step 7.

**Known gap, deliberately carried.** The spec lists `no_eps` as a refusal reason and describes computing a trailing-PE series from `corporate_statements` EPS. Task 4 wires `trailing_pe_series`/`pe_change` no further than emitting `no_eps`: extracting EPS needs the Yahoo line-item labels confirmed against real stored data, which no fixture in this repo currently carries. **Task 4's implementer must not invent label names.** Closing it is a follow-up once a real bundle can be inspected; the row refuses honestly until then, and Task 1's PE functions are fully tested in isolation so the arithmetic is ready when the labels are known.

**Type consistency.** `_row(...)` returns the four keys `VerdictRow` declares. `bars_loader(ticker, limit=None)` matches `load_price_bars`'s signature. `resolve_peers` returns `(list, reason)` in both its definition and every call. `BenchmarkColumn.required` is used identically in Task 3's three edits.
