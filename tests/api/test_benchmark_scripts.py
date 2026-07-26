import sqlite3
from contextlib import suppress
from pathlib import Path
from uuid import uuid4

from scripts.benchmark_finance import run_finance_benchmarks
from scripts.benchmark_api import run_api_benchmarks
from scripts.benchmark_sqlite import run_sqlite_benchmarks


def _workspace_dir() -> Path:
    path = Path("data/cache/benchmark_tests") / uuid4().hex
    path.mkdir(parents=True, exist_ok=True)
    return path


def _remove_tree(path: Path) -> None:
    with suppress(FileNotFoundError, PermissionError):
        for child in path.rglob("*"):
            if child.is_file():
                child.unlink()
        for child in sorted(path.rglob("*"), reverse=True):
            if child.is_dir():
                child.rmdir()
        path.rmdir()


def _create_benchmark_db(db_path: Path) -> None:
    with sqlite3.connect(str(db_path)) as conn:
        conn.executescript(
            """
            CREATE TABLE stocks (
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                close REAL,
                volume INTEGER
            );
            CREATE TABLE indices (
                ticker TEXT NOT NULL,
                date TEXT NOT NULL,
                close REAL
            );
            CREATE TABLE indicators (
                category TEXT,
                code TEXT,
                value REAL,
                date TEXT
            );
            CREATE TABLE watchlist (
                ticker TEXT,
                sector TEXT,
                group_name TEXT
            );
            INSERT INTO stocks VALUES ('AAPL', '2025-01-01', 100.0, 1000);
            INSERT INTO stocks VALUES ('AAPL', '2025-01-02', 101.0, 1100);
            INSERT INTO indices VALUES ('SPX', '2025-01-01', 5000.0);
            INSERT INTO indicators VALUES ('macro', 'RATE', 1.5, '2025-01-01');
            INSERT INTO watchlist VALUES ('AAPL', 'Technology', 'custom');
            """
        )


def test_sqlite_benchmark_smoke():
    work_dir = _workspace_dir()
    try:
        db_path = work_dir / "moneyview.db"
        _create_benchmark_db(db_path)

        results = run_sqlite_benchmarks(db_path=db_path, work_dir=work_dir, iterations=1, write_rows=5)

        names = {result.name for result in results}
        assert "read:stocks-count" in names
        assert "write:temp-insert-schema-b" in names
        assert all(result.avg_ms >= 0 for result in results)
    finally:
        _remove_tree(work_dir)


def test_finance_benchmark_smoke():
    results = run_finance_benchmarks(iterations=1, monte_carlo_runs=50, vector_size=50, seed=7)

    names = {result.name for result in results}
    assert "core_finance:npv-10-cashflows" in names
    assert any(name.startswith("maths:brinson-fachler") for name in names)
    assert any(name.startswith("market:technical-indicators") for name in names)
    assert "corporate:stable-growth-5-years" in names
    assert "corporate:roic-records-5-years" in names
    assert all(result.avg_ms >= 0 for result in results)


def test_api_benchmark_smoke():
    results = run_api_benchmarks(iterations=1)

    names = {result.name for result in results}
    assert "GET /api/v1/corporate/metrics/AAPL" in names
    assert "POST /api/v1/corporate/dcf/AAPL" in names
    assert "GET /api/v1/corporate/comparison?mode=live" in names
    assert "POST /api/v1/portfolio/attribution" in names
    assert "GET /api/v1/detail/AAPL/technicals?period=5y" in names
    assert "GET /api/v1/detail/AAPL/monte-carlo?paths=1000&horizon_days=252" in names
    assert all(result.status_code == 200 for result in results)


_ENVIRONMENT = {"watchlist": 138, "stocks_rows": 120647, "db_bytes": 27_000_000,
                "event_limit": 20000, "compute_mode": "in_process", "git_sha": "abc1234"}


def test_benchmark_scenarios_module_exposes_scenarios_and_report():
    import scripts.benchmark_scenarios as runner

    assert set(runner.SCENARIOS) == {
        "portfolio_page_load",
        "comparison_138",
        "attribution_138",
        "single_stock_detail",
        "tab_switch",
    }
    assert callable(runner.render_report)
    assert callable(runner.collect_environment)


def test_report_stamps_every_criterion():
    import scripts.benchmark_scenarios as runner

    report = runner.render_report(
        environment={"watchlist": 138, "stocks_rows": 120647, "db_bytes": 27_000_000,
                     "event_limit": 20000, "compute_mode": "in_process", "git_sha": "abc1234"},
        results=[
            runner.ScenarioResult(
                name="comparison_138", p50_off_ms=3180.0, p50_on_ms=3271.0, p95_on_ms=3410.0,
                iterations=10, breakdown=None, ticker_table=None, orphans=0,
                partial=False, truncated=False, reproducibility_delta_pct=2.0,
            )
        ],
    )
    for criterion in ["criterion 1", "criterion 2", "criterion 3", "criterion 4", "criterion 5"]:
        assert criterion in report.lower()


def test_report_ranks_operations_and_renders_cache_section():
    """Criterion 5 ranks operations, not tickers (spec 08.5), and the cache section
    must appear even when every miss cost is unmeasured, so a 0.0 reads as a known
    gap rather than as a measured zero."""
    import scripts.benchmark_scenarios as runner
    from apps.api.models.schema_parts.perf_analysis import (
        CacheReport,
        CacheRow,
        ScopeBreakdown,
        ScopeRow,
    )

    report = runner.render_report(
        environment={"watchlist": 138, "stocks_rows": 120647, "db_bytes": 27_000_000,
                     "event_limit": 20000, "compute_mode": "in_process", "git_sha": "abc1234"},
        results=[
            runner.ScenarioResult(
                name="comparison_138", p50_off_ms=3180.0, p50_on_ms=3271.0, p95_on_ms=3410.0,
                iterations=10,
                breakdown=ScopeBreakdown(
                    scopes=[ScopeRow(scope="db", self_ms=892.0, pct_of_total=28.0,
                                     event_count=138, slow_count=0)],
                    total_ms=3180.0, unattributed_ms=0.0,
                ),
                ticker_table=None, orphans=0, partial=False, truncated=False,
                reproducibility_delta_pct=2.0,
                cache_report=CacheReport(caches=[
                    CacheRow(component="statement_metrics", hits=3, misses=1, hit_rate=0.75,
                             avg_miss_cost_ms=0.0, estimated_time_saved_ms=0.0),
                ]),
                top_spans=[runner.OperationCost(
                    operation="db.select_corporate_metrics", self_ms=892.0, count=138,
                )],
            )
        ],
    )
    assert "Top spans by self time" in report
    assert "db.select_corporate_metrics" in report
    assert "6.5 ms" in report  # 892 ms / 138 calls
    assert "statement_metrics" in report
    assert "unmeasured, not zero" in report


def test_criterion_5_ranks_leaves_not_parents():
    """A parent's self time is only what its children did not account for, so ranking
    parents names a call tree rather than code to change. page_load.portfolio taking
    76% of a request is a nesting artefact, not a cost centre."""
    import scripts.benchmark_scenarios as runner

    parent = runner.OperationCost(operation="page_load.portfolio", self_ms=11718.0, count=60, leaf_count=0)
    leaf = runner.OperationCost(operation="db.select_stocks", self_ms=603.1, count=2780, leaf_count=2780)
    assert parent.kind == "parent"
    assert leaf.kind == "leaf"

    report = runner.render_report(
        environment=_ENVIRONMENT,
        results=[
            runner.ScenarioResult(
                name="portfolio_page_load", p50_off_ms=515.0, p50_on_ms=594.3, p95_on_ms=624.6,
                iterations=20, breakdown=None, ticker_table=None, orphans=0, partial=False,
                truncated=False, reproducibility_delta_pct=1.6,
                top_spans=[parent, leaf], leaf_spans=[leaf],
            )
        ],
    )
    ranked = report.split("## Ranked bottlenecks")[1]
    assert "db.select_stocks" in ranked
    assert "page_load.portfolio" not in ranked, "a parent span must not be ranked as a bottleneck"


def test_report_explains_overlap_and_reports_span_counts():
    """`overlap_detected: True` is unreadable as good or bad without a note, and an
    overhead percentage is illegible without the span count that drives it."""
    import scripts.benchmark_scenarios as runner

    report = runner.render_report(
        environment=_ENVIRONMENT,
        results=[
            runner.ScenarioResult(
                name="tab_switch", p50_off_ms=711.1, p50_on_ms=837.8, p95_on_ms=900.0,
                iterations=20, breakdown=None, ticker_table=None, orphans=0, partial=False,
                truncated=False, reproducibility_delta_pct=2.0, overlap_detected=True,
                event_count=21347, span_count=18000,
                samples_on=[830.0, 840.0, 835.0, 845.0],
                critical_path=[("api.request_start", 837.8), ("db.select_indices", 640.0)],
                slowest_request_ms=837.8,
            )
        ],
    )
    assert "invalidates criterion 2" in report          # item 4
    assert "95% CI" in report                            # item 5
    assert "scales" in report and "span" in report       # item 6
    assert "21347 events" in report                      # item 7
    assert "Critical path" in report                     # item 12
    assert "db.select_indices" in report


def test_criteria_gate_covers_unattributed_and_partial():
    """Spec 08.6: exit non-zero when ANY of criteria 1-4 fail. Criterion 2
    (unattributed) and the `partial` half of criterion 3 were stamped in the report
    but left out of the gate."""
    import scripts.benchmark_scenarios as runner
    from apps.api.models.schema_parts.perf_analysis import ScopeBreakdown

    def _result(**overrides):
        defaults = dict(
            name="x", p50_off_ms=100.0, p50_on_ms=101.0, p95_on_ms=110.0, iterations=10,
            breakdown=None, ticker_table=None, orphans=0, partial=False, truncated=False,
            reproducibility_delta_pct=1.0,
        )
        return runner.ScenarioResult(**{**defaults, **overrides})

    assert runner.criteria_failed([_result()]) is False

    unattributed = _result(breakdown=ScopeBreakdown(total_ms=100.0, unattributed_ms=50.0))
    assert unattributed.unattributed_pct == 50.0
    assert runner.criteria_failed([unattributed]) is True

    assert runner.criteria_failed([_result(partial=True)]) is True
