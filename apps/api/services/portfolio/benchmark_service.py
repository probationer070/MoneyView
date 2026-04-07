from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np

from apps.api.core.maths import aggregate_sector_returns
from apps.api.models.schemas import AttributionRequest, BenchmarkWeightsSourceEnum


class BenchmarkService:
    """Builds benchmark sector weights/returns for attribution."""

    def sector_profile(
        self,
        request: AttributionRequest,
        sectors: List[str],
        ticker_returns: np.ndarray,
        benchmark_total_return: float,
    ) -> Tuple[Dict[str, float], Dict[str, float], BenchmarkWeightsSourceEnum, bool, str | None]:
        if request.benchmark_weights is not None:
            benchmark_weights = np.array(request.benchmark_weights, dtype=float)
            sector_agg = aggregate_sector_returns(sectors, benchmark_weights, ticker_returns)
            sector_weights = {sector: values["weight"] for sector, values in sector_agg.items()}
            sector_returns = {sector: values["return"] for sector, values in sector_agg.items()}
            return sector_weights, sector_returns, BenchmarkWeightsSourceEnum.user_provided, False, None

        if not request.allow_benchmark_proxy:
            raise ValueError(
                "True benchmark constituent weights are unavailable. "
                "Provide benchmark_weights or set allow_benchmark_proxy=true to use the equal-sector proxy."
            )

        unique_sectors = sorted(set(sectors))
        if not unique_sectors:
            return {}, {}, BenchmarkWeightsSourceEnum.provider_derived, True, "equal_sector_proxy"

        weight = 1.0 / len(unique_sectors)
        sector_weights = {sector: weight for sector in unique_sectors}
        sector_returns = {sector: benchmark_total_return for sector in unique_sectors}
        return sector_weights, sector_returns, BenchmarkWeightsSourceEnum.provider_derived, True, "equal_sector_proxy"
