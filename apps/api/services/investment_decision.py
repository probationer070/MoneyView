"""Investment decisions: a durable, annotated record of what was believed and when.

Distinct from a snapshot, on purpose. Snapshots are telemetry over a universe and
expire at SNAPSHOT_RETENTION_DAYS = 365; a decision is one judgement about one
ticker and never expires. See docs/superpowers/specs/2026-09-03-snapshot-overhaul-design.md.
"""
from __future__ import annotations


def outcome_for(
    *,
    decided_at: str,
    price_at_decision: float | None,
    bars: list[dict],
) -> dict:
    """The price move since a decision, computed fresh from stored bars.

    Never stored. A persisted outcome is correct only until the next bar arrives
    and then silently wrong, with nothing to reveal it; computing on read cannot
    go stale.

    Both dates travel with the number because the move has a period and the
    figure it will sit beside -- gap to fair value -- does not. Reporting a bare
    percentage would invite the reader to supply a horizon that is not there.
    """
    decided_on = decided_at[:10]
    empty = {
        "decided_on": decided_on,
        "price_now": None,
        "price_date": None,
        "price_move": None,
        "reason": None,
    }
    if price_at_decision is None or price_at_decision <= 0:
        return {**empty, "reason": "no price recorded at decision time"}

    # A NULL close is not a price. `load_price_bars` documents that close passes
    # through exactly as stored, including NULL, and the caller must handle it.
    usable = [
        (str(bar["date"]), float(bar["close"]))
        for bar in bars
        if bar.get("close") is not None and str(bar["date"]) > decided_on
    ]
    if not usable:
        return {**empty, "reason": f"no bar with a close after {decided_on}"}

    price_date, price_now = usable[-1]
    return {
        "decided_on": decided_on,
        "price_now": price_now,
        "price_date": price_date,
        "price_move": (price_now - price_at_decision) / price_at_decision,
        "reason": None,
    }
