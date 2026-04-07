from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

from apps.api.core.maths import aggregate_weighted_return
from apps.api.models.schemas import (
    AttributionDataContract,
    AttributionDataQuality,
    AttributionEffects,
    AttributionMetadata,
    AttributionRequest,
    AttributionResult,
    AttributionTotals,
    ReportExportFormatEnum,
    ReportExportResponse,
    ReportPayload,
    ReportSummaryRequest,
)
from apps.api.services.market_data import MarketDataService
from apps.api.services.portfolio.attribution_engine import AttributionEngine
from apps.api.services.portfolio.benchmark_service import BenchmarkService
from apps.api.services.portfolio.cache_service import CacheService
from apps.api.services.portfolio.data_provider import DataProvider
from apps.api.services.portfolio.report_renderer import ReportRenderer
from apps.api.services.portfolio.risk_engine import RiskEngine


class PortfolioAnalyticsService:
    """Thin orchestrator for portfolio attribution and report generation."""

    def __init__(
        self,
        market_data: MarketDataService | None = None,
        data_provider: DataProvider | None = None,
        attribution_engine: AttributionEngine | None = None,
        risk_engine: RiskEngine | None = None,
        benchmark_service: BenchmarkService | None = None,
        cache_service: CacheService | None = None,
        report_renderer: ReportRenderer | None = None,
    ):
        self.data = data_provider or DataProvider(market_data)
        self.attr = attribution_engine or AttributionEngine()
        self.risk = risk_engine or RiskEngine(self.data)
        self.benchmark = benchmark_service or BenchmarkService()
        self.cache = cache_service or CacheService()
        self.renderer = report_renderer or ReportRenderer()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def build_attribution(self, request: AttributionRequest) -> AttributionResult:
        cache_key = self.cache.attribution_cache_key(request)
        cached = self.cache.get_attribution(cache_key)
        if cached is not None:
            return cached

        portfolio_hash = request.portfolio_hash()
        tickers = request.tickers
        weights = np.array(request.weights, dtype=float)
        synthetic_tickers: set[str] = set()
        ticker_return_values = []
        for ticker in tickers:
            ticker_return, synthetic_used = self.data.scalar_return(
                ticker,
                request.period,
                as_of_date=request.as_of_date,
                allow_synthetic_fallback=request.allow_synthetic_fallback,
            )
            if synthetic_used:
                synthetic_tickers.add(ticker)
            ticker_return_values.append(ticker_return)
        ticker_returns = np.array(ticker_return_values, dtype=float)

        portfolio_return = aggregate_weighted_return(weights, ticker_returns)
        if request.benchmark_weights is not None:
            benchmark_return = aggregate_weighted_return(
                np.array(request.benchmark_weights, dtype=float),
                ticker_returns,
            )
        else:
            benchmark_return, benchmark_synthetic = self.data.scalar_return(
                request.benchmark.upper(),
                request.period,
                as_of_date=request.as_of_date,
                allow_synthetic_fallback=request.allow_synthetic_fallback,
            )
            if benchmark_synthetic:
                synthetic_tickers.add(request.benchmark.upper())

        sector_map = self.data.sector_map(tickers)
        sectors = [sector_map.get(ticker, "UNCLASSIFIED") for ticker in tickers]

        (
            benchmark_sector_weights,
            benchmark_sector_returns,
            benchmark_source,
            benchmark_proxy_used,
            benchmark_proxy_method,
        ) = self.benchmark.sector_profile(
            request=request,
            sectors=sectors,
            ticker_returns=ticker_returns,
            benchmark_total_return=benchmark_return,
        )

        sector_breakdowns, effect_totals = self.attr.calculate_sector_breakdowns(
            sectors=sectors,
            portfolio_weights=weights,
            ticker_returns=ticker_returns,
            benchmark_sector_weights=benchmark_sector_weights,
            benchmark_sector_returns=benchmark_sector_returns,
            benchmark_total_return=benchmark_return,
        )
        allocation, selection, interaction = effect_totals
        risk_metrics, risk_synthetic_tickers = self.risk.calculate(request)
        synthetic_tickers.update(risk_synthetic_tickers)

        limitations = []
        if benchmark_proxy_used:
            limitations.append(
                "Benchmark sector weights use an explicit equal-sector proxy, not true benchmark constituent weights."
            )
        if synthetic_tickers:
            limitations.append(
                "Synthetic deterministic returns were used for missing price series because allow_synthetic_fallback=true."
            )

        attribution_result = AttributionResult(
            totals=AttributionTotals(
                portfolio_return=float(portfolio_return),
                benchmark_return=float(benchmark_return),
            ),
            active_return=float(portfolio_return - benchmark_return),
            effects=AttributionEffects(
                allocation=allocation,
                selection=selection,
                interaction=interaction,
            ),
            sector_breakdowns=sector_breakdowns,
            risk_metrics=risk_metrics,
            metadata=AttributionMetadata(
                method=request.attribution_method,
                benchmark=request.benchmark.upper(),
                benchmark_weights_source=benchmark_source,
                period=request.period,
                generated_at=self._now_iso(),
                portfolio_hash=portfolio_hash,
                cache_key=cache_key,
                cache_hit=False,
                data_contract=AttributionDataContract(
                    return_frequency=request.return_frequency,
                    rebalancing_assumption=request.rebalancing,
                    currency=request.currency.upper(),
                ),
                data_quality=AttributionDataQuality(
                    synthetic_data_used=bool(synthetic_tickers),
                    synthetic_tickers=sorted(synthetic_tickers),
                    benchmark_proxy_used=benchmark_proxy_used,
                    benchmark_proxy_method=benchmark_proxy_method,
                    limitations=limitations,
                ),
            ),
        )

        self.cache.set_attribution(cache_key, attribution_result)
        return attribution_result

    def build_report(self, request: ReportSummaryRequest) -> ReportPayload:
        attribution_request = request.to_attribution_request()
        attribution_result = self.build_attribution(attribution_request)
        report_cache_key = self.cache.report_cache_key(request, attribution_result.metadata.cache_key)

        cached = self.cache.get_report(report_cache_key)
        if cached is not None:
            return cached

        top_sector = attribution_result.sector_breakdowns[0].sector if attribution_result.sector_breakdowns else "N/A"
        direction = "outperformed" if attribution_result.active_return >= 0 else "underperformed"
        executive_summary = (
            f"Portfolio {direction} benchmark {attribution_result.metadata.benchmark} by "
            f"{abs(attribution_result.active_return):.2%}. Largest active contributor: {top_sector}."
        )

        payload = ReportPayload(
            version=request.version,
            generated_at=self._now_iso(),
            portfolio_hash=attribution_request.portfolio_hash(),
            filters=request.filters,
            report_options=request.report_options,
            attribution=attribution_result,
            executive_summary=executive_summary,
            markdown_content=self.renderer.build_markdown(attribution_result),
        )
        self.cache.set_report(report_cache_key, payload)
        return payload

    def build_report_export(self, request: ReportSummaryRequest, fmt: ReportExportFormatEnum) -> ReportExportResponse:
        return self.renderer.build_export(self.build_report(request), fmt)
