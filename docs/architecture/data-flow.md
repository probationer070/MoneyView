# Data Flow

## Portfolio Attribution

1. The frontend sends `AttributionRequest` to `POST /api/v1/portfolio/attribution`.
2. The route delegates to `PortfolioAnalyticsService`.
3. `CacheService` checks a deterministic cache key.
4. `DataProvider` loads price series and sector metadata from SQLite.
5. `BenchmarkService` builds user-provided benchmark sector profiles or an explicitly opted-in provider proxy.
6. `AttributionEngine` calculates arithmetic Brinson-Fachler attribution.
7. `RiskEngine` calculates beta, historical VaR, and expected shortfall.
8. Pydantic validates reconciliation and weight invariants.
9. The frontend adapter maps the domain payload into chart-specific arrays.

## Report Export

1. The frontend sends `ReportExportRequest` to `POST /api/v1/report/export`.
2. `PortfolioAnalyticsService` builds the canonical `ReportPayload`.
3. `ReportRenderer` formats the payload as JSON, CSV, Markdown, or print-safe HTML.
4. The frontend downloads the payload or opens the HTML for browser print-to-PDF.

## Data Quality

The attribution API fails closed for missing price series unless `allow_synthetic_fallback=true` is provided. When synthetic fallback is used, the response metadata includes `data_quality.synthetic_data_used`, `data_quality.synthetic_tickers`, and a limitation message.

Provider-derived benchmark sector profiles are equal-sector proxies because true benchmark constituent weights are not available in the local data store. The API requires `allow_benchmark_proxy=true` before using this approximation and records it in `data_quality.benchmark_proxy_used`.

Only USD, daily returns, and beginning-of-period weights are implemented. Monthly returns, EOP weights, and real FX conversion are rejected until implemented.
