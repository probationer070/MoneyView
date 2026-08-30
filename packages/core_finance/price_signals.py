"""Price-derived signals: drawdown, volume, and trailing PE.

Pure arithmetic on sequences. Nothing here reads a database, a file or a
network -- callers supply the series, which is what lets every edge case be
tested against exact numbers instead of whatever the store happens to hold.

Every function returns None rather than a number it cannot justify. A zero
baseline volume, a loss-making year's PE, a drawdown over no data: each has a
defensible-looking answer (infinity, a negative PE, zero) that would travel
into a comparison and read as a real reading. The argument is dcf.py:196's --
a large finite number where the model has no value is worse than no number.
"""

from __future__ import annotations

from collections.abc import Sequence


def drawdown_from_peak(closes: Sequence[float]) -> tuple[float, float, int] | None:
    """Fractional decline from the running peak to the last close.

    The peak is the maximum over the window the CALLER supplied, so the choice
    of "previous peak" stays with the caller rather than being guessed here.
    Returns `(pct, peak_value, peak_index)`; `pct` is <= 0.
    """
    if not closes:
        return None
    peak = max(closes)
    index = list(closes).index(peak)
    if peak <= 0:
        return None
    return (closes[-1] - peak) / peak, peak, index


def volume_ratio(volumes: Sequence[int], recent: int, baseline: int) -> float | None:
    """Mean volume over the last `recent` bars, divided by that over `baseline`."""
    if recent <= 0 or baseline <= 0 or len(volumes) < max(recent, baseline):
        return None
    baseline_mean = sum(volumes[-baseline:]) / baseline
    if baseline_mean <= 0:
        return None
    return (sum(volumes[-recent:]) / recent) / baseline_mean


def trailing_pe_series(
    closes: Sequence[tuple[str, float]], eps_by_period: dict[str, float]
) -> list[tuple[str, float]]:
    """PE at each close, using the EPS of the year that close falls in.

    A period with non-positive EPS is OMITTED, not emitted as a negative PE: a
    loss-making year has no meaningful earnings multiple, and a negative one
    sorts as "cheap" in any ascending comparison.
    """
    series: list[tuple[str, float]] = []
    for date, close in closes:
        eps = eps_by_period.get(date[:4])
        if eps is None or eps <= 0:
            continue
        series.append((date, close / eps))
    return series


def pe_change(series: Sequence[tuple[str, float]]) -> float | None:
    """Fractional change in PE from the first point in the series to the last."""
    if len(series) < 2:
        return None
    first, last = series[0][1], series[-1][1]
    if first <= 0:
        return None
    return (last - first) / first
