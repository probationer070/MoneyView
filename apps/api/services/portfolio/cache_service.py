from __future__ import annotations

from hashlib import sha256

from cachetools import TTLCache

from apps.api.models.schemas import AttributionRequest, AttributionResult, ReportPayload, ReportSummaryRequest


class CacheService:
    """Owns portfolio attribution/report cache keys and reads/writes."""

    _attribution_cache = TTLCache(maxsize=512, ttl=300)
    _report_cache = TTLCache(maxsize=256, ttl=300)

    def attribution_cache_key(self, request: AttributionRequest) -> str:
        profile = request.risk_profile
        benchmark_weights = ",".join(f"{float(weight):.10f}" for weight in (request.benchmark_weights or []))
        key_raw = "|".join(
            [
                request.portfolio_hash(),
                request.benchmark.upper(),
                request.period.value,
                request.currency.upper(),
                request.return_frequency.value,
                request.rebalancing.value,
                str(request.as_of_date or ""),
                request.attribution_method.value,
                str(request.allow_synthetic_fallback),
                str(request.allow_benchmark_proxy),
                benchmark_weights,
                str(profile.beta_rolling_window),
                profile.var_method.value,
                f"{profile.var_confidence_level:.6f}",
                str(profile.var_horizon_days),
                profile.es_method.value,
                f"{profile.es_confidence_level:.6f}",
                str(profile.es_horizon_days),
            ]
        )
        return sha256(key_raw.encode("utf-8")).hexdigest()[:24]

    def report_cache_key(self, request: ReportSummaryRequest, attribution_cache_key: str) -> str:
        options = ",".join(sorted(fmt.value for fmt in request.report_options.formats))
        key_raw = "|".join(
            [
                attribution_cache_key,
                request.version,
                request.filters.period.value,
                request.filters.currency.upper(),
                request.filters.benchmark.upper(),
                str(request.filters.date_from or ""),
                str(request.filters.date_to or ""),
                options,
                str(request.report_options.include_risk_metrics),
                str(request.report_options.include_sector_table),
                str(request.report_options.include_methodology),
            ]
        )
        return sha256(key_raw.encode("utf-8")).hexdigest()[:24]

    def get_attribution(self, cache_key: str) -> AttributionResult | None:
        cached = self._attribution_cache.get(cache_key)
        if cached is None:
            return None
        result = AttributionResult.model_validate(cached)
        result.metadata.cache_hit = True
        return result

    def set_attribution(self, cache_key: str, result: AttributionResult) -> None:
        self._attribution_cache[cache_key] = result.model_dump()

    def get_report(self, cache_key: str) -> ReportPayload | None:
        cached = self._report_cache.get(cache_key)
        if cached is None:
            return None
        return ReportPayload.model_validate(cached)

    def set_report(self, cache_key: str, payload: ReportPayload) -> None:
        self._report_cache[cache_key] = payload.model_dump()
