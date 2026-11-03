"""Relative pricing: a company's own figures at its industry's multiples, per share -- pure.

Every money and share term is in billions, so each function returns currency per share
with no scaling. Callers screen their inputs (missing figures, non-positive earnings);
these functions do no guarding of their own.
"""

from __future__ import annotations

import statistics


def ev_sales_value_per_share(ev_sales: float, revenue: float, net_debt: float, shares: float) -> float:
    """(EV/Sales x revenue - net debt) / shares: the equity value per share at an industry multiple."""
    return (ev_sales * revenue - net_debt) / shares


def pe_value_per_share(pe: float, eps: float) -> float:
    """P/E x diluted EPS."""
    return pe * eps


def pb_value_per_share(pb: float, book_equity: float, shares: float) -> float:
    """P/B x book equity / shares."""
    return pb * book_equity / shares


def value_range(values: list[float]) -> dict | None:
    """Low, median and high of the valued multiples, or None when none were valued."""
    if not values:
        return None
    return {"low": min(values), "mid": statistics.median(values), "high": max(values)}
