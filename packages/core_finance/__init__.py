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

__all__ = [
    "calculate_fcff", "calculate_growth_rate", "calculate_terminal_value",
    "calculate_npv", "multi_stage_dcf",
    "unlever_beta", "relever_beta", "bottom_up_beta",
    "calculate_crp", "calculate_wacc", "decompose_hurdle_rate", "wacc_sensitivity",
    "payback_period", "sensitivity_analysis", "monte_carlo_npv",
]
