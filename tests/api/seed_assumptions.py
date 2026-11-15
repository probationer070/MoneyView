"""The seed market assumptions (4.2 / 5.5 / 0.8) as an `Assumptions` object, for tests that need today's numbers."""
from apps.api.services.market_assumptions import Assumptions

SEED_ASSUMPTIONS = Assumptions(
    risk_free_rate=4.2,
    risk_free_source="owner",
    risk_free_as_of="2026-11-16",
    equity_risk_premium=5.5,
    erp_source="owner",
    erp_as_of="2026-11-16",
    crp_non_mature=0.8,
    crp_as_of="2026-11-16",
)
