"""
Benchmark Python/NumPy financial functions for MoneyView.

This script establishes a local baseline before considering Rust/PyO3/WASM.
It uses deterministic inputs and does not require external data.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.core.maths import (  # noqa: E402
    brinson_fachler_arithmetic,
    calculate_portfolio_beta,
    historical_expected_shortfall,
    historical_var,
)
from packages.core_finance import (  # noqa: E402
    bottom_up_beta,
    calculate_crp,
    calculate_npv,
    calculate_wacc,
    monte_carlo_npv,
    multi_stage_dcf,
    wacc_sensitivity,
)


@dataclass
class FinanceBenchmarkResult:
    name: str
    iterations: int
    total_ms: float
    avg_ms: float
    median_ms: float
    min_ms: float
    max_ms: float
    output_summary: str = ""


def _time_call(name: str, iterations: int, func) -> FinanceBenchmarkResult:
    durations: list[float] = []
    output = None
    for _ in range(iterations):
        start = time.perf_counter()
        output = func()
        durations.append((time.perf_counter() - start) * 1000)

    return FinanceBenchmarkResult(
        name=name,
        iterations=iterations,
        total_ms=round(sum(durations), 3),
        avg_ms=round(statistics.mean(durations), 3),
        median_ms=round(statistics.median(durations), 3),
        min_ms=round(min(durations), 3),
        max_ms=round(max(durations), 3),
        output_summary=_summarize_output(output),
    )


def _summarize_output(output) -> str:
    if isinstance(output, dict):
        keys = ",".join(list(output.keys())[:5])
        return f"dict[{keys}]"
    if isinstance(output, (float, int, np.floating)):
        return f"{float(output):.6f}"
    if isinstance(output, list):
        return f"list[{len(output)}]"
    if hasattr(output, "allocation"):
        return f"effects[{len(output.allocation)}]"
    return type(output).__name__


def _npv_function(revenue_growth: float, margin: float, wacc: float, terminal_growth: float) -> float:
    base_revenue = 1_000.0
    cash_flows = []
    for year in range(1, 6):
        revenue = base_revenue * (1 + revenue_growth) ** year
        cash_flows.append(revenue * margin)
    terminal_cf = cash_flows[-1] * (1 + terminal_growth)
    return multi_stage_dcf(cash_flows, terminal_cf, wacc, terminal_growth)["enterprise_value"]


def run_finance_benchmarks(iterations: int, monte_carlo_runs: int, vector_size: int, seed: int) -> list[FinanceBenchmarkResult]:
    rng = np.random.default_rng(seed)
    portfolio_returns = rng.normal(0.0004, 0.012, size=vector_size)
    benchmark_returns = rng.normal(0.00035, 0.010, size=vector_size)
    returns = rng.normal(0.0003, 0.011, size=vector_size)

    segment_count = max(10, min(vector_size, 2000))
    wp_raw = rng.uniform(0.0, 1.0, size=segment_count)
    wb_raw = rng.uniform(0.0, 1.0, size=segment_count)
    wp = wp_raw / wp_raw.sum()
    wb = wb_raw / wb_raw.sum()
    rp = rng.normal(0.04, 0.08, size=segment_count)
    rb = rng.normal(0.035, 0.07, size=segment_count)
    rb_total = float(np.dot(wb, rb))

    cash_flows = [100 + idx * 8 for idx in range(10)]
    peers = [
        {"levered_beta": 0.8 + idx * 0.01, "tax_rate": 0.21, "de_ratio": 0.2 + idx * 0.01}
        for idx in range(50)
    ]
    variable_ranges = {
        "revenue_growth": (0.05, 0.015, "normal"),
        "margin": (0.18, 0.025, "normal"),
        "wacc": (0.085, 0.01, "normal"),
        "terminal_growth": (0.025, 0.005, "normal"),
    }
    base_inputs = {
        "revenue_growth": 0.05,
        "margin": 0.18,
        "wacc": 0.085,
        "terminal_growth": 0.025,
    }

    return [
        _time_call("core_finance:npv-10-cashflows", iterations, lambda: calculate_npv(cash_flows, 0.09)),
        _time_call(
            "core_finance:multi-stage-dcf",
            iterations,
            lambda: multi_stage_dcf(cash_flows, terminal_cf=220.0, wacc=0.09, terminal_growth=0.025),
        ),
        _time_call(
            "core_finance:bottom-up-beta-50-peers",
            iterations,
            lambda: bottom_up_beta(peers, target_tax_rate=0.21, target_de_ratio=0.45),
        ),
        _time_call(
            "core_finance:wacc-sensitivity-21-points",
            iterations,
            lambda: wacc_sensitivity(0.11, 0.055, 0.21, 10_000.0),
        ),
        _time_call("core_finance:crp", iterations, lambda: calculate_crp(0.02, 0.24, 0.12)),
        _time_call(
            "core_finance:wacc",
            iterations,
            lambda: calculate_wacc(0.11, 0.055, 0.21, 10_000.0, 4_500.0),
        ),
        _time_call(
            f"core_finance:monte-carlo-npv-{monte_carlo_runs}",
            max(1, min(iterations, 5)),
            lambda: monte_carlo_npv(base_inputs, variable_ranges, _npv_function, n_simulations=monte_carlo_runs, seed=seed),
        ),
        _time_call(
            f"maths:brinson-fachler-{segment_count}",
            iterations,
            lambda: brinson_fachler_arithmetic(wp, wb, rp, rb, rb_total),
        ),
        _time_call(
            f"maths:portfolio-beta-{vector_size}",
            iterations,
            lambda: calculate_portfolio_beta(portfolio_returns, benchmark_returns),
        ),
        _time_call(
            f"maths:historical-var-{vector_size}",
            iterations,
            lambda: historical_var(returns, confidence_level=0.95, horizon_days=1),
        ),
        _time_call(
            f"maths:historical-es-{vector_size}",
            iterations,
            lambda: historical_expected_shortfall(returns, confidence_level=0.95, horizon_days=1),
        ),
    ]


def _print_results(results: list[FinanceBenchmarkResult]) -> None:
    print("MoneyView Python/NumPy finance benchmark")
    for item in results:
        print(
            f"- {item.name}: iterations={item.iterations}, avg_ms={item.avg_ms}, "
            f"median_ms={item.median_ms}, min_ms={item.min_ms}, max_ms={item.max_ms}, "
            f"output={item.output_summary}"
        )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark MoneyView Python/NumPy finance functions.")
    parser.add_argument("--iterations", type=int, default=20, help="Iterations per benchmark.")
    parser.add_argument("--monte-carlo-runs", type=int, default=5000, help="Monte Carlo simulation count.")
    parser.add_argument("--vector-size", type=int, default=10000, help="Vector length for NumPy risk benchmarks.")
    parser.add_argument("--seed", type=int, default=42, help="Deterministic random seed.")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of text.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    results = run_finance_benchmarks(
        iterations=max(1, args.iterations),
        monte_carlo_runs=max(1, args.monte_carlo_runs),
        vector_size=max(10, args.vector_size),
        seed=args.seed,
    )
    if args.json:
        print(json.dumps([asdict(item) for item in results], indent=2))
    else:
        _print_results(results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
