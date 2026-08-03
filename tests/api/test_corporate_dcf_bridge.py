import pytest

from apps.api.models.schema_parts.corporate import (
    BridgeInputMeta,
    BridgeSource,
    ValuationAssumptions,
)
from apps.api.services.corporate_dcf import _build_dcf_outputs
from apps.api.services.equity_bridge import EquityBridge
from apps.api.models.schemas import CorporateMetrics


def _metrics(ticker="TEST"):
    return CorporateMetrics(
        ticker=ticker, growth=6, roic=18, wacc=10, debt_ratio=18, unlevered_beta=1.05,
        crp=0.8, reinvestment=34, fcff=92, innovation=82, market_share=64,
        governance=74, esg_penalty=22,
    )


def _params(**overrides):
    base = dict(
        revenue_growth_rate=0.06, operating_margin=0.25, tax_rate=0.21,
        wacc=0.10, terminal_growth_rate=0.02, fcff=100.0, esg_penalty=22.0,
    )
    base.update(overrides)
    return ValuationAssumptions(**base)


def _bridge(net_debt=60.0, non_op=5.0, shares=15.0):
    return EquityBridge(
        net_debt=BridgeInputMeta(
            value=net_debt, source=BridgeSource.TOTAL_DEBT_LESS_CASH,
            quality="ok", as_of="2025-09-30",
        ),
        non_operating_assets=BridgeInputMeta(
            value=non_op, source=BridgeSource.INVESTMENTS_ADVANCES,
            quality="ok", as_of="2025-09-30",
        ),
        diluted_shares_outstanding=BridgeInputMeta(
            value=shares, source=BridgeSource.DILUTED_AVERAGE_SHARES,
            quality="ok", as_of="2025-09-30",
        ),
    )


def _outputs(params, bridge):
    return _build_dcf_outputs(
        ticker="TEST",
        params=params,
        current_price_loader=lambda t: 100.0,
        metrics_loader=lambda t: _metrics(t),
        risk_free_rate=0.042,
        equity_risk_premium=0.055,
        country_risk_premium=0.008,
        bridge_loader=lambda t: bridge,
    )


def test_the_store_fills_a_bridge_field_the_request_left_none():
    summary, _, _ = _outputs(_params(), _bridge(net_debt=60.0))
    assert summary.net_debt_meta.value == pytest.approx(60.0)
    assert summary.bridge_quality == "ok"
    assert summary.valuation_method == "intrinsic_equity_per_share"
    assert summary.status != "Bridge Incomplete"


def test_a_request_parameter_overrides_the_store():
    summary, _, _ = _outputs(_params(net_debt=999.0), _bridge(net_debt=60.0))
    assert summary.net_debt_meta.value == pytest.approx(999.0)
    assert summary.net_debt_meta.source == BridgeSource.REQUEST
    assert summary.net_debt_meta.quality == "ok"


def test_the_per_share_value_is_in_dollars_not_billionths_of_a_dollar():
    # fcff and enterprise_value are in billions; net debt and the share count are scaled
    # to billions at read time, so the quotient is dollars per share. Feeding raw dollars
    # here would be wrong by 1e9 and would still return a plausible small number.
    summary, _, full = _outputs(_params(), _bridge(net_debt=60.0, non_op=0.0, shares=15.0))
    expected = (full.enterprise_value - 60.0) / 15.0
    assert summary.intrinsic_value_per_share == pytest.approx(expected, rel=1e-6)
    assert summary.intrinsic_value_per_share > 1.0


def test_bridge_quality_is_the_worst_of_the_three_inputs():
    bridge = _bridge()
    degraded = EquityBridge(
        net_debt=bridge.net_debt,
        non_operating_assets=BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="estimated"
        ),
        diluted_shares_outstanding=bridge.diluted_shares_outstanding,
    )
    summary, _, _ = _outputs(_params(), degraded)
    assert summary.bridge_quality == "estimated"
    # An absent non-operating-assets term is summed as zero, so the value still resolves.
    assert summary.intrinsic_value_per_share is not None


def test_a_missing_share_count_leaves_the_per_share_value_unavailable():
    bridge = _bridge()
    starved = EquityBridge(
        net_debt=bridge.net_debt,
        non_operating_assets=bridge.non_operating_assets,
        diluted_shares_outstanding=BridgeInputMeta(
            value=None, source=BridgeSource.UNAVAILABLE, quality="missing"
        ),
    )
    summary, _, _ = _outputs(_params(), starved)
    assert summary.intrinsic_value_per_share is None
    assert summary.bridge_quality == "missing"
    assert summary.status == "Bridge Incomplete"


def test_esg_penalty_moves_no_valuation_output():
    # esg_penalty is round(8.0 + (seed % 32), 2) where seed is the sum of character codes
    # in f"{ticker}:{sector}" -- a hash of how the ticker is spelled, not a measurement.
    # Wiring it into WACC or the cash flows would let renaming a ticker change a valuation.
    # This test is the record of that decision (spec 2026-08-03, item 3).
    low, _, low_full = _outputs(_params(esg_penalty=8.0), _bridge())
    high, _, high_full = _outputs(_params(esg_penalty=40.0), _bridge())
    assert low.enterprise_value == high.enterprise_value
    assert low.equity_value == high.equity_value
    assert low.intrinsic_value_per_share == high.intrinsic_value_per_share
    assert low_full.terminal_value == high_full.terminal_value


def test_the_dcf_value_does_not_move_with_the_current_price():
    # The Phase 1 invariant. current_price may inform upside_pct and status, never value.
    cheap = _build_dcf_outputs(
        ticker="TEST", params=_params(), current_price_loader=lambda t: 10.0,
        metrics_loader=lambda t: _metrics(t), risk_free_rate=0.042,
        equity_risk_premium=0.055, country_risk_premium=0.008,
        bridge_loader=lambda t: _bridge(),
    )[0]
    dear = _build_dcf_outputs(
        ticker="TEST", params=_params(), current_price_loader=lambda t: 1000.0,
        metrics_loader=lambda t: _metrics(t), risk_free_rate=0.042,
        equity_risk_premium=0.055, country_risk_premium=0.008,
        bridge_loader=lambda t: _bridge(),
    )[0]
    assert cheap.intrinsic_value_per_share == dear.intrinsic_value_per_share
    assert cheap.enterprise_value == dear.enterprise_value
