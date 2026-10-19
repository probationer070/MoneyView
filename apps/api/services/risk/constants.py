"""Fixed identifiers for the risk engine. Thresholds live in apps/api/services/risk/rules.yaml, not here."""
from __future__ import annotations

# Benchmarks for the risk engine. Stored in `stocks`; never added to MARKET_INDICES.
BENCHMARK_TICKERS: tuple[str, ...] = ("^SOX", "RSP", "SPY")

# FRED series the risk engine reads. signals/models.py KNOWN_SERIES is deliberately not touched.
RISK_FRED_SERIES: tuple[str, ...] = (
    "BAMLH0A0HYM2",
    "BAA10Y",
    "DGS10",
    "DCOILBRENTEU",
    "DFEDTARU",
    "CPILFESL",
    "PCEPILFE",
    "CPIAUCSL",
    "PCEPI",
    "PAYEMS",
)
