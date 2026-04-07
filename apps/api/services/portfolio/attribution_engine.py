from __future__ import annotations

from typing import Dict, List

import numpy as np

from apps.api.core.maths import aggregate_sector_returns, brinson_fachler_arithmetic
from apps.api.models.schemas import SectorAttribution


class AttributionEngine:
    """Pure sector-level Brinson-Fachler attribution computation."""

    def calculate_sector_breakdowns(
        self,
        sectors: List[str],
        portfolio_weights: np.ndarray,
        ticker_returns: np.ndarray,
        benchmark_sector_weights: Dict[str, float],
        benchmark_sector_returns: Dict[str, float],
        benchmark_total_return: float,
    ) -> tuple[list[SectorAttribution], tuple[float, float, float]]:
        portfolio_sector = aggregate_sector_returns(sectors, portfolio_weights, ticker_returns)
        all_sectors = sorted(set(portfolio_sector.keys()) | set(benchmark_sector_weights.keys()))

        wp = np.array([portfolio_sector.get(sector, {}).get("weight", 0.0) for sector in all_sectors], dtype=float)
        wb = np.array([benchmark_sector_weights.get(sector, 0.0) for sector in all_sectors], dtype=float)
        rp = np.array(
            [portfolio_sector.get(sector, {}).get("return", benchmark_total_return) for sector in all_sectors],
            dtype=float,
        )
        rb = np.array(
            [benchmark_sector_returns.get(sector, benchmark_total_return) for sector in all_sectors],
            dtype=float,
        )

        if abs(np.sum(wb) - 1.0) > 1e-12 and np.sum(wb) > 0:
            wb = wb / np.sum(wb)
        if abs(np.sum(wp) - 1.0) > 1e-12 and np.sum(wp) > 0:
            wp = wp / np.sum(wp)

        effects = brinson_fachler_arithmetic(
            portfolio_weights=wp,
            benchmark_weights=wb,
            portfolio_returns=rp,
            benchmark_returns=rb,
            benchmark_total_return=benchmark_total_return,
        )

        sector_breakdowns = []
        for idx, sector in enumerate(all_sectors):
            allocation = float(effects.allocation[idx])
            selection = float(effects.selection[idx])
            interaction = float(effects.interaction[idx])
            active = allocation + selection + interaction
            sector_breakdowns.append(
                SectorAttribution(
                    sector=sector,
                    portfolio_weight=float(wp[idx]),
                    benchmark_weight=float(wb[idx]),
                    portfolio_return=float(rp[idx]),
                    benchmark_return=float(rb[idx]),
                    allocation_effect=allocation,
                    selection_effect=selection,
                    interaction_effect=interaction,
                    active_contribution=active,
                )
            )

        sector_breakdowns.sort(key=lambda x: abs(x.active_contribution), reverse=True)
        return sector_breakdowns, (
            float(np.sum(effects.allocation)),
            float(np.sum(effects.selection)),
            float(np.sum(effects.interaction)),
        )

