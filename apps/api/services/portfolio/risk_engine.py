from __future__ import annotations

import numpy as np

from apps.api.core.maths import calculate_portfolio_beta, historical_expected_shortfall, historical_var
from apps.api.models.schemas import AttributionRequest, RiskMetrics
from apps.api.services.portfolio.data_provider import DataProvider, PERIOD_TO_DAYS


class RiskEngine:
    """Calculates portfolio risk metrics."""

    def __init__(self, data_provider: DataProvider):
        self.data_provider = data_provider

    def _portfolio_and_benchmark_series(self, request: AttributionRequest) -> tuple[np.ndarray, np.ndarray, set[str]]:
        period_days = PERIOD_TO_DAYS.get(request.period, 365)
        min_len = min(max(60, period_days // 2), 400)
        weights = np.array(request.weights, dtype=float)
        synthetic_tickers: set[str] = set()

        holding_series = []
        for ticker in request.tickers:
            series, synthetic_used = self.data_provider.return_series(
                ticker,
                request.period,
                min_len=min_len,
                as_of_date=request.as_of_date,
                allow_synthetic_fallback=request.allow_synthetic_fallback,
            )
            if synthetic_used:
                synthetic_tickers.add(ticker)
            holding_series.append(series)

        aligned_len = min(len(s) for s in holding_series) if holding_series else min_len
        aligned_matrix = (
            np.vstack([series[-aligned_len:] for series in holding_series])
            if holding_series
            else np.zeros((1, aligned_len))
        )
        portfolio_series = np.dot(weights, aligned_matrix)

        if request.benchmark_weights is not None:
            benchmark_weights = np.array(request.benchmark_weights, dtype=float)
            benchmark_series = np.dot(benchmark_weights, aligned_matrix)
            return portfolio_series, benchmark_series, synthetic_tickers

        benchmark_series_raw, benchmark_synthetic = self.data_provider.return_series(
            request.benchmark.upper(),
            request.period,
            min_len=aligned_len,
            as_of_date=request.as_of_date,
            allow_synthetic_fallback=request.allow_synthetic_fallback,
        )
        if benchmark_synthetic:
            synthetic_tickers.add(request.benchmark.upper())
        return portfolio_series, benchmark_series_raw[-aligned_len:], synthetic_tickers

    def calculate(self, request: AttributionRequest) -> tuple[RiskMetrics, set[str]]:
        portfolio_series, benchmark_series, synthetic_tickers = self._portfolio_and_benchmark_series(request)
        beta_window = min(
            request.risk_profile.beta_rolling_window,
            len(portfolio_series),
            len(benchmark_series),
        )
        beta = calculate_portfolio_beta(
            portfolio_series[-beta_window:],
            benchmark_series[-beta_window:],
        )

        return (
            RiskMetrics(
                beta=beta,
                beta_rolling_window=beta_window,
                var_95_1d=historical_var(
                    portfolio_series,
                    confidence_level=request.risk_profile.var_confidence_level,
                    horizon_days=request.risk_profile.var_horizon_days,
                ),
                es_95_1d=historical_expected_shortfall(
                    portfolio_series,
                    confidence_level=request.risk_profile.es_confidence_level,
                    horizon_days=request.risk_profile.es_horizon_days,
                ),
                var_method=request.risk_profile.var_method,
                es_method=request.risk_profile.es_method,
            ),
            synthetic_tickers,
        )
