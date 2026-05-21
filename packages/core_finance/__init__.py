"""
packages/core_finance — importable Python package.

Directory was named core-finance per SOP-FS-01 canonical layout,
renamed to core_finance for Python import compatibility.
"""

from .dcf import (
    calculate_fcff,
    calculate_growth_rate,
    calculate_terminal_value,
    calculate_npv,
    calculate_equity_value,
    calculate_intrinsic_value_per_share,
    multi_stage_dcf,
)
from .beta import unlever_beta, relever_beta, bottom_up_beta
from .hurdle_rate import (
    calculate_crp,
    calculate_wacc,
    decompose_hurdle_rate,
    wacc_sensitivity,
)
from .risk_analysis import payback_period, sensitivity_analysis, monte_carlo_npv
from .expected_return import (
    ExpectedReturnInputs,
    ExpectedReturnResult,
    calculate_capm_expected_return,
    calculate_expected_return_result,
    calculate_market_expected_return,
    calculate_dcf_implied_return,
    calculate_expected_return_spread,
)
from .corporate_statement_metrics import (
    DEFAULT_TAX_RATE,
    MAX_ABS_ROIC,
    ROIC_QUALITY_RULES,
    ROIC_WARNING_RULES,
    assess_roic_quality,
    average_invested_capital_result,
    build_roic_records,
    calculate_invested_capital,
    calculate_nopat,
    stable_growth_payload,
    stable_tax_result,
)

__all__ = [
    "calculate_fcff", "calculate_growth_rate", "calculate_terminal_value",
    "calculate_npv", "calculate_equity_value", "calculate_intrinsic_value_per_share", "multi_stage_dcf",
    "unlever_beta", "relever_beta", "bottom_up_beta",
    "calculate_crp", "calculate_wacc", "decompose_hurdle_rate", "wacc_sensitivity",
    "payback_period", "sensitivity_analysis", "monte_carlo_npv",
    "ExpectedReturnInputs", "ExpectedReturnResult", "calculate_expected_return_result",
    "calculate_capm_expected_return", "calculate_market_expected_return",
    "calculate_dcf_implied_return", "calculate_expected_return_spread",
    "DEFAULT_TAX_RATE", "MAX_ABS_ROIC", "ROIC_QUALITY_RULES", "ROIC_WARNING_RULES",
    "assess_roic_quality", "average_invested_capital_result", "build_roic_records",
    "calculate_invested_capital", "calculate_nopat", "stable_growth_payload", "stable_tax_result",
]
