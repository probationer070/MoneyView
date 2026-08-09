"""Payload builders for valuation-case tests.

Shared by test_valuation_case_service.py and test_valuation_routes.py. Kept out
of a test module so neither imports the other, and out of conftest.py because
these are called directly, not injected as pytest fixtures.
"""

from apps.api.services.valuation_case import NARRATED_FIELDS


def _narrative(field: str, confidence: str = "assumed", three_p: str = "probable") -> dict:
    return {
        "input_field": field,
        "claim": f"placeholder claim for {field}",
        "evidence_source": "test",
        "confidence": confidence,
        "three_p": three_p,
    }


def _segment_payload(**overrides) -> dict:
    payload = {
        "name": "launch",
        "base_revenue": 4.1,
        "base_margin": -0.10,
        "tam_target": 100.0,
        "market_share_target": 0.70,
        "margin_target": 0.45,
        "sales_to_capital_early": 1.0,
        "sales_to_capital_late": 1.5,
        "ramp_start_year": 1,
    }
    payload.update(overrides)
    present = [f for f in NARRATED_FIELDS if payload.get(f) is not None]
    payload["narratives"] = [_narrative(f) for f in present]
    return payload


def _case_payload(**overrides) -> dict:
    payload = {
        "case_name": "test_case",
        "ticker": None,
        "as_of_date": "2026-08-09",
        "base_year": 2026,
        "target_year": 2036,
        "riskfree_rate": 0.0456,
        "wacc_initial": 0.0837,
        "wacc_stable": 0.0825,
        "wacc_converge_from": 6,
        "marginal_tax_rate": 0.25,
        "nol_balance": 5.0,
        "roic_stable": 0.12,
        "terminal_growth": None,
        "cash": 24.7,
        "debt": 22.9,
        "ipo_proceeds": 75.0,
        "shares_basic": 12.535,
        "shares_new": 0.556,
        "parent_case_id": None,
        "segments": [_segment_payload()],
    }
    payload.update(overrides)
    return payload
