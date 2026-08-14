"""Build a conservative valuation case for one ticker from an industry benchmark.

The wiring that lets the segment build-up engine value a listed company. One
segment, named for the company: a listed company has no published segment split,
so one segment is the whole business.

THE FADE IS APPLIED TO ENDPOINTS, NOT PER YEAR. The engine already interpolates
-- `margin_path` ramps base_margin to margin_target, `wacc_path` ramps
wacc_initial to wacc_stable, `tax_rate_path` ramps effective_tax_rate to the
marginal rate. Fading year by year on top of that would apply convergence twice.

THE TERMINAL RETURN IS THE WORSE OF TWO INDEPENDENT ESTIMATES, NOT A CLAMP.
`roic_stable` is `min(faded after_tax_roc, margin_target x (1 -
marginal_tax_rate) x sales_to_capital_late)`. Both sides estimate the same
quantity from the same table:

- Damodaran's "After-tax ROC" is a BOOK return on EXISTING capital, NOPAT over
  invested capital.
- `margin x (1 - tau) x sales_to_capital` is the return on NEW capital implied
  by that same table's margin and capital intensity.

Where the first exceeds the second, the industry's book capital base is
understated relative to what its current margin and capital intensity generate
on new investment. Carrying the higher figure as a TERMINAL return would assert
that the terminal block earns more on new capital than the model's own margin
and capital intensity support -- which is what `run_case`'s marginal-return
guard exists to reject, and it is right to. Taking the lower is the same
worse-of rule the fade already applies to every other field, so it is
conservative and consistent rather than a number moved to whatever makes a
guard pass. Without it, five of the eleven real 2026 sectors produce nothing.

NOTHING ELSE IS ADJUSTED TO FIT A GUARD. `terminal_value` separately rejects
`roic_stable <= wacc_stable` (positive growth destroying value) and
`roic_stable <= abs(terminal_growth)`. Those cases are REFUSED, not trimmed:
a sector whose top industries genuinely earn below their cost of capital has no
positive-growth perpetuity available to it, and saying so is an economic
statement about the sector. Moving the number until it passes would replace
that statement with false precision. See the two tests named for these.

Amounts are in billions and rates are fractions, matching both the engine and
Damodaran's dataset.
"""

from __future__ import annotations

from dataclasses import dataclass

from packages.core_finance.industry_benchmark import SectorBenchmark, fade

HORIZON_YEARS = 10

# Equity risk premium added to the riskfree rate for the company's own cost of
# capital, absent a measured one. It is only the company-side endpoint of a fade
# that can move in one direction: where the sector's cost of capital is higher,
# the sector's wins, so this matters only when the sector is cheaper than the
# company -- in which case the company's own number is the conservative one.
_DEFAULT_EQUITY_RISK_PREMIUM = 0.045


@dataclass(frozen=True)
class CompanyBaseline:
    """What the company is today, from its own statements. Billions, fractions."""

    base_revenue: float
    base_margin: float
    current_roic: float
    current_sales_to_capital: float
    current_growth: float
    cash: float
    debt: float
    shares: float
    source_years: tuple[int, ...]


def _claim(benchmark: SectorBenchmark, column: str, vintage: str,
           company_value: float, chosen: float) -> str:
    average = benchmark.columns[column]
    return (
        f"Top {len(average.industries)} industries by after-tax ROC in "
        f"{benchmark.sector} ({', '.join(average.industries)}), vintage {vintage}, "
        f"average {column} {average.value:.4f}. The company's own value is "
        f"{company_value:.4f}; the conservative endpoint is {chosen:.4f}."
    )


def _narrative(field: str, claim: str, vintage: str, three_p: str) -> dict:
    return {
        "input_field": field,
        "claim": claim,
        "evidence_source": f"damodaran_industry_{vintage}",
        # Never `confirmed`: the benchmark is a real average, but applying it to
        # THIS company is this model's inference.
        "confidence": "derived",
        "three_p": three_p,
    }


def build_conservative_case(
    ticker: str,
    baseline: CompanyBaseline,
    benchmark: SectorBenchmark,
    *,
    vintage: str,
    riskfree_rate: float,
    marginal_tax_rate: float,
    base_year: int,
) -> dict:
    """A `create_case` payload valuing `ticker` against its sector benchmark."""
    full_basket = max(
        (len(a.industries) for a in benchmark.columns.values()), default=0
    )

    def faded(column: str, company_value: float, direction: str) -> tuple[float, dict | None]:
        average = benchmark.columns.get(column)
        if average is None:
            return company_value, None
        chosen = fade(company_value, average.value, direction,
                      year=HORIZON_YEARS, horizon=HORIZON_YEARS)
        three_p = "probable" if len(average.industries) == full_basket else "plausible"
        return chosen, {"claim": _claim(benchmark, column, vintage, company_value, chosen),
                        "three_p": three_p}

    margin_target, margin_meta = faded("operating_margin", baseline.base_margin,
                                       "lower_is_conservative")
    faded_roc, _ = faded("after_tax_roc", baseline.current_roic, "lower_is_conservative")
    s2c, s2c_meta = faded("sales_to_capital", baseline.current_sales_to_capital,
                          "lower_is_conservative")
    growth, growth_meta = faded("revenue_growth", baseline.current_growth,
                                "lower_is_conservative")
    # The company's own endpoint is the MARGINAL rate -- no tax benefit it has
    # not demonstrated. A sector averaging below that can only lift the early
    # years' cash flow, so `fade` holds; only a sector above it moves this.
    tax_rate, _ = faded("effective_tax_rate", marginal_tax_rate, "higher_is_conservative")
    wacc, _ = faded("cost_of_capital", riskfree_rate + _DEFAULT_EQUITY_RISK_PREMIUM,
                    "higher_is_conservative")

    # The worse of the two estimates of the same return -- see the module
    # docstring. `marginal_roic` computes this same product from the segment's
    # target revenue rather than directly, so the two can differ in the last
    # bits; `run_case` compares with a 1e-9 relative tolerance for exactly that
    # reason, and there is no cause to shade the value to buy headroom.
    implied_marginal_roc = margin_target * (1.0 - marginal_tax_rate) * s2c
    roic_stable = min(faded_roc, implied_marginal_roc)

    revenue_target = baseline.base_revenue * (1.0 + growth) ** HORIZON_YEARS

    narratives = [
        _narrative("base_revenue",
                   f"FY{baseline.source_years[-1]} revenue from stored statements, "
                   f"years {baseline.source_years}.", vintage, "probable"),
        _narrative("base_margin",
                   f"FY{baseline.source_years[-1]} operating income over revenue, "
                   f"from stored statements.", vintage, "probable"),
        _narrative("revenue_target",
                   f"{baseline.base_revenue:.4f} compounded at {growth:.4f} for "
                   f"{HORIZON_YEARS} years. " + (growth_meta or {}).get("claim", ""),
                   vintage, (growth_meta or {}).get("three_p", "plausible")),
        _narrative("margin_target", (margin_meta or {}).get("claim", ""), vintage,
                   (margin_meta or {}).get("three_p", "plausible")),
        _narrative("sales_to_capital_early", (s2c_meta or {}).get("claim", ""), vintage,
                   (s2c_meta or {}).get("three_p", "plausible")),
        _narrative("sales_to_capital_late", (s2c_meta or {}).get("claim", ""), vintage,
                   (s2c_meta or {}).get("three_p", "plausible")),
    ]

    return {
        "case_name": f"conservative_{ticker.upper()}_{vintage}",
        "ticker": ticker.upper(),
        "as_of_date": f"{base_year}-01-01",
        "base_year": base_year,
        "target_year": base_year + HORIZON_YEARS,
        "riskfree_rate": riskfree_rate,
        "wacc_initial": wacc,
        "wacc_stable": wacc,
        "wacc_converge_from": 6,
        "marginal_tax_rate": marginal_tax_rate,
        "effective_tax_rate": tax_rate,
        "nol_balance": 0.0,
        "roic_stable": roic_stable,
        "terminal_growth": None,
        # `equity_bridge` yields a single net-debt figure; the engine takes cash
        # and debt separately and only their difference matters.
        "cash": baseline.cash,
        "debt": baseline.debt,
        "ipo_proceeds": 0.0,
        "shares_basic": baseline.shares,
        "shares_new": 0.0,
        "parent_case_id": None,
        "segments": [{
            "name": ticker.lower(),
            "base_revenue": baseline.base_revenue,
            "base_margin": baseline.base_margin,
            "tam_target": None,
            "market_share_target": None,
            "revenue_target": revenue_target,
            "margin_target": margin_target,
            "sales_to_capital_early": s2c,
            "sales_to_capital_late": s2c,
            "ramp_start_year": 1,
            "initial_growth": None,
            "waypoint_gap_fraction": None,
            "narratives": narratives,
        }],
    }
