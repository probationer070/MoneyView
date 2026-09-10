"""Choosing a terminal growth rate, and saying which bound chose it.

Gordon growth is `TV = FCFF x (1 + g) / (WACC - g)`, so the entire terminal value turns on
the spread `WACC - g`. The previous implementation bounded `g` only by `WACC - 0.005`,
which keeps the denominator away from zero and says nothing about whether `g` is a rate any
company could sustain for ever. On this repository's watchlist that single bound decided
terminal growth for 23 of 40 tickers, each then valued at roughly 203x-228x FCFF.

Three bounds, three jobs:

- `company_growth`  -- what this company is doing
- `ceiling`         -- what an economy permits in perpetuity
- `wacc - margin`   -- what the arithmetic permits

`ceiling=None` omits the middle one, which reproduces the previous behaviour exactly. That
is deliberate: it lets the diagnostic ship before any number moves.
"""

from __future__ import annotations

from dataclasses import dataclass

SAFETY_MARGIN = 0.005
"""Distance below WACC at which the Gordon denominator is treated as unsafe.

Unchanged from the previous implementation. The defect was that this bound was doing the
ceiling's job, not that 50bp is the wrong distance -- and moving both at once would make
the improvement impossible to attribute.
"""

TERMINAL_GROWTH_CEILING = 0.03
"""Long-run nominal economic growth: the most a firm can compound at for ever.

A parameter with a stated basis, not a measurement. No field in this repository expresses
long-run growth -- `industry_benchmark.revenue_growth` is a trailing five-year average
reaching +47.8%, which is a recovery, not a perpetuity.
"""


@dataclass(frozen=True)
class TerminalGrowthDerivation:
    """The chosen rate and the bounds it was chosen from."""

    rate: float
    binding_constraint: str
    company_growth: float
    ceiling: float | None
    wacc_safety_bound: float


def derive_terminal_growth(
    company_growth: float,
    wacc: float,
    *,
    ceiling: float | None = None,
    safety_margin: float = SAFETY_MARGIN,
) -> TerminalGrowthDerivation:
    """Terminal growth, plus which of its bounds produced it."""
    wacc_safety_bound = wacc - safety_margin

    # Ordered so that an exact tie reports the economic bound rather than the arithmetic
    # one. A reader told "wacc_safety" concludes the model was cornered; told "ceiling"
    # they conclude a judgement was applied. When both are true, the judgement is the
    # more useful answer.
    candidates: list[tuple[str, float]] = [("company", company_growth)]
    if ceiling is not None:
        candidates.append(("ceiling", ceiling))
    candidates.append(("wacc_safety", wacc_safety_bound))

    binding_constraint, rate = min(candidates, key=lambda item: item[1])

    return TerminalGrowthDerivation(
        rate=rate,
        binding_constraint=binding_constraint,
        company_growth=company_growth,
        ceiling=ceiling,
        wacc_safety_bound=wacc_safety_bound,
    )
