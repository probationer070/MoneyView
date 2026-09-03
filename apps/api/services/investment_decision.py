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


from datetime import datetime, timezone

from apps.api.services.db import get_db

ACTIONS = ("buy", "sell", "watch", "pass")

# Defaults matching the assumptions the comparison table ships with. DECIMAL
# scale (0.042 == 4.2%), matching the codebase-wide contract documented in
# packages/core_finance/expected_return.py and used by corporate_statement_metrics.py.
# `investment_decision` stores these rates as-is (decimal); this differs from
# `corporate_comparison_snapshots_v3`, which stores `round(rate * 100, 2)`.
DEFAULT_RISK_FREE_RATE = 0.042
DEFAULT_EQUITY_RISK_PREMIUM = 0.055


def _default_figures_loader(
    ticker: str, *, risk_free_rate: float, equity_risk_premium: float
) -> dict:
    """Capture the model's view of `ticker` right now, from the same function
    that produces the comparison table's figures."""
    from apps.api.services import corporate_metrics_service
    from apps.api.services.corporate_comparison import _dcf_snapshot

    metrics = corporate_metrics_service.metrics_for_ticker(ticker)
    dcf = _dcf_snapshot(
        ticker=ticker,
        metrics=metrics,
        price_loader=corporate_metrics_service.latest_market_price,
        risk_free_rate=risk_free_rate,
        equity_risk_premium=equity_risk_premium,
    )
    return {
        "price_at_decision": float(dcf["current_price"]),
        "dcf_value": float(dcf["estimated_value"]),
        "dcf_implied_return": float(dcf["dcf_implied_return"]),
        "roic": round(float(metrics.roic), 2),
        "wacc": round(float(metrics.wacc), 2),
        "source": "corporate_comparison._dcf_snapshot",
    }


def record_decision(
    *,
    ticker: str,
    action: str,
    memo: str,
    risk_free_rate: float = DEFAULT_RISK_FREE_RATE,
    equity_risk_premium: float = DEFAULT_EQUITY_RISK_PREMIUM,
    figures_loader=None,
) -> int:
    """Persist one decision, capturing the model's figures HERE rather than
    accepting them from the caller.

    A figure supplied by a browser could be stale, rounded for display, or read
    from a page opened an hour earlier, and would be stored as what the user
    believed with no way to tell the difference later. Capturing server-side
    makes the record self-certifying; `figures_source` names where it came from.
    """
    from apps.api.services.corporate_comparison import METRIC_SCHEMA_VERSION

    ticker = ticker.upper().strip()
    if action not in ACTIONS:
        raise ValueError(f"action must be one of {', '.join(ACTIONS)}, got {action!r}")
    if not memo.strip():
        raise ValueError("memo is required: a decision without a stated reason is a snapshot")

    if figures_loader is not None:
        loader = figures_loader
    else:
        loader = lambda t: _default_figures_loader(
            t, risk_free_rate=risk_free_rate, equity_risk_premium=equity_risk_premium
        )

    figures: dict | None = None
    unavailable: str | None = None
    try:
        figures = loader(ticker)
    except (ValueError, KeyError, TypeError) as exc:
        # The model could not value this ticker. Record the decision anyway with
        # the reason in place of the numbers -- refusing outright would drop the
        # memo, which is the part that cannot be reconstructed later.
        unavailable = str(exc)
    else:
        # `latest_market_price` returns 0.0 rather than raising when nothing is
        # stored, so an absent price arrives as a number, not an exception -- for
        # the default loader and potentially for an injected one too. Checked
        # here, not only inside `_default_figures_loader`, so the guarantee holds
        # for either. A non-positive price is the clear, checkable signal that the
        # model could not value the ticker; `outcome_for` already treats
        # `price_at_decision <= 0` as "no price recorded". Without this check the
        # row would store fallback-derived figures as though they were captured,
        # with `figures_unavailable_reason` left NULL. Spec section 3.3.
        price = figures.get("price_at_decision")
        if price is None or price <= 0:
            unavailable = (
                f"no stored price for {ticker}: the model cannot value it at this time"
            )
            figures = None

    with get_db() as conn:
        cursor = conn.execute(
            """INSERT INTO investment_decision
               (ticker, decided_at, action, memo, price_at_decision, dcf_value,
                dcf_implied_return, roic, wacc, risk_free_rate, equity_risk_premium,
                metric_schema_version, figures_source, figures_unavailable_reason)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                ticker,
                datetime.now(timezone.utc).isoformat(),
                action,
                memo.strip(),
                (figures or {}).get("price_at_decision"),
                (figures or {}).get("dcf_value"),
                (figures or {}).get("dcf_implied_return"),
                (figures or {}).get("roic"),
                (figures or {}).get("wacc"),
                risk_free_rate if figures else None,
                equity_risk_premium if figures else None,
                METRIC_SCHEMA_VERSION if figures else None,
                (figures or {}).get("source", "unavailable"),
                unavailable,
            ),
        )
        return int(cursor.lastrowid)
