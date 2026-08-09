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

# Bisection bounds for the year-1 growth rate. The lower bound stays above -1 so
# every (1 + g_t) factor is positive and the product stays monotone; the upper
# bound is far past any credible growth rate and costs nothing to carry.
_G1_LOW = -0.99
_G1_HIGH = 1000.0
_BISECTION_STEPS = 200


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
    year-1 rate down to `g_stable`. A segment starting from zero, or one held
    back by `ramp_start_year`, ramps linearly instead: no growth rate reaches a
    positive target from a base of zero.
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

    Years before `ramp_start_year` book zero regardless of the revenue series.
    For a segment ramping from a zero base the delta is already zero, but the
    guard also covers a segment held back from a non-zero base, where it is not.
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
        if ratio <= 0:
            raise ValueError(
                f"{spec.name}: sales_to_capital must be positive, got {ratio}"
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
