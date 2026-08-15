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

THE COST OF CAPITAL IS THE ONE FIELD WHERE THE COMPANY'S OWN VALUE ROUTINELY
WINS, so the benchmark acts as a FLOOR on it rather than a ceiling. It fades
`higher_is_conservative`, and across the real 2026 vintage only Technology's
sector average (0.0959) sits above a typical large-cap's own cost of capital;
every other sector's is lower and therefore holds. That is the correct
behaviour -- a company borrowing more expensively than its sector is not handed
its sector's cheaper capital -- but it means this field must carry the company's
MEASURED cost of capital. An invented company-side placeholder silently
overrides the benchmark in almost every sector instead of being overridden by
it, which is how a constant of `riskfree_rate + 0.045` came to set the discount
rate for 10 of 11 sectors and refuse Energy on an artifact rather than on
economics.

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

from packages.core_finance.industry_benchmark import FADE_DIRECTIONS, SectorBenchmark, fade

HORIZON_YEARS = 10

# `wacc_stable` always equals `wacc_initial` here (both take the same faded
# WACC), so `wacc_converge_from` never moves the WACC path -- it is flat by
# construction, and this constant only ever governs the tax-rate ramp. Even
# there it is inert whenever `effective_tax_rate` (== `max(marginal, sector)`)
# holds at the marginal rate, which is the common case: it only bites when a
# sector's average effective tax rate exceeds the company's marginal rate.
_TAX_RAMP_START = 6


@dataclass(frozen=True)
class CompanyBaseline:
    """What the company is today, from its own statements. Billions, fractions."""

    base_revenue: float
    base_margin: float
    current_roic: float
    current_sales_to_capital: float
    current_growth: float
    # A FRACTION, like every other rate here. `CorporateMetrics.wacc` is stored
    # in PERCENT -- AAPL is 10.0, MSFT 9.0 -- so whoever populates this baseline
    # divides by 100. That conversion is the single likeliest place for a 100x
    # error in this module.
    #
    # It is usually caught, but not by anything in this file: passing 10.0
    # discounts at 1000%, and `terminal_value` then refuses with "roic_stable
    # 20.0000% must exceed wacc_stable 1000.0000% when terminal growth is
    # positive" -- the capped `roic_stable` cannot outrun a percent-scale WACC.
    # That guard is gated on `g_stable > 0`, and terminal growth defaults to
    # `riskfree_rate`, so with a riskfree rate of ZERO OR BELOW nothing fires:
    # measured on this module's own fixture, `riskfree_rate=0.0` with a WACC of
    # 10.0 returns an enterprise value of 1.69 against the correct 274.80, with
    # no error raised. A negative or zero riskfree rate is the narrow band in
    # which this error is silent.
    current_wacc: float
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


def _missing_claim(column: str, vintage: str, company_value: float) -> str:
    """Why a field was NOT benchmarked, for the case where the column dropped out.

    `resolve_benchmark` omits any column with too few surviving industries, so a
    benchmark can arrive missing one. The field then holds the company's own
    value -- which is the right number -- but "the right number with no stated
    reason" is exactly what the narrative rule exists to prevent, and an empty
    claim clears both `_validate_narratives` (which only checks the field is
    named) and the `claim TEXT NOT NULL` column (empty strings are not NULL).
    A number that stores looking justified and is not is worse than a refusal.
    """
    return (
        f"No usable sector average for {column} in the {vintage} vintage: too "
        f"few industries survived screening. The company's own "
        f"{company_value:.4f} is held flat, unfaded."
    )


def _narrative(field: str, claim: str, vintage: str, three_p: str,
                *, source: str | None = None) -> dict:
    return {
        "input_field": field,
        "claim": claim,
        # Benchmark-derived fields default to the vintage they were faded
        # against; `base_revenue`/`base_margin` pass an explicit
        # `"stored_statements"` since they never touch the benchmark.
        "evidence_source": source or f"damodaran_industry_{vintage}",
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

    def faded(column: str, company_value: float, direction: str) -> tuple[float, dict]:
        """The faded value and the claim that justifies it -- never an empty one.

        A dropped column returns the company's own value with the claim that
        says so, rather than `None` for the caller to paper over: every path out
        of here carries provenance, so no narrative can be assembled empty.
        """
        average = benchmark.columns.get(column)
        if average is None:
            return company_value, {
                "claim": _missing_claim(column, vintage, company_value),
                # Weaker than any benchmarked claim: a held company value has no
                # sector corroboration at all, and `full_basket` below never
                # sees this path.
                "three_p": "plausible",
            }
        chosen = fade(company_value, average.value, direction,
                      year=HORIZON_YEARS, horizon=HORIZON_YEARS)
        three_p = "probable" if len(average.industries) == full_basket else "plausible"
        return chosen, {"claim": _claim(benchmark, column, vintage, company_value, chosen),
                        "three_p": three_p}

    margin_target, margin_meta = faded("operating_margin", baseline.base_margin,
                                       FADE_DIRECTIONS["operating_margin"])
    faded_roc, _ = faded("after_tax_roc", baseline.current_roic,
                         FADE_DIRECTIONS["after_tax_roc"])
    s2c, s2c_meta = faded("sales_to_capital", baseline.current_sales_to_capital,
                          FADE_DIRECTIONS["sales_to_capital"])
    growth, growth_meta = faded("revenue_growth", baseline.current_growth,
                                FADE_DIRECTIONS["revenue_growth"])
    # The company's own endpoint is the MARGINAL rate -- no tax benefit it has
    # not demonstrated. A sector averaging below that can only lift the early
    # years' cash flow, so `fade` holds; only a sector above it moves this.
    tax_rate, _ = faded("effective_tax_rate", marginal_tax_rate,
                       FADE_DIRECTIONS["effective_tax_rate"])
    wacc, _ = faded("cost_of_capital", baseline.current_wacc,
                    FADE_DIRECTIONS["cost_of_capital"])

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
                   f"years {baseline.source_years}.", vintage, "probable",
                   source="stored_statements"),
        _narrative("base_margin",
                   f"FY{baseline.source_years[-1]} operating income over revenue, "
                   f"from stored statements.", vintage, "probable",
                   source="stored_statements"),
        _narrative("revenue_target",
                   f"{baseline.base_revenue:.4f} compounded at {growth:.4f} for "
                   f"{HORIZON_YEARS} years. " + growth_meta["claim"],
                   vintage, growth_meta["three_p"]),
        _narrative("margin_target", margin_meta["claim"], vintage,
                   margin_meta["three_p"]),
        _narrative("sales_to_capital_early", s2c_meta["claim"], vintage,
                   s2c_meta["three_p"]),
        _narrative("sales_to_capital_late", s2c_meta["claim"], vintage,
                   s2c_meta["three_p"]),
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
        "wacc_converge_from": _TAX_RAMP_START,
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
