"""
TDD tests for packages/core-finance/beta.py

Cross-checked against Damodaran's "Investment Valuation" examples.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from packages.core_finance.beta import unlever_beta, relever_beta, bottom_up_beta


class TestUnleverBeta:
    """β_U = β_L / [1 + (1-t)(D/E)]"""

    def test_standard_hamada(self):
        # β_L=1.5, t=0.35, D/E=0.5 → β_U = 1.5 / [1 + 0.65×0.5] = 1.5/1.325 ≈ 1.132
        result = unlever_beta(levered_beta=1.5, tax_rate=0.35, de_ratio=0.5)
        assert result == pytest.approx(1.132, rel=1e-3)

    def test_zero_debt(self):
        # No debt → unlevered = levered
        result = unlever_beta(levered_beta=1.2, tax_rate=0.30, de_ratio=0.0)
        assert result == pytest.approx(1.2)

    def test_full_tax_shield(self):
        # t=1 → no tax shield adjustment; β_U = β_L / 1 = β_L
        result = unlever_beta(levered_beta=1.0, tax_rate=1.0, de_ratio=2.0)
        assert result == pytest.approx(1.0)


class TestReleverBeta:
    """β_L = β_U × [1 + (1-t)(D/E)]"""

    def test_standard_hamada(self):
        # β_U=1.0, t=0.30, D/E=1.0 → β_L = 1.0 × [1 + 0.7×1.0] = 1.7
        result = relever_beta(unlevered_beta=1.0, tax_rate=0.30, de_ratio=1.0)
        assert result == pytest.approx(1.7)

    def test_round_trip(self):
        # unlever then relever should return original
        original = 1.5
        tax_rate, de_ratio = 0.25, 0.8
        unlevered = unlever_beta(original, tax_rate, de_ratio)
        relevered  = relever_beta(unlevered, tax_rate, de_ratio)
        assert relevered == pytest.approx(original, rel=1e-6)

    def test_zero_debt_unchanged(self):
        result = relever_beta(unlevered_beta=0.9, tax_rate=0.20, de_ratio=0.0)
        assert result == pytest.approx(0.9)


class TestBottomUpBeta:
    """Bottom-up: average unlevered betas, then re-lever with target D/E."""

    def test_single_peer(self):
        peers = [{"levered_beta": 1.2, "tax_rate": 0.25, "de_ratio": 0.4}]
        result = bottom_up_beta(
            peers=peers,
            target_tax_rate=0.25,
            target_de_ratio=0.4,
        )
        assert result == pytest.approx(1.2, rel=1e-4)

    def test_multiple_peers_average(self):
        peers = [
            {"levered_beta": 1.0, "tax_rate": 0.30, "de_ratio": 0.0},
            {"levered_beta": 1.4, "tax_rate": 0.30, "de_ratio": 0.0},
        ]
        # Both unlevered = levered (no debt). Average = 1.2. Re-lever with D/E=0.5
        # β_L = 1.2 × [1 + 0.7×0.5] = 1.2 × 1.35 = 1.62
        result = bottom_up_beta(peers=peers, target_tax_rate=0.30, target_de_ratio=0.5)
        assert result == pytest.approx(1.62, rel=1e-4)

    def test_empty_peers_raises(self):
        with pytest.raises(ValueError, match="at least one peer"):
            bottom_up_beta(peers=[], target_tax_rate=0.25, target_de_ratio=0.5)
