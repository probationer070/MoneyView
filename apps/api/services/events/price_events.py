"""Computed events: episodes detected in cached daily closes (todo I-C2).

These are not asserted facts from a cited page, so they are served with origin `computed`, no
`source`, and a `basis` that records the symbol, the rule and the closes that produced them. The
events are recomputed on every request from whatever is cached, and the closes can change when
the cache is refreshed, so the basis states the exact values used and the last date read.

The detectors are pure: a list of (ISO date, close) pairs in, events out. They know nothing
about the database, the registry or the UI.
"""

from __future__ import annotations

from datetime import date
from typing import Callable, Sequence

from apps.api.models.schemas import ComputedBasis, MarketEvent
from apps.api.services.db import get_db
from apps.api.services.events.sources import event_overlaps

Closes = Sequence[tuple[str, float]]

DRAWDOWN_SYMBOL = "^GSPC"
DRAWDOWN_CATEGORY = "drawdown"
# A decline of at least this much below the highest close before it: the conventional
# "correction" line. A bear market (20%) is a deeper episode of the same rule, not a second one.
DRAWDOWN_THRESHOLD = 0.10

OIL_SYMBOL = "CL=F"
OIL_CATEGORY = "oil-shock"
OIL_THRESHOLD = 0.20
# About one trading month.
OIL_LOOKBACK_SESSIONS = 20

# A move stated as exactly the threshold qualifies. In floats 80/100 - 1 is -0.19999999999999996,
# so the comparison allows this much slack rather than letting representation decide the edge.
_EDGE = 1e-9


def _pct(fraction: float) -> float:
    return round(fraction * 100.0, 2)


def detect_drawdowns(closes: Closes, *, symbol: str = DRAWDOWN_SYMBOL,
                     threshold: float = DRAWDOWN_THRESHOLD) -> list[MarketEvent]:
    """Peak-to-trough declines of at least `threshold`.

    The peak is the highest close before the decline. The episode begins the first time a close
    sits at least `threshold` below that peak, and ends when a close regains the peak. The
    event spans peak to trough, where the trough is the lowest close before the recovery. An
    episode not recovered by the last close is reported as ongoing, with the low so far.
    """
    if not closes:
        return []
    events: list[MarketEvent] = []
    peak = closes[0]
    trough: tuple[str, float] | None = None
    for day, close in closes[1:]:
        if trough is None:
            if close >= peak[1]:
                peak = (day, close)
            elif close / peak[1] - 1.0 <= -threshold + _EDGE:
                trough = (day, close)
        elif close >= peak[1]:
            events.append(_drawdown_event(symbol, threshold, peak, trough, closes[-1][0], ongoing=False))
            peak, trough = (day, close), None
        elif close < trough[1]:
            trough = (day, close)
    if trough is not None:
        events.append(_drawdown_event(symbol, threshold, peak, trough, closes[-1][0], ongoing=True))
    return events


def _drawdown_event(symbol: str, threshold: float, peak: tuple[str, float], trough: tuple[str, float],
                    as_of: str, *, ongoing: bool) -> MarketEvent:
    change = _pct(trough[1] / peak[1] - 1.0)
    basis = ComputedBasis(
        symbol=symbol, data_basis="daily_close", rule="drawdown_from_prior_peak",
        threshold_pct=_pct(threshold), lookback_sessions=None, direction="down", change_pct=change,
        from_date=peak[0], from_close=peak[1], to_date=trough[0], to_close=trough[1],
        ongoing=ongoing, as_of=as_of,
    )
    status = (f"Not regained as of the last cached close ({as_of}); the trough is the low so far."
              if ongoing else "It ended when a close regained the peak.")
    note = (
        f"Computed from cached daily closes of {symbol}: {change:+.2f}% from the peak close "
        f"{peak[1]:.2f} on {peak[0]} to the trough close {trough[1]:.2f} on {trough[0]}. Rule: a "
        f"close at least {basis.threshold_pct:g}% below the highest close before it. {status}"
    )
    return MarketEvent(
        id=f"drawdown-{symbol.lstrip('^').lower()}-{peak[0]}",
        label=f"S&P 500 drawdown {change:+.1f}%" + (" (ongoing)" if ongoing else ""),
        category=DRAWDOWN_CATEGORY, start_date=peak[0], end_date=trough[0], source=None,
        note=note, origin="computed", basis=basis,
    )


def detect_oil_shocks(closes: Closes, *, symbol: str = OIL_SYMBOL, threshold: float = OIL_THRESHOLD,
                      lookback: int = OIL_LOOKBACK_SESSIONS) -> list[MarketEvent]:
    """Moves of at least `threshold` over `lookback` sessions, one event per episode.

    A session qualifies when its close is at least `threshold` above (up) or below (down) the
    close `lookback` sessions earlier. Up and down are separate. Qualifying sessions whose
    windows overlap form one episode, so a sustained move is one event, not one per day. The
    episode spans the first window's start to the last qualifying session, and reports its
    largest move with the two closes that produced it.
    """
    events: list[MarketEvent] = []
    for direction, sign in (("up", 1.0), ("down", -1.0)):
        episode: dict | None = None
        for i in range(lookback, len(closes)):
            move = closes[i][1] / closes[i - lookback][1] - 1.0
            if sign * move < threshold - _EDGE:
                continue
            if episode is not None and i - lookback <= episode["last"]:
                episode["last"] = i
                if sign * move > sign * episode["move"]:
                    episode.update(move=move, best=i)
                continue
            if episode is not None:
                events.append(_oil_event(symbol, threshold, lookback, direction, episode, closes))
            episode = {"first": i, "last": i, "move": move, "best": i}
        if episode is not None:
            events.append(_oil_event(symbol, threshold, lookback, direction, episode, closes))
    events.sort(key=lambda event: event.start_date)
    return events


def _oil_event(symbol: str, threshold: float, lookback: int, direction: str, episode: dict,
               closes: Closes) -> MarketEvent:
    start = closes[episode["first"] - lookback][0]
    end = closes[episode["last"]][0]
    frm, to = closes[episode["best"] - lookback], closes[episode["best"]]
    change = _pct(episode["move"])
    basis = ComputedBasis(
        symbol=symbol, data_basis="daily_close", rule="move_over_sessions",
        threshold_pct=_pct(threshold), lookback_sessions=lookback, direction=direction,
        change_pct=change, from_date=frm[0], from_close=frm[1], to_date=to[0], to_close=to[1],
        ongoing=False, as_of=closes[-1][0],
    )
    note = (
        f"Computed from cached daily closes of {symbol}: the largest {lookback}-session move in "
        f"this episode was {change:+.2f}%, from {frm[1]:.2f} on {frm[0]} to {to[1]:.2f} on "
        f"{to[0]}. Rule: a close at least {basis.threshold_pct:g}% "
        f"{'above' if direction == 'up' else 'below'} the close {lookback} sessions earlier; "
        f"overlapping windows form one episode."
    )
    return MarketEvent(
        id=f"oil-shock-{direction}-{start}",
        label=f"Oil {change:+.1f}% in {lookback} sessions",
        category=OIL_CATEGORY, start_date=start, end_date=end, source=None,
        note=note, origin="computed", basis=basis,
    )


def cached_closes(symbol: str) -> list[tuple[str, float]]:
    """Every usable cached close for an index-table symbol, oldest first. NULL closes are skipped."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT date, close FROM indices WHERE ticker = ? AND close IS NOT NULL ORDER BY date",
            (symbol,),
        ).fetchall()
    return [(row["date"], float(row["close"])) for row in rows]


class PriceEventSource:
    """A detector run over one symbol's cached closes, as a registry source."""

    def __init__(self, symbol: str, detector: Callable[[Closes], list[MarketEvent]],
                 closes: Callable[[str], Closes] = cached_closes):
        self.name = f"prices {symbol}"
        self._symbol = symbol
        self._detector = detector
        self._closes = closes

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]:
        return [e for e in self._detector(self._closes(self._symbol)) if event_overlaps(e, start, end)]


def price_sources() -> list[PriceEventSource]:
    return [
        PriceEventSource(DRAWDOWN_SYMBOL, detect_drawdowns),
        PriceEventSource(OIL_SYMBOL, detect_oil_shocks),
    ]
