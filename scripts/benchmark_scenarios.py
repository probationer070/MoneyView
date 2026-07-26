"""Baseline runner for the performance instrumentation spec.

Runs each scenario twice -- MONEYVIEW_DEV_MONITOR off then on -- so overhead is
derived from the difference rather than assumed. Consumes the same public
analysis functions the routes use, so this report and the dashboard cannot
disagree.

Environment metadata (watchlist size, DB counts, git SHA) is collected HERE, not
by the analysis layer, which performs no I/O (spec 08.4.1).

Usage:
    python scripts/benchmark_scenarios.py
    python scripts/benchmark_scenarios.py comparison_138
    python scripts/benchmark_scenarios.py --iterations 5
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Callable

from fastapi.testclient import TestClient

# Running `python scripts/benchmark_scenarios.py` puts scripts/ on sys.path, not
# the repo root, so `apps` would not import. Documented usage runs it this way.
_REPO_ROOT = str(Path(__file__).resolve().parent.parent)
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)

# Must precede the first `apps` import: corporate_statement_metrics reads both of these
# into module-level constants and builds its TTLCache at import time.
#
# TWO independent defaults each force a 0% statement-cache hit rate on a 138-ticker
# fan-out, so both must be raised or the timed iterations measure Yahoo network latency
# instead of the DB+compute cost this baseline exists to measure:
#   ttl=300s     < one 138-ticker sweep (measured 357s), so ticker #1 expires before
#                  ticker #138 is fetched.
#   maxsize=48   < the 139-ticker universe, so the sweep evicts its own first 90
#                  entries before it finishes -- capacity alone defeats any TTL.
# Recorded as production defects in ERROR-LOG.md; raising them here only stops them
# from corrupting the measurement.
STATEMENT_CACHE_TTL_SECONDS = "86400"
STATEMENT_CACHE_MAXSIZE = "4096"
os.environ.setdefault("MONEYVIEW_YAHOO_STATEMENT_CACHE_TTL_SECONDS", STATEMENT_CACHE_TTL_SECONDS)
os.environ.setdefault("MONEYVIEW_YAHOO_STATEMENT_CACHE_MAXSIZE", STATEMENT_CACHE_MAXSIZE)

# Imported after the bootstrap above. Models only -- reads no environment, so it
# cannot race the MONEYVIEW_DEV_MONITOR toggling in run_pass().
from apps.api.models.schema_parts.perf_analysis import CollapsedNode  # noqa: E402

OVERHEAD_BUDGET_PCT = 3.0
UNATTRIBUTED_BUDGET_PCT = 15.0
REPRODUCIBILITY_BUDGET_PCT = 10.0

# Spec 08.7: the fan-out distribution classification is the hand-off to sub-project 2.
HANDOFF_BY_DISTRIBUTION = {
    "uniform": "structural fix indicated (batched queries, per-ticker memoization, or "
               "parallelism); the per-stock table is not worth reading row by row",
    "skewed": "start from the named outlier tickers in the per-stock table -- bad data, "
              "missing statements, or a slow fallback path for specific stocks",
    "mixed": "both, ranked by the top-spans table: outlier tickers first, then the "
             "structural fix",
    "unknown": "no fan-out data captured for this scenario",
}


@dataclass
class Scenario:
    name: str
    run: Callable[[TestClient], None]
    iterations: int


@dataclass
class OperationCost:
    """Self time aggregated per operation, read off the waterfall trees (spec 08.5)."""

    operation: str
    self_ms: float
    count: int

    @property
    def per_call_ms(self) -> float:
        return round(self.self_ms / self.count, 1) if self.count else 0.0


@dataclass
class ScenarioResult:
    name: str
    p50_off_ms: float
    p50_on_ms: float
    p95_on_ms: float
    iterations: int
    breakdown: object | None
    ticker_table: object | None
    orphans: int
    partial: bool
    truncated: bool
    reproducibility_delta_pct: float
    cache_report: object | None = None
    top_spans: list[OperationCost] = field(default_factory=list)
    overlap_detected: bool = False

    @property
    def overhead_pct(self) -> float:
        if self.p50_off_ms <= 0:
            return 0.0
        return round((self.p50_on_ms - self.p50_off_ms) / self.p50_off_ms * 100.0, 1)

    @property
    def unattributed_pct(self) -> float:
        breakdown = self.breakdown
        if breakdown is None or not breakdown.total_ms:
            return 0.0
        return round(breakdown.unattributed_ms / breakdown.total_ms * 100.0, 1)


def _portfolio_page_load(client: TestClient) -> None:
    for endpoint in [
        "/api/v1/portfolio/watchlist",
        "/api/v1/corporate/companies",
        "/api/v1/portfolio/watchlist/sync-status",
        "/api/v1/portfolio/preferences",
    ]:
        client.get(endpoint)


def _comparison_138(client: TestClient) -> None:
    client.get("/api/v1/corporate/comparison?mode=live")


def _attribution_138(client: TestClient) -> None:
    watchlist = client.get("/api/v1/portfolio/watchlist").json()
    tickers = [row["ticker"] for row in watchlist]
    weights = [row["weight"] for row in watchlist]
    client.post(
        "/api/v1/portfolio/attribution",
        json={
            "tickers": tickers, "weights": weights, "benchmark": "^GSPC",
            "period": "5y", "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True, "allow_benchmark_proxy": True,
        },
    )


def _single_stock_detail(client: TestClient) -> None:
    ticker = "AAPL"
    client.get(f"/api/v1/corporate/metrics/{ticker}")
    client.get(f"/api/v1/corporate/metrics/{ticker}/history")
    client.get(f"/api/v1/corporate/metrics/{ticker}/quarterly-statements")
    client.get(f"/api/v1/corporate/metrics/{ticker}/audit")


def _tab_switch(client: TestClient) -> None:
    client.get("/api/v1/market/indices")
    client.get("/api/v1/portfolio/watchlist")
    client.get("/api/v1/corporate/companies")


SCENARIOS: dict[str, Scenario] = {
    "portfolio_page_load": Scenario("portfolio_page_load", _portfolio_page_load, 20),
    "comparison_138": Scenario("comparison_138", _comparison_138, 10),
    "attribution_138": Scenario("attribution_138", _attribution_138, 10),
    "single_stock_detail": Scenario("single_stock_detail", _single_stock_detail, 20),
    "tab_switch": Scenario("tab_switch", _tab_switch, 20),
}


def collect_environment() -> dict:
    """Runner-owned. Analysis performs no I/O and never sees these values."""
    from apps.api.core.dev_monitor import get_dev_monitor_event_limit

    db_path = Path(os.getenv("DB_PATH", "data/processed/moneyview.db"))
    watchlist = stocks_rows = 0
    if db_path.exists():
        connection = sqlite3.connect(str(db_path))
        try:
            watchlist = connection.execute("SELECT COUNT(*) FROM watchlist").fetchone()[0]
            stocks_rows = connection.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
        finally:
            connection.close()
    try:
        git_sha = subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], text=True).strip()
    except (subprocess.SubprocessError, OSError):
        git_sha = "unknown"
    return {
        "watchlist": watchlist,
        "stocks_rows": stocks_rows,
        "db_bytes": db_path.stat().st_size if db_path.exists() else 0,
        "event_limit": get_dev_monitor_event_limit(),
        "compute_mode": os.getenv("MONEYVIEW_COMPUTE_MODE", "in_process"),
        "git_sha": git_sha,
    }


def run_pass(scenario: Scenario, *, instrumented: bool, iterations: int) -> tuple[list[float], list]:
    os.environ["MONEYVIEW_DEV_MONITOR"] = "true" if instrumented else ""
    from apps.api.core import dev_monitor

    dev_monitor.reset_dev_monitor_sink()
    from apps.api.main import app

    # The runner fires tight bursts (up to ~84 calls/pass) that a real user never
    # would, purely to measure compute latency. The process-wide DoS limiter
    # (rate=10/s, capacity=50) would otherwise start returning fast 429s partway
    # through a scenario and corrupt the baseline. Neutralise it in this process
    # -- production runs in a separate process and is unaffected.
    from apps.api.core import middleware

    middleware.limiter.rate = 1_000_000.0
    middleware.limiter.capacity = 1_000_000.0
    middleware.limiter.clients.clear()

    # Freeze OHLCV freshness so cached rows are served without a live yfinance
    # refetch. The test DB is months stale, so every request would otherwise
    # refetch the whole universe live -- measuring network latency and delisted-
    # ticker 404s instead of the DB+compute fan-out this baseline exists to
    # measure (which is what production, with current daily data, actually runs).
    # Both gates must be forced: _rows_are_fresh (date) and _rows_cover_period
    # (span), since the DB holds only ~2y/ticker while 5y scenarios demand more.
    from apps.api.services.market_data import MarketDataService

    MarketDataService._rows_are_fresh = lambda self, rows: True
    MarketDataService._rows_cover_period = lambda self, rows, period: True

    samples: list[float] = []
    # A benchmark harness measures whatever the endpoint returns; a 500 is a data
    # point, not a reason to abort the run. Without this, a single failing surface
    # (e.g. /market/indices serialising a NaN) crashes the whole baseline.
    with TestClient(app, raise_server_exceptions=False) as client:
        scenario.run(client)  # warm-up, untimed -- fills caches; excluded from analysis
        # Snapshot the sink cursor AFTER warm-up so analyse() sees only the timed
        # iterations. The warm-up call, on a cold cache, triggers a full universe
        # refresh whose events would otherwise dominate the scope/ticker breakdown.
        cursor = 0
        if instrumented:
            cursor = dev_monitor.get_dev_monitor_sink().events_after(2**62)[0]
        for _ in range(iterations):
            started = time.perf_counter()
            scenario.run(client)
            samples.append((time.perf_counter() - started) * 1000.0)
    events = []
    if instrumented:
        sink = dev_monitor.get_dev_monitor_sink()
        sink.flush()  # must precede any read of persisted events
        _, events = sink.events_after(cursor)
    return samples, events


def _p(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int(len(ordered) * fraction) - 1))
    return round(ordered[index], 1)


def _flatten(node) -> list:
    """Depth-first SpanNode list.

    CollapsedNode children carry no operation or self time; their cost is already
    accounted for by `truncated`, which fails criterion 3 on its own.
    """
    if isinstance(node, CollapsedNode):
        return []
    nodes = [node]
    for child in node.children:
        nodes.extend(_flatten(child))
    return nodes


def _waterfall_diagnostics(events: list) -> dict:
    """Criterion 3 diagnostics and the per-operation rollup, both read off
    `RequestWaterfall` rather than recomputed here, so this report and the
    dashboard cannot disagree (spec 08.1, 08.4 criterion 3).
    """
    from apps.api.services.perf_analysis import SYNTHETIC_ROOT_ID, build_waterfall

    by_request: dict[str, list] = {}
    for event in events:
        if event.request_id:
            by_request.setdefault(event.request_id, []).append(event)

    orphans = 0
    partial = truncated = overlap_detected = False
    self_ms_by_operation: dict[str, list[float]] = {}
    for request_id, scoped in by_request.items():
        waterfall = build_waterfall(scoped, request_id)
        partial = partial or waterfall.partial
        truncated = truncated or waterfall.truncated
        overlap_detected = overlap_detected or waterfall.overlap_detected
        for node in _flatten(waterfall.root):
            if node.id == SYNTHETIC_ROOT_ID:
                continue  # "(request)" / "(no spans)" placeholder, not a real operation
            if node.orphaned:
                orphans += 1
            self_ms_by_operation.setdefault(node.operation, []).append(node.self_ms or 0.0)

    top_spans = sorted(
        (
            OperationCost(operation=operation, self_ms=round(sum(values), 1), count=len(values))
            for operation, values in self_ms_by_operation.items()
        ),
        key=lambda row: row.self_ms,
        reverse=True,
    )
    return {
        "orphans": orphans,
        "partial": partial,
        "truncated": truncated,
        "overlap_detected": overlap_detected,
        "top_spans": top_spans,
    }


def analyse(events: list) -> dict:
    """Calls the same public analysis functions the routes use (spec 08.1)."""
    from apps.api.services.perf_analysis import (
        breakdown_by_scope,
        cache_effectiveness,
        rollup_by_ticker,
    )

    analysis = {
        "breakdown": breakdown_by_scope(events),
        "ticker_table": rollup_by_ticker(events),
        "cache_report": cache_effectiveness(events),
    }
    analysis.update(_waterfall_diagnostics(events))
    return analysis


def criteria_failed(results: list[ScenarioResult]) -> bool:
    """Criteria 1-4 gate the exit code, so the runner is usable as a gate
    without modification (spec 08.6). Criterion 5 is the deliverable, not a check.
    """
    return any(
        result.overhead_pct > OVERHEAD_BUDGET_PCT                       # 1
        or result.unattributed_pct > UNATTRIBUTED_BUDGET_PCT            # 2
        or result.orphans > 0 or result.partial                         # 3
        or result.reproducibility_delta_pct > REPRODUCIBILITY_BUDGET_PCT  # 4
        for result in results
    )


def _stamp(passed: bool) -> str:
    return "PASS" if passed else "FAIL"


def _progress(message: str) -> None:
    """Stderr, so stdout stays the report path alone."""
    print(message, file=sys.stderr, flush=True)


def render_report(*, environment: dict, results: list[ScenarioResult]) -> str:
    lines = [
        f"# Performance Baseline — {date.today().isoformat()}",
        "",
        "## Environment",
        f"watchlist: {environment['watchlist']} tickers · stocks: {environment['stocks_rows']} rows · "
        f"db: {environment['db_bytes'] / 1_000_000:.1f} MB",
        f"event limit: {environment['event_limit']} · compute mode: {environment['compute_mode']}",
        f"git: {environment['git_sha']}",
        "",
        "## Measurement conditions",
        "Three in-process conditions, disclosed here because they change what is being",
        "measured, and two reports are only comparable if these match (spec 08.2):",
        "",
        "- **OHLCV freshness frozen** (`_rows_are_fresh` and `_rows_cover_period` forced true):",
        "  cached price rows are served without a live yfinance refetch. Without this, a stale",
        "  local dataset makes every request refetch the whole universe, measuring network",
        "  latency and delisted-ticker 404s instead of the DB+compute fan-out. Production, on",
        "  current daily data, takes the frozen path.",
        "- **Global rate limiter neutralised**: the runner fires bursts no real user would, and",
        "  429s would otherwise truncate a scenario partway through.",
        f"- **Statement cache TTL raised to {STATEMENT_CACHE_TTL_SECONDS}s** (default 300s) **and maxsize to",
        f"  {STATEMENT_CACHE_MAXSIZE}** (default 48), so the untimed warm-up's 138 live Yahoo fetches survive into",
        "  the timed iterations. At the defaults the cache scores a measured **0% hit rate** on this",
        "  fan-out, for two independent reasons: one 138-ticker sweep takes ~357s so ticker #1",
        "  expires before #138 is fetched, and maxsize 48 < 139 tickers so the sweep evicts its own",
        "  first 90 entries anyway. Without both raised the timed samples measure Yahoo network",
        "  latency, not the DB+compute fan-out. **Production still runs the defaults**, so the p50",
        "  below is the warm-cache cost and is NOT what a user experiences today -- see ERROR-LOG.md.",
        "",
        "## Overhead (criterion 1: <= 3%)",
        "| scenario | p50 off | p50 on | overhead | |",
        "| --- | --- | --- | --- | --- |",
    ]
    for result in results:
        lines.append(
            f"| {result.name} | {result.p50_off_ms:.1f}ms | {result.p50_on_ms:.1f}ms | "
            f"{result.overhead_pct}% | {_stamp(result.overhead_pct <= OVERHEAD_BUDGET_PCT)} |"
        )

    for result in results:
        lines += ["", f"## Scenario: {result.name}",
                  f"p50 {result.p50_on_ms:.1f} ms · p95 {result.p95_on_ms:.1f} ms · N={result.iterations}"]
        breakdown = result.breakdown
        lines += ["", "### Scope breakdown (self time) — criterion 2: unattributed <= 15%"]
        if breakdown is not None:
            lines += ["| scope | self_ms | pct |", "| --- | --- | --- |"]
            for scope in breakdown.scopes:
                lines.append(f"| {scope.scope} | {scope.self_ms} | {scope.pct_of_total}% |")
            unattributed_pct = (
                breakdown.unattributed_ms / breakdown.total_ms * 100.0 if breakdown.total_ms else 0.0
            )
            lines.append(
                f"| unattributed | {breakdown.unattributed_ms} | {unattributed_pct:.1f}% | "
                f"{_stamp(unattributed_pct <= UNATTRIBUTED_BUDGET_PCT)}"
            )
        else:
            lines.append("_no span data captured_")

        request_ms = breakdown.total_ms if breakdown is not None else 0.0
        if result.top_spans:
            lines += ["", "### Top spans by self time",
                      "| operation | self_ms | count | per-call | pct of request |",
                      "| --- | --- | --- | --- | --- |"]
            for row in result.top_spans[:10]:
                pct = f"{row.self_ms / request_ms * 100.0:.1f}%" if request_ms else "n/a"
                lines.append(
                    f"| {row.operation} | {row.self_ms} | {row.count} | {row.per_call_ms} ms | {pct} |"
                )

        table = result.ticker_table
        if table is not None and table.ticker_count:
            outliers = sum(1 for row in table.rows if row.self_ms > table.p95_ms)
            lines += ["", "### Per-stock cost",
                      f"{table.ticker_count} tickers · distribution: {table.distribution} (cv {table.cv})",
                      f"p50 {table.p50_ms} ms · p95 {table.p95_ms} ms · max {table.max_ms} ms",
                      f"outliers (>p95): {outliers}"]

        cache_report = result.cache_report
        lines += ["", "### Cache effectiveness"]
        if cache_report is not None and cache_report.caches:
            lines += ["| component | hits | misses | hit_rate | avg_miss_ms | est. saved_ms |",
                      "| --- | --- | --- | --- | --- | --- |"]
            for row in cache_report.caches:
                lines.append(
                    f"| {row.component} | {row.hits} | {row.misses} | {row.hit_rate} | "
                    f"{row.avg_miss_cost_ms} | {row.estimated_time_saved_ms} |"
                )
            if all(row.avg_miss_cost_ms == 0.0 for row in cache_report.caches):
                lines += ["", "_Every `avg_miss_cost_ms` is 0.0 because cache miss events carry no "
                          "`duration_ms`: the miss cost and the time saved are **unmeasured, not zero**. "
                          "The hit and miss counts above are real. Timing the miss path is the next span._"]
        else:
            lines.append("_no cache events captured_")

        lines += ["", "### Diagnostics",
                  f"orphans: {result.orphans} · partial: {result.partial} · "
                  f"truncated: {result.truncated} · overlap_detected: {result.overlap_detected} "
                  f"— criterion 3: {_stamp(result.orphans == 0 and not result.partial)}",
                  f"reproducibility delta {result.reproducibility_delta_pct}% "
                  f"— criterion 4: {_stamp(result.reproducibility_delta_pct <= REPRODUCIBILITY_BUDGET_PCT)}"]

    lines += ["", "## Ranked bottlenecks (criterion 5)"]
    for result in results:
        if not result.top_spans:
            continue
        table = result.ticker_table
        distribution = table.distribution if table is not None and table.ticker_count else "unknown"
        request_ms = result.breakdown.total_ms if result.breakdown is not None else 0.0
        lines += ["", f"### {result.name} — fan-out distribution: {distribution}"]
        for rank, row in enumerate(result.top_spans[:5], start=1):
            share = f", {row.self_ms / request_ms * 100.0:.0f}% of request" if request_ms else ""
            lines.append(
                f"{rank}. {row.operation} — {row.self_ms} ms self across {row.count} calls "
                f"({row.per_call_ms} ms/call{share})"
            )
        lines.append(f"   -> {HANDOFF_BY_DISTRIBUTION[distribution]}")
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    override = None
    positional: list[str] = []
    index = 0
    while index < len(argv):
        arg = argv[index]
        if arg == "--iterations":
            override = int(argv[index + 1])
            index += 2
            continue
        if arg.startswith("--"):
            index += 1
            continue
        positional.append(arg)
        index += 1
    names = positional or list(SCENARIOS)

    environment = collect_environment()
    results: list[ScenarioResult] = []
    for name in names:
        scenario = SCENARIOS[name]
        iterations = override or scenario.iterations
        _progress(f"[{name}] pass A: uninstrumented, N={iterations}")
        off_samples, _ = run_pass(scenario, instrumented=False, iterations=iterations)
        _progress(f"[{name}] pass B: instrumented, N={iterations}")
        on_samples, events = run_pass(scenario, instrumented=True, iterations=iterations)
        _progress(f"[{name}] pass C: reproducibility repeat, N={iterations}")
        repeat_samples, _ = run_pass(scenario, instrumented=True, iterations=iterations)
        analysis = analyse(events)
        first = _p(on_samples, 0.5)
        second = _p(repeat_samples, 0.5)
        delta = round(abs(second - first) / first * 100.0, 1) if first else 0.0
        results.append(
            ScenarioResult(
                name=name,
                p50_off_ms=_p(off_samples, 0.5),
                p50_on_ms=first,
                p95_on_ms=_p(on_samples, 0.95),
                iterations=iterations,
                breakdown=analysis["breakdown"],
                ticker_table=analysis["ticker_table"],
                orphans=analysis["orphans"],
                partial=analysis["partial"],
                truncated=analysis["truncated"],
                reproducibility_delta_pct=delta,
                cache_report=analysis["cache_report"],
                top_spans=analysis["top_spans"],
                overlap_detected=analysis["overlap_detected"],
            )
        )
        _progress(f"[{name}] p50 off {_p(off_samples, 0.5)} ms · on {first} ms · "
                  f"overhead {results[-1].overhead_pct}%")

    report = render_report(environment=environment, results=results)
    output_dir = Path("docs/perf")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{date.today().isoformat()}-baseline.md"
    output_path.write_text(report, encoding="utf-8")
    print(f"wrote {output_path}")
    return 1 if criteria_failed(results) else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
