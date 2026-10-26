"""A Damodaran-style fair-value case for one listed company.

Spec: docs/superpowers/specs/2026-10-26-damodaran-fair-value-design.md.

The conservative case (`conservative_case.py`) takes the WORSE of the company's figure and the
top-five industries of its sector on every input: a floor. This one values the company the way
Damodaran's own template does -- the company's figures where they exist, its OWN industry's
averages as the defaults where they do not -- with central assumptions rather than worst-of ones.

One segment named for the company, as in the conservative case: a listed company publishes no
segment split this project stores. Amounts are in billions, rates are fractions.
"""

from __future__ import annotations

from packages.core_finance.industry_benchmark import IndustryRow, column_by_key, screen_value

from apps.api.services.conservative_case import CompanyBaseline

HORIZON_YEARS = 10
# Years 1-5 grow at the blended rate; 6-10 fade linearly to the riskfree rate (Damodaran's default).
HIGH_GROWTH_YEARS = 5
# The WACC and the tax rate start converging in this year, as in the SpaceX cases.
CONVERGE_FROM_YEAR = 6
# The blended growth is held inside this band. A recent CAGR of 90% (a turnaround, an acquisition)
# or -60% is not a five-year story; Damodaran caps his own defaults the same way.
GROWTH_FLOOR = -0.05
GROWTH_CAP = 0.25
# CAGR window: the last three fiscal years, i.e. four revenue points when they exist.
CAGR_YEARS = 3

_INDUSTRY_COLUMNS = (
    "revenue_growth", "operating_margin", "after_tax_roc",
    "effective_tax_rate", "cost_of_capital", "sales_to_capital",
)


class FairValueRefused(ValueError):
    """No fair-value case: the message starts with a machine-readable reason prefix."""


def fair_value_case_name(ticker: str, vintage: str, latest_year: int) -> str:
    """One name per ticker, benchmark vintage and statement year: new statements make a new case."""
    return f"damodaran_{ticker.upper()}_{vintage}_FY{latest_year}"


def company_revenue_cagr(revenue_by_year: dict[int, float]) -> float | None:
    """Revenue CAGR over the last `CAGR_YEARS` fiscal years, or over fewer when fewer exist.

    None with fewer than two years of revenue or a non-positive starting revenue: a growth rate
    from one point, or from zero, is not a measurement.
    """
    years = sorted(revenue_by_year)[-(CAGR_YEARS + 1):]
    if len(years) < 2:
        return None
    start, end = float(revenue_by_year[years[0]]), float(revenue_by_year[years[-1]])
    if start <= 0 or end <= 0:
        return None
    return (end / start) ** (1.0 / (years[-1] - years[0])) - 1.0


def _industry_value(industry: IndustryRow, key: str) -> float:
    value = industry.values.get(key)
    problem = screen_value(column_by_key(key), value)
    if problem is not None:
        raise FairValueRefused(f"industry_column: {industry.name} {problem}")
    return float(value)


def growth_path(g: float, riskfree_rate: float) -> list[float]:
    """The ten yearly revenue growth rates: g for years 1-5, then linear to riskfree in year 10."""
    fade_years = HORIZON_YEARS - HIGH_GROWTH_YEARS
    return [g] * HIGH_GROWTH_YEARS + [
        g + (riskfree_rate - g) * step / fade_years for step in range(1, fade_years + 1)
    ]


def _narrative(field: str, claim: str, source: str) -> dict:
    # `derived`, never `confirmed`: the averages are real, applying them to this company is ours.
    return {"input_field": field, "claim": claim, "evidence_source": source,
            "confidence": "derived", "three_p": "probable"}


def build_fair_value_case(
    ticker: str,
    baseline: CompanyBaseline,
    industry: IndustryRow,
    *,
    vintage: str,
    latest_year: int,
    company_growth: float,
    riskfree_rate: float,
    marginal_tax_rate: float,
    base_year: int,
) -> dict:
    """A `create_case` payload valuing `ticker` against its own industry (spec §3)."""
    ind = {key: _industry_value(industry, key) for key in _INDUSTRY_COLUMNS}
    bench = f"damodaran_industry_{vintage}"
    where = f"{industry.name} ({industry.firms} firms, vintage {vintage})"

    blended = (company_growth + ind["revenue_growth"]) / 2.0
    g = min(max(blended, GROWTH_FLOOR), GROWTH_CAP)
    revenue_target = baseline.base_revenue
    for rate in growth_path(g, riskfree_rate):
        revenue_target *= 1.0 + rate

    margin_target = (baseline.base_margin + ind["operating_margin"]) / 2.0
    wacc_stable = ind["cost_of_capital"]
    # The industry's ROC is a BOOK return on existing capital. The terminal block cannot earn more
    # on NEW capital than this case's own target margin and sales to capital imply, which the
    # engine refuses; the lower of the two, as in the conservative builder.
    implied_marginal = margin_target * (1.0 - marginal_tax_rate) * ind["sales_to_capital"]
    roic_stable = min(ind["after_tax_roc"], implied_marginal)
    terminal_growth = None  # riskfree
    terminal_note = (
        f"The lower of {where} after-tax ROC {ind['after_tax_roc']:.4f} and the implied marginal return "
        f"{implied_marginal:.4f} (margin target x (1 - marginal tax) x sales to capital), "
        f"above the stable WACC {wacc_stable:.4f}."
    )
    if roic_stable <= wacc_stable:
        # Growth at a return at or below the cost of capital adds no value (Damodaran's default
        # terminal assumption is no excess return), so the perpetuity grows at zero. With no growth
        # there is no reinvestment and the return no longer moves the value; it stays at the lower
        # estimate, which the engine accepts, rather than being raised to the WACC, which it refuses.
        terminal_note = (
            f"The terminal return {roic_stable:.4f} (the lower of {where} after-tax ROC and the "
            f"implied marginal return) does not exceed the stable WACC "
            f"{wacc_stable:.4f}: zero terminal growth (growth at that return adds no value)."
        )
        terminal_growth = 0.0

    growth_claim = (
        f"Years 1-5 at {g:.4f}: the average of the company's revenue CAGR {company_growth:.4f} and "
        f"{where} revenue growth {ind['revenue_growth']:.4f}"
        + (f", held inside [{GROWTH_FLOOR}, {GROWTH_CAP}]" if g != blended else "")
        + f"; years 6-10 fade linearly to the riskfree rate {riskfree_rate:.4f}."
    )
    segment_narratives = [
        _narrative("base_revenue", f"FY{latest_year} revenue from stored statements.", "stored_statements"),
        _narrative("base_margin", f"FY{latest_year} operating income over revenue.", "stored_statements"),
        _narrative("revenue_target", f"{baseline.base_revenue:.4f} grown ten years. {growth_claim}", bench),
        _narrative("margin_target",
                   f"Halfway from the company's {baseline.base_margin:.4f} to {where} operating margin "
                   f"{ind['operating_margin']:.4f}.", bench),
        _narrative("sales_to_capital_early", f"{where} sales to capital {ind['sales_to_capital']:.4f}.", bench),
        _narrative("sales_to_capital_late", f"{where} sales to capital {ind['sales_to_capital']:.4f}.", bench),
    ]
    case_narratives = [
        _narrative("wacc_initial", f"The company's measured WACC {baseline.current_wacc:.4f}.", "corporate_metrics"),
        _narrative("wacc_stable", f"{where} cost of capital {wacc_stable:.4f}, reached from year "
                                  f"{CONVERGE_FROM_YEAR}.", bench),
        _narrative("effective_tax_rate", f"{where} effective tax rate {ind['effective_tax_rate']:.4f}, "
                                         f"ramping to the marginal {marginal_tax_rate:.4f}.", bench),
        _narrative("roic_stable", terminal_note, bench),
    ]

    return {
        "case_name": fair_value_case_name(ticker, vintage, latest_year),
        "ticker": ticker.upper(),
        "as_of_date": f"{base_year}-01-01",
        "base_year": base_year,
        "target_year": base_year + HORIZON_YEARS,
        "riskfree_rate": riskfree_rate,
        "wacc_initial": baseline.current_wacc,
        "wacc_stable": wacc_stable,
        "wacc_converge_from": CONVERGE_FROM_YEAR,
        "marginal_tax_rate": marginal_tax_rate,
        "effective_tax_rate": ind["effective_tax_rate"],
        "nol_balance": 0.0,
        "roic_stable": roic_stable,
        "terminal_growth": terminal_growth,
        "cash": baseline.cash,
        "debt": baseline.debt,
        "ipo_proceeds": 0.0,
        "shares_basic": baseline.shares,
        "shares_new": 0.0,
        "parent_case_id": None,
        "narratives": case_narratives,
        "segments": [{
            "name": ticker.lower(),
            "base_revenue": baseline.base_revenue,
            "base_margin": baseline.base_margin,
            "tam_target": None,
            "market_share_target": None,
            "revenue_target": revenue_target,
            "margin_target": margin_target,
            "sales_to_capital_early": ind["sales_to_capital"],
            "sales_to_capital_late": ind["sales_to_capital"],
            "ramp_start_year": 1,
            "initial_growth": None,
            "waypoint_gap_fraction": None,
            "narratives": segment_narratives,
        }],
    }
