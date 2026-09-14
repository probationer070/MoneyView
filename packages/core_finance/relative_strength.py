"""
Relative Strength Engine — ratio of returns between two series, indexed to 100.

    strength(A, B, t) = (A_t / A_0) / (B_t / B_0) x 100

`A_0` and `B_0` are both taken from ONE common base date: the first date present in both
series at or after the requested window start. Anchoring each side to its own first
observation would index the two series to different days and carry that offset into every
later value.

Joined on exact dates only. A date absent from either side is omitted, never forward
filled: a forward-filled spread invents a session that did not happen and flattens the
closed-market gaps that are usually the interesting part.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Mapping, Optional

DEFAULT_WINDOW_DAYS = 90


@dataclass(frozen=True)
class RelativeStrengthPoint:
    date: str
    value: float


@dataclass(frozen=True)
class RelativeStrengthResult:
    base_date: Optional[str]
    points: List[RelativeStrengthPoint]
    refused_reason: Optional[str]


def relative_strength(
    numerator: Mapping[str, float],
    denominator: Mapping[str, float],
    *,
    window_start: str,
) -> RelativeStrengthResult:
    """Relative strength of `numerator` against `denominator`, indexed to 100.

    Both mappings are date (ISO `YYYY-MM-DD`) to close. `window_start` is inclusive.
    """
    common = sorted(set(numerator) & set(denominator))
    in_window = [date for date in common if date >= window_start]

    if not in_window:
        return RelativeStrengthResult(
            base_date=None,
            points=[],
            refused_reason="no overlapping history in the requested window",
        )

    base_date = in_window[0]
    base_numerator = numerator[base_date]
    base_denominator = denominator[base_date]

    if not base_numerator or not base_denominator:
        return RelativeStrengthResult(
            base_date=None,
            points=[],
            refused_reason=f"base close is zero or absent on {base_date}",
        )

    points = [
        RelativeStrengthPoint(
            date=date,
            value=(numerator[date] / base_numerator) / (denominator[date] / base_denominator) * 100.0,
        )
        for date in in_window
    ]
    return RelativeStrengthResult(base_date=base_date, points=points, refused_reason=None)
