"""Segment build-up, target-year DCF -- pure Python.

Damodaran's young-company / big-market template, as reconstructed in
`guideline/sop/todo3.md`. Each business segment carries its own market size,
share, margin and capital intensity; the segments consolidate into one FCFF
stream discounted at a time-varying WACC.

Distinct from `dcf.py`, which values a single FCFF stream over five years at a
constant discount rate. Both are wanted; neither subsumes the other.

Everything here is pure: no I/O, no database, no network. Amounts are in
billions, share counts in billions of shares, rates as decimal fractions.
"""

from __future__ import annotations

from dataclasses import dataclass

from packages.core_finance.dcf import (
    calculate_equity_value,
    calculate_intrinsic_value_per_share,
)

# Bisection bounds for the year-1 growth rate. The lower bound stays above -1 so
# every (1 + g_t) factor is positive and the product stays monotone; the upper
# bound is far past any credible growth rate and costs nothing to carry.
_G1_LOW = -0.99
_G1_HIGH = 1000.0
_BISECTION_STEPS = 200

# The terminal formula holds margin at margin_target in perpetuity, so
# ROIC = sales_to_capital_late x margin x (1 - tau) with capital intensity fixed.
# A terminal ROIC that differs from the target-year marginal return is therefore
# not "competitive erosion" -- erosion is a margin story -- it is an unmodelled
# change in capital intensity (sales_to_capital), and that is equally unmodelled
# whether the terminal return sits above or below the marginal one. This bound
# caps how far the terminal block's implied capital intensity may drift from the
# target year's before the case is asserting a structural change the model does
# not contain. 0.60 rejects the historical defect value (roic_stable=0.12 implied
# a +210% capital-intensity increase on the post-prospectus case) while admitting
# both seeded cases (+12.6% post, +50.3% pre at roic_stable=0.33).
_TERMINAL_CAPITAL_INTENSITY_TOLERANCE = 0.60


@dataclass(frozen=True)
class SegmentSpec:
    """One business segment of a valuation case.

    `base_margin` is the **R&D-adjusted** operating margin. R&D capitalization is
    not implemented (see the spec, section 7.2), so the base margin is taken to
    already reflect the adjustment rather than having it applied on top.
    """

    name: str
    base_revenue: float
    base_margin: float
    margin_target: float
    sales_to_capital_early: float          # years 1..5
    sales_to_capital_late: float           # years 6..n
    tam_target: float | None = None
    market_share_target: float | None = None
    revenue_target: float | None = None
    ramp_start_year: int = 1

    def __post_init__(self) -> None:
        if self.ramp_start_year < 1:
            raise ValueError(
                f"{self.name}: ramp_start_year must be at least 1, got "
                f"{self.ramp_start_year}. Below 1 it produces a revenue path "
                f"longer than the horizon, which zip() then truncates -- the "
                f"target-year revenue silently misses its target."
            )
        if self.sales_to_capital_early <= 0:
            raise ValueError(
                f"{self.name}: sales_to_capital_early must be positive, got "
                f"{self.sales_to_capital_early}"
            )
        if self.sales_to_capital_late <= 0:
            raise ValueError(
                f"{self.name}: sales_to_capital_late must be positive, got "
                f"{self.sales_to_capital_late}"
            )

    def target_revenue(self) -> float:
        """Revenue in the target year -- todo3 R1.

        An explicit `revenue_target` wins over `tam x share`, which is how a
        segment with no meaningful addressable market (xAI, expansion options)
        states its endpoint directly.
        """
        if self.revenue_target is not None:
            return float(self.revenue_target)
        if self.tam_target is None or self.market_share_target is None:
            raise ValueError(
                f"{self.name}: need (tam_target x market_share_target) or an "
                f"explicit revenue_target"
            )
        return float(self.tam_target) * float(self.market_share_target)


def _decaying_growth_rates(g_first: float, n: int, g_stable: float) -> list[float]:
    """Growth decaying linearly from `g_first` in year 1 to `g_stable` in year n."""
    if n < 2:
        return [g_stable]
    return [
        g_first - (g_first - g_stable) * (t - 1) / (n - 1)
        for t in range(1, n + 1)
    ]


def _compound(g_first: float, n: int, g_stable: float) -> float:
    product = 1.0
    for rate in _decaying_growth_rates(g_first, n, g_stable):
        product *= 1.0 + rate
    return product


def _solve_first_year_growth(ratio: float, n: int, g_stable: float) -> float:
    """Find the year-1 growth whose decaying schedule compounds to `ratio`.

    The compounded product is strictly increasing in `g_first` -- every factor
    carries a non-negative weight on it -- so bisection converges without
    needing a derivative, and without a scipy dependency this repo does not have.
    """
    low, high = _G1_LOW, _G1_HIGH
    if not _compound(low, n, g_stable) <= ratio <= _compound(high, n, g_stable):
        raise ValueError(
            f"target revenue ratio {ratio:.6g} is unreachable with a decaying "
            f"growth path over {n} years ending at {g_stable:.4%}"
        )
    for _ in range(_BISECTION_STEPS):
        mid = (low + high) / 2
        if _compound(mid, n, g_stable) < ratio:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def _ramp_revenues(target: float, n: int, ramp_start_year: int) -> list[float]:
    """Zero until `ramp_start_year`, then linear to `target` in year n."""
    lead = ramp_start_year - 1
    steps = n - lead
    if steps < 1:
        raise ValueError(
            f"ramp_start_year {ramp_start_year} leaves no years to ramp over "
            f"within a {n}-year horizon"
        )
    return [0.0] * lead + [target * step / steps for step in range(1, steps + 1)]


def revenue_path(spec: SegmentSpec, n: int, g_stable: float) -> list[float]:
    """Revenue for years 1..n, terminating exactly on the target -- todo3 R3.

    Two shapes. A segment with revenue today decays its growth from a solved
    year-1 rate down to `g_stable`. A segment starting from zero ramps linearly
    instead: no growth rate reaches a positive target from a base of zero. A
    non-zero base combined with `ramp_start_year > 1` is incoherent and raises.
    """
    target = spec.target_revenue()
    if target <= 0:
        raise ValueError(f"{spec.name}: target revenue must be positive, got {target}")

    if spec.base_revenue < 0:
        raise ValueError(f"{spec.name}: base_revenue must not be negative")

    if spec.ramp_start_year > 1 and spec.base_revenue > 0:
        raise ValueError(
            f"{spec.name}: ramp_start_year={spec.ramp_start_year} is incoherent "
            f"with base_revenue={spec.base_revenue}; a segment already earning "
            f"revenue today cannot also be a delayed-start ramp"
        )

    if spec.ramp_start_year > 1 or spec.base_revenue == 0:
        return _ramp_revenues(target, n, spec.ramp_start_year)

    g_first = _solve_first_year_growth(target / spec.base_revenue, n, g_stable)
    revenues: list[float] = []
    level = spec.base_revenue
    for rate in _decaying_growth_rates(g_first, n, g_stable):
        level *= 1.0 + rate
        revenues.append(level)
    return revenues


_EARLY_YEARS = 5


def margin_path(spec: SegmentSpec, n: int) -> list[float]:
    """Operating margin for years 1..n -- todo3 P2.

    Converges linearly from `base_margin` in year 1 to `margin_target` in year n:
    phi(1) = 1, phi(n) = 0. todo3 notes Damodaran typically back-loads this
    convergence, but tags the shape as unconfirmed. An invented back-loading
    exponent would be precision the source does not support, so this stays linear
    until the spreadsheets are available to calibrate it.
    """
    if n < 2:
        return [spec.margin_target]
    spread = spec.margin_target - spec.base_margin
    return [
        spec.margin_target - spread * (n - t) / (n - 1)
        for t in range(1, n + 1)
    ]


def reinvestment(revenues: list[float], spec: SegmentSpec) -> list[float]:
    """Capital consumed per year -- todo3 I1.

    `(Rev_t - Rev_t-1) / salesToCapital_t`. This is the only reinvestment
    mechanism in the template: there is no separate capex, depreciation or
    working-capital schedule to reconcile against.

    Years before `ramp_start_year` book zero regardless of the revenue series. For
    a segment ramping from a zero base the delta is already zero, so the guard is
    redundant in practice -- `revenue_path` rejects a non-zero base combined with
    `ramp_start_year > 1`, and `SegmentSpec` now rejects `ramp_start_year < 1`. It
    stays because this function is public and takes an arbitrary revenues list.

    The sales-to-capital ratios are no longer checked here. `SegmentSpec` validates
    them at construction, which also covers a delayed segment whose early ratio no
    year ever reaches -- a case this loop could not see.
    """
    amounts: list[float] = []
    previous = spec.base_revenue
    for index, revenue in enumerate(revenues):
        year = index + 1
        if year < spec.ramp_start_year:
            amounts.append(0.0)
            previous = revenue
            continue
        ratio = (
            spec.sales_to_capital_early
            if year <= _EARLY_YEARS
            else spec.sales_to_capital_late
        )
        amounts.append((revenue - previous) / ratio)
        previous = revenue
    return amounts


def tax_path(
    ebit: list[float],
    marginal_rate: float,
    nol_balance: float,
) -> list[float]:
    """Tax paid per year, net of accumulated losses -- todo3 F2.

    Returns amounts, not rates. A company with a loss carryforward pays nothing
    until the balance is exhausted, which is not a detail: it moves cash flow
    into the early years, where discounting hurts it least.

    Losses in the forecast add to the balance rather than generating a refund.
    """
    taxes: list[float] = []
    balance = float(nol_balance)
    for amount in ebit:
        if amount <= 0:
            balance += -amount
            taxes.append(0.0)
            continue
        shield = min(balance, amount)
        balance -= shield
        taxes.append((amount - shield) * marginal_rate)
    return taxes


def wacc_path(
    wacc_initial: float,
    wacc_stable: float,
    n: int,
    converge_from: int,
) -> list[float]:
    """Cost of capital per year -- todo3 F3.

    Flat at `wacc_initial` through year `converge_from - 1`, then linear to
    `wacc_stable` in year n. A young firm's risk profile migrates toward the
    market as it matures, so a single constant rate over ten years is wrong in
    a way that compounds.
    """
    if not 1 <= converge_from <= n:
        raise ValueError(
            f"converge_from must be between 1 and {n}, got {converge_from}"
        )
    lead = converge_from - 1
    span = n - lead
    spread = wacc_stable - wacc_initial
    return [
        wacc_initial if t <= lead else wacc_initial + spread * (t - lead) / span
        for t in range(1, n + 1)
    ]


def discount_factors(waccs: list[float]) -> list[float]:
    """Present-value factors for a time-varying discount rate -- todo3 F4.

    A cumulative product: DF_t = DF_t-1 / (1 + w_t). NOT 1 / (1 + w)^t, which is
    only correct when every rate is identical and is the standard way this model
    gets silently mis-implemented.
    """
    factors: list[float] = []
    accumulated = 1.0
    for wacc in waccs:
        if wacc <= -1:
            raise ValueError(f"wacc must exceed -100%, got {wacc}")
        accumulated /= 1.0 + wacc
        factors.append(accumulated)
    return factors


@dataclass(frozen=True)
class CaseSpec:
    """Firm-level inputs for one valuation case.

    `terminal_growth` is optional and defaults to `riskfree_rate`, which is what
    Damodaran uses. It exists as a separate field so the cap in todo3 F5 has
    something to reject: a value *defined* as the riskfree rate could never
    exceed it, and the rule would be unenforceable.
    """

    base_year: int
    target_year: int
    riskfree_rate: float
    wacc_initial: float
    wacc_stable: float
    wacc_converge_from: int
    marginal_tax_rate: float
    nol_balance: float
    roic_stable: float
    cash: float
    debt: float
    ipo_proceeds: float
    shares_basic: float
    shares_new: float
    terminal_growth: float | None = None

    def __post_init__(self) -> None:
        if self.target_year <= self.base_year:
            raise ValueError(
                f"target_year {self.target_year} must be after base_year {self.base_year}"
            )
        if self.terminal_growth is not None and self.terminal_growth > self.riskfree_rate:
            raise ValueError(
                f"terminal growth {self.terminal_growth:.4%} exceeds the riskfree "
                f"rate {self.riskfree_rate:.4%} -- perpetual growth is capped there"
            )
        if self.shares_basic <= 0:
            raise ValueError(f"shares_basic must be positive, got {self.shares_basic}")
        if self.nol_balance < 0:
            raise ValueError(
                f"nol_balance must not be negative, got {self.nol_balance}. "
                f"tax_path adds a negative balance to the taxable base, which "
                f"overstates tax without raising."
            )
        if not 0.0 <= self.marginal_tax_rate <= 1.0:
            raise ValueError(
                f"marginal_tax_rate must be a decimal fraction between 0 and 1, "
                f"got {self.marginal_tax_rate}. A percentage such as 25.0 makes "
                f"(1 - tau) negative and returns a large negative valuation with "
                f"no error."
            )

    @property
    def horizon(self) -> int:
        return self.target_year - self.base_year

    def effective_terminal_growth(self) -> float:
        if self.terminal_growth is None:
            return self.riskfree_rate
        return self.terminal_growth


@dataclass(frozen=True)
class SegmentResult:
    name: str
    revenue: list[float]
    margin: list[float]
    ebit: list[float]
    reinvestment: list[float]


@dataclass(frozen=True)
class CaseResult:
    segments: list[SegmentResult]
    revenue: list[float]
    ebit: list[float]
    tax: list[float]
    reinvestment: list[float]
    fcff: list[float]
    wacc: list[float]
    discount_factor: list[float]
    pv_explicit: float
    terminal_value: float
    pv_terminal: float
    enterprise_value: float
    equity_value: float
    value_per_share_basic: float
    value_per_share_diluted: float
    terminal_spread: float
    terminal_value_share_pct: float
    base_revenue_total: float
    base_ebit_total: float
    marginal_roic_target_year: float
    terminal_reinvestment_rate: float
    reinvestment_rate_target_year: float
    explicit_reinvestment_rate_at_stable_growth: float


def marginal_roic(segments: list[SegmentSpec], marginal_tax_rate: float) -> float:
    """Capital-weighted after-tax return on NEW capital in the target year.

    ROIC is a ratio of aggregates, dNOPAT / dCapital, so combining segments must
    weight by the denominator -- incremental capital -- not by revenue:

        marginal_roic = sum_i( revenue_i x margin_target_i x (1 - tau) )
                       / sum_i( revenue_i / sales_to_capital_late_i )

    This is the only weighting under which `ReinvRate = g / ROIC` is an identity.
    In perpetuity every segment grows at `g`, so dRevenue_i = g x revenue_i and
    dCapital_i = dRevenue_i / sales_to_capital_late_i = g x revenue_i /
    sales_to_capital_late_i. Summing: dNOPAT = g x sum(revenue_i x margin_i x
    (1-tau)), dCapital = g x sum(revenue_i / s2c_i), and the `g`s cancel in the
    ratio -- exactly the expression above. Weighting by revenue instead (the
    previous implementation) overstates the firm's marginal return whenever
    sales-to-capital varies across segments, which is exactly the property that
    justifies modelling segments separately at all.

    This is the quantity the terminal reinvestment rate `g / ROIC` actually
    governs, which is why the consistency guard in `run_case` compares against it.
    todo3's I3 states ROIC as `EBIT(1-tau) / InvestedCapital`, a *level* return --
    but that needs an invested-capital base the case does not carry, and it blends
    in legacy capital that no longer drives growth. Deliberate deviation.

    Revenue comes from `spec.target_revenue()` rather than a computed path. It is
    equal to the computed path's last value by construction -- the revenue path
    terminates exactly on target -- and taking it from the spec keeps this
    function callable without running a case.
    """
    if not segments:
        raise ValueError("marginal_roic needs at least one segment")

    after_tax = 1.0 - marginal_tax_rate
    total_nopat = 0.0
    total_capital = 0.0
    for spec in segments:
        revenue = spec.target_revenue()
        total_nopat += revenue * spec.margin_target * after_tax
        total_capital += revenue / spec.sales_to_capital_late

    if total_capital <= 0:
        raise ValueError(
            "marginal_roic needs a positive total target-year capital "
            f"(revenue / sales_to_capital_late) to weight by, got {total_capital:.6g}"
        )
    return total_nopat / total_capital


def terminal_value(
    ebit_n: float,
    marginal_rate: float,
    g_stable: float,
    roic_stable: float,
    wacc_stable: float,
) -> float:
    """Gordon growth terminal value with consistent reinvestment -- todo3 F6-F8.

    Three guards, all raising rather than warning or flooring:

    - the WACC-to-growth spread must be positive, and is not clamped to some
      epsilon: a large finite number at the point where the model has no value
      is worse than no number at all (the argument at dcf.py:196)
    - ROIC in stable growth must beat the cost of capital whenever growth is
      positive, or the perpetuity is growing while destroying value
    - ROIC must be positive, or the reinvestment rate is undefined
    """
    spread = wacc_stable - g_stable
    if spread <= 0:
        raise ValueError(
            f"terminal spread is not positive: wacc {wacc_stable:.4%} must exceed "
            f"growth {g_stable:.4%}"
        )
    if roic_stable <= 0:
        raise ValueError(f"roic_stable must be positive, got {roic_stable}")
    if g_stable > 0 and roic_stable <= wacc_stable:
        raise ValueError(
            f"roic_stable {roic_stable:.4%} must exceed wacc_stable "
            f"{wacc_stable:.4%} when terminal growth is positive, otherwise "
            f"terminal growth destroys value"
        )
    reinvestment_rate = g_stable / roic_stable
    fcff_next = ebit_n * (1 + g_stable) * (1 - marginal_rate) * (1 - reinvestment_rate)
    return fcff_next / spread


def run_case(case: CaseSpec, segments: list[SegmentSpec]) -> CaseResult:
    """Value one case end to end: segments in, value per share out."""
    if not segments:
        raise ValueError("a valuation case needs at least one segment")

    n = case.horizon
    g_stable = case.effective_terminal_growth()

    segment_results: list[SegmentResult] = []
    for spec in segments:
        revenues = revenue_path(spec, n, g_stable)
        margins = margin_path(spec, n)
        segment_results.append(
            SegmentResult(
                name=spec.name,
                revenue=revenues,
                margin=margins,
                ebit=[r * m for r, m in zip(revenues, margins)],
                reinvestment=reinvestment(revenues, spec),
            )
        )

    revenue = [sum(s.revenue[t] for s in segment_results) for t in range(n)]
    ebit = [sum(s.ebit[t] for s in segment_results) for t in range(n)]
    reinvest = [sum(s.reinvestment[t] for s in segment_results) for t in range(n)]

    tax = tax_path(ebit, case.marginal_tax_rate, case.nol_balance)
    fcff = [ebit[t] - tax[t] - reinvest[t] for t in range(n)]

    waccs = wacc_path(case.wacc_initial, case.wacc_stable, n, case.wacc_converge_from)
    factors = discount_factors(waccs)

    target_year_marginal_roic = marginal_roic(segments, case.marginal_tax_rate)
    target_year_nopat = ebit[-1] * (1 - case.marginal_tax_rate)

    # Two-sided. A terminal return ABOVE the marginal return is inconsistent with
    # the stated assumptions: margins have converged to margin_target by the
    # target year and sales_to_capital_late does not change afterwards, so
    # nothing in the model produces the improvement in returns such a case
    # asserts.
    if case.roic_stable > target_year_marginal_roic:
        raise ValueError(
            f"roic_stable {case.roic_stable:.4%} exceeds the target-year marginal "
            f"return on new capital {target_year_marginal_roic:.4%}. Margins have "
            f"already converged and sales-to-capital does not change after the "
            f"target year, so the model contains no mechanism by which returns on "
            f"new capital could improve."
        )

    # A terminal return too far BELOW the marginal return is not "competitive
    # erosion" either. The terminal formula holds margin at margin_target in
    # perpetuity, so with margin fixed, ROIC = sales_to_capital x margin x
    # (1 - tau): the only thing a lower terminal ROIC can express is a lower
    # implied sales-to-capital, i.e. more capital intensity -- an unmodelled
    # structural change, equally unsupported in either direction. See
    # `_TERMINAL_CAPITAL_INTENSITY_TOLERANCE` for the bound and its grounding.
    if target_year_marginal_roic / case.roic_stable > 1 + _TERMINAL_CAPITAL_INTENSITY_TOLERANCE:
        capital_intensity_increase = target_year_marginal_roic / case.roic_stable - 1
        raise ValueError(
            f"roic_stable {case.roic_stable:.4%} is too far below the target-year "
            f"marginal return on new capital {target_year_marginal_roic:.4%}: it "
            f"implies a {capital_intensity_increase:.1%} increase in capital "
            f"intensity (sales-to-capital falling) beyond the target year, and the "
            f"model contains no mechanism producing that."
        )

    pv_explicit = sum(fcff[t] * factors[t] for t in range(n))
    tv = terminal_value(
        ebit_n=ebit[-1],
        marginal_rate=case.marginal_tax_rate,
        g_stable=g_stable,
        roic_stable=case.roic_stable,
        wacc_stable=case.wacc_stable,
    )
    pv_terminal = tv * factors[-1]
    enterprise_value = pv_explicit + pv_terminal

    # todo3 E1/E3: IPO proceeds are held as cash, so they are a firm-value term,
    # not an enterprise-value one. Expressed through the shared bridge helper --
    # EV + cash + proceeds - debt is EV - net_debt + non_operating_assets.
    equity_value = calculate_equity_value(
        enterprise_value=enterprise_value,
        net_debt=case.debt - case.cash,
        non_operating_assets=case.ipo_proceeds,
    )

    return CaseResult(
        segments=segment_results,
        revenue=revenue,
        ebit=ebit,
        tax=tax,
        reinvestment=reinvest,
        fcff=fcff,
        wacc=waccs,
        discount_factor=factors,
        pv_explicit=pv_explicit,
        terminal_value=tv,
        pv_terminal=pv_terminal,
        enterprise_value=enterprise_value,
        equity_value=equity_value,
        value_per_share_basic=calculate_intrinsic_value_per_share(
            equity_value, case.shares_basic
        ),
        value_per_share_diluted=calculate_intrinsic_value_per_share(
            equity_value, case.shares_basic + case.shares_new
        ),
        terminal_spread=case.wacc_stable - g_stable,
        terminal_value_share_pct=(
            pv_terminal / enterprise_value * 100 if enterprise_value else 0.0
        ),
        base_revenue_total=sum(s.base_revenue for s in segments),
        base_ebit_total=sum(s.base_revenue * s.base_margin for s in segments),
        marginal_roic_target_year=target_year_marginal_roic,
        terminal_reinvestment_rate=g_stable / case.roic_stable,
        # Zero NOPAT makes the ratio undefined rather than infinite. Reported as
        # 0.0, matching how `terminal_value_share_pct` above handles a zero
        # enterprise value. A negative NOPAT is left as a negative rate: a firm
        # reinvesting while losing money is a real state worth seeing.
        reinvestment_rate_target_year=(
            reinvest[-1] / target_year_nopat if target_year_nopat else 0.0
        ),
        # The rate the explicit period's own economics (marginal ROIC) would
        # require at the terminal growth rate -- struck at the SAME growth as
        # `terminal_reinvestment_rate`, unlike `reinvestment_rate_target_year`
        # above, which is struck at whatever year-10 aggregate growth happens to
        # be. The two are therefore directly comparable: they differ only through
        # roic_stable vs marginal_roic, not through a mismatched growth rate.
        explicit_reinvestment_rate_at_stable_growth=(
            g_stable / target_year_marginal_roic
        ),
    )
