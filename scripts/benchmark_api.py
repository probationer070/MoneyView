"""
Benchmark representative MoneyView API endpoints with deterministic local data.

The script avoids network calls by patching provider-facing route helpers and by
seeding a temporary SQLite database under data/cache/api_benchmarks.
"""

from __future__ import annotations

import argparse
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from apps.api.main import app  # noqa: E402
from apps.api.models.schemas import CorporateMetrics, StockOHLCV  # noqa: E402
from apps.api.routes import corporate as corporate_route  # noqa: E402
from apps.api.routes import detail as detail_route  # noqa: E402
from apps.api.services import db as db_service  # noqa: E402


@dataclass
class ApiBenchmarkResult:
    name: str
    method: str
    path: str
    iterations: int
    avg_ms: float
    median_ms: float
    min_ms: float
    max_ms: float
    status_code: int


def _metrics_for_ticker(ticker: str, **_: object) -> CorporateMetrics:
    values = {
        "AAPL": (6, 18, 10, 18, 1.05),
        "MSFT": (7, 22, 9, 15, 0.95),
        "GOOGL": (8, 20, 9.5, 8, 1.0),
        "^GSPC": (5, 10, 8, 0, 1.0),
    }
    growth, roic, wacc, debt_ratio, beta = values.get(ticker.upper(), values["AAPL"])
    return CorporateMetrics(
        ticker=ticker.upper(),
        growth=growth,
        roic=roic,
        wacc=wacc,
        debt_ratio=debt_ratio,
        unlevered_beta=beta,
        crp=0.8,
        reinvestment=34,
        fcff=92,
        innovation=82,
        market_share=64,
        governance=74,
        esg_penalty=22,
    )


def _seed_watchlist() -> None:
    with db_service.get_db() as conn:
        conn.executemany(
            """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
               VALUES (?, ?, ?, ?, ?)""",
            [
                ("AAPL", "Apple", "Technology", "core", 0.4),
                ("MSFT", "Microsoft", "Technology", "core", 0.2),
                ("GOOGL", "Alphabet", "Communication Services", "watch", 0.0),
            ],
        )


def _synthetic_bars(count: int) -> list[StockOHLCV]:
    return [
        StockOHLCV(
            date=f"2025-{((idx // 28) % 12) + 1:02d}-{(idx % 28) + 1:02d}",
            open=100.0 + idx * 0.05,
            high=101.0 + idx * 0.05,
            low=99.0 + idx * 0.05,
            close=100.0 + idx * 0.05,
            volume=1_000_000 + idx * 100,
        )
        for idx in range(count)
    ]


def _time_request(client: TestClient, method: str, path: str, iterations: int, **kwargs) -> ApiBenchmarkResult:
    durations: list[float] = []
    status_code = 0
    request = getattr(client, method.lower())
    for _ in range(iterations):
        start = time.perf_counter()
        response = request(path, **kwargs)
        durations.append((time.perf_counter() - start) * 1000)
        status_code = response.status_code
        response.raise_for_status()
    return ApiBenchmarkResult(
        name=f"{method.upper()} {path}",
        method=method.upper(),
        path=path,
        iterations=iterations,
        avg_ms=round(statistics.mean(durations), 3),
        median_ms=round(statistics.median(durations), 3),
        min_ms=round(min(durations), 3),
        max_ms=round(max(durations), 3),
        status_code=status_code,
    )


def run_api_benchmarks(iterations: int) -> list[ApiBenchmarkResult]:
    work_dir = ROOT / "data" / "cache" / "api_benchmarks"
    work_dir.mkdir(parents=True, exist_ok=True)
    db_path = work_dir / f"moneyview-api-benchmark-{uuid4().hex}.db"

    original_db_path = db_service._DB_PATH
    original_metrics_loader = corporate_route._metrics_for_ticker
    original_price_loader = corporate_route._latest_market_price
    original_get_stock_ohlcv = detail_route._mkt.get_stock_ohlcv

    try:
        db_service._DB_PATH = db_path
        db_service.init_db()
        _seed_watchlist()
        corporate_route._metrics_for_ticker = _metrics_for_ticker
        corporate_route._latest_market_price = lambda ticker: 100.0 if ticker else 0.0
        detail_route._mkt.get_stock_ohlcv = lambda ticker, period="5y": _synthetic_bars(300)

        client = TestClient(app)
        attribution_payload = {
            "tickers": ["AAPL", "MSFT", "TSLA"],
            "weights": [0.4, 0.4, 0.2],
            "benchmark": "^GSPC",
            "period": "1y",
            "currency": "USD",
            "attribution_method": "brinson_fachler_arithmetic",
            "allow_synthetic_fallback": True,
            "allow_benchmark_proxy": True,
        }
        dcf_payload = {
            "revenue_growth_rate": 0.06,
            "operating_margin": 0.18,
            "tax_rate": 0.21,
            "wacc": 0.10,
            "terminal_growth_rate": 0.025,
            "fcff": 92,
            "esg_penalty": 22,
            "reinvestment": 34,
            "unlevered_beta": 1.05,
            "debt_ratio": 18,
        }

        heavy_iterations = max(1, min(iterations, 5))
        return [
            _time_request(client, "GET", "/api/v1/corporate/metrics/AAPL", iterations),
            _time_request(client, "POST", "/api/v1/corporate/dcf/AAPL", heavy_iterations, json=dcf_payload),
            _time_request(client, "GET", "/api/v1/corporate/comparison?mode=live", iterations),
            _time_request(client, "POST", "/api/v1/portfolio/attribution", heavy_iterations, json=attribution_payload),
            _time_request(client, "GET", "/api/v1/detail/AAPL/technicals?period=5y", iterations),
            _time_request(client, "GET", "/api/v1/detail/AAPL/monte-carlo?paths=1000&horizon_days=252", heavy_iterations),
        ]
    finally:
        db_service._DB_PATH = original_db_path
        corporate_route._metrics_for_ticker = original_metrics_loader
        corporate_route._latest_market_price = original_price_loader
        detail_route._mkt.get_stock_ohlcv = original_get_stock_ohlcv
        try:
            db_path.unlink()
        except FileNotFoundError:
            pass


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark representative MoneyView API endpoints.")
    parser.add_argument("--iterations", type=int, default=10)
    args = parser.parse_args(argv or sys.argv[1:])
    print("MoneyView API endpoint benchmark")
    for result in run_api_benchmarks(iterations=max(1, args.iterations)):
        print(
            f"- {result.name}: iterations={result.iterations}, status={result.status_code}, "
            f"avg_ms={result.avg_ms}, median_ms={result.median_ms}, "
            f"min_ms={result.min_ms}, max_ms={result.max_ms}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
