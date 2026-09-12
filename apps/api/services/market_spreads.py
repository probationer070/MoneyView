"""Theme and policy spreads: relative strength between two tickers, with the basis stated.

`SPREAD_PAIRS` is the single source of truth for which pairs exist and which tickers they
need. Tickers are pulled through `MarketDataService.get_stock_ohlcv`, the same lazy path the
detail page uses for a ticker nobody has opened -- cache read, background refresh past the
daily boundary.

Registering these by adding them to the watchlist was rejected: it is the only implemented
acquisition trigger, but it would put six instruments the user does not hold into the
portfolio grid and into its holdings count. There is no scheduled warmer to hook instead --
`schedule_acquisition`'s own docstring says so -- and `MONEYVIEW_PREWARM_TICKERS` is
per-machine configuration rather than a registry that travels with the repository.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Optional

from apps.api.services.market_data import MarketDataService
from packages.core_finance.relative_strength import DEFAULT_WINDOW_DAYS, relative_strength

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SpreadPair:
    id: str
    label: str
    numerator: str
    denominator: str


# The proxy choice is editorial and cannot be derived: "AI" has no price, so BOTZ stands in
# for it. The mitigation is that the label names the proxy, so a reader can reject it rather
# than being told a fact. ARKQ, HACK and CLOU are live alternatives verified 2026-09-12.
SPREAD_PAIRS: tuple[SpreadPair, ...] = (
    SpreadPair("ai", "AI", "BOTZ", "^GSPC"),
    SpreadPair("cybersecurity", "Cybersecurity", "CIBR", "^GSPC"),
    SpreadPair("cloud", "Cloud", "SKYY", "^GSPC"),
    SpreadPair("energy_policy", "Energy policy", "ICLN", "XLE"),
    SpreadPair("defence", "Defence", "ITA", "^GSPC"),
)


def build_spreads(
    window_days: int = DEFAULT_WINDOW_DAYS,
    *,
    service: Optional[MarketDataService] = None,
) -> List[dict]:
    """One row per pair, each either a series with a basis or a stated refusal."""
    market = service if service is not None else MarketDataService()
    window_start = (date.today() - timedelta(days=window_days)).isoformat()

    rows: List[dict] = []
    for pair in SPREAD_PAIRS:
        numerator = _closes_by_date(market, pair.numerator)
        denominator = _closes_by_date(market, pair.denominator)
        result = relative_strength(numerator, denominator, window_start=window_start)

        if result.refused_reason is not None:
            rows.append(_refused(pair, window_days, result.refused_reason))
            continue

        points = [{"date": point.date, "value": point.value} for point in result.points]
        first, last = result.points[0].date, result.points[-1].date
        rows.append({
            "id": pair.id,
            "label": pair.label,
            "numerator": pair.numerator,
            "denominator": pair.denominator,
            "requested_window_days": window_days,
            "actual_window_start": first,
            "actual_window_end": last,
            "actual_window_days": (date.fromisoformat(last) - date.fromisoformat(first)).days,
            "observations": len(points),
            "basis": (
                f"({pair.numerator}_t / {pair.numerator}_0) / "
                f"({pair.denominator}_t / {pair.denominator}_0) x 100, "
                f"indexed to 100 at {result.base_date}"
            ),
            "series": points,
            "latest": points[-1]["value"],
            "refused_reason": None,
        })
    return rows


def _refused(pair: SpreadPair, window_days: int, reason: str) -> dict:
    return {
        "id": pair.id,
        "label": pair.label,
        "numerator": pair.numerator,
        "denominator": pair.denominator,
        "requested_window_days": window_days,
        "actual_window_start": None,
        "actual_window_end": None,
        "actual_window_days": None,
        "observations": 0,
        # Stated even on a refusal: the reader still needs to know what was attempted.
        "basis": (
            f"({pair.numerator}_t / {pair.numerator}_0) / "
            f"({pair.denominator}_t / {pair.denominator}_0) x 100"
        ),
        "series": [],
        "latest": None,
        "refused_reason": reason,
    }


def _closes_by_date(market, ticker: str) -> Dict[str, float]:
    """Bars as date to close, dropping bars with no usable close.

    A missing close is dropped rather than coerced: an unsettled bar stored as 0.0 once made
    136 of 139 tickers read as a -100% collapse (ERROR-LOG 2026-09-09).

    The table MUST be routed explicitly. `get_stock_ohlcv` defaults to `table="stocks"`, and
    `^GSPC` -- the benchmark for four of the five pairs -- lives in `indices`. Reading it from
    `stocks` returns nothing, so every one of those pairs would refuse with "no overlapping
    history", a reason pointing at the data rather than at this line.
    """
    table = MarketDataService._table_for_ticker(ticker)
    bars = market.get_stock_ohlcv(ticker, period="5y", table=table)
    return {bar.date: float(bar.close) for bar in bars if bar.close is not None}
