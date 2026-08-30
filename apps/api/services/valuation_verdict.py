"""The over/undervaluation evidence panel.

Reports each price-derived signal beside its sector comparison and names the
source that comparison came from. It issues NO label and NO score: collapsing
these signals into one verdict needs weights the data does not contain, and
once collapsed the weighting -- which would BE the verdict -- is invisible to
the reader.

Refusal is per-signal. A panel with three computed rows and one refused row is
a successful result, not an error.
"""

from __future__ import annotations

from apps.api.services.acquisition.store import load_price_bars
from apps.api.services.company_baseline import find_conservative_case_id
from apps.api.services.industry_benchmark_store import resolve_for_ticker
from apps.api.services.peer_set import resolve_peers
from apps.api.services.valuation_case import run_stored_case
from packages.core_finance.price_signals import (
    drawdown_from_peak,
    volume_ratio,
)

DIRECTION = (
    "Testing UNDERVALUATION against the top of the sector. This basis is "
    "anti-conservative for overvaluation: a company that looks expensive "
    "against the best industries in its sector may be reasonably priced "
    "against its actual peers."
)

_RECENT_DAYS = 90
_BASELINE_DAYS = 252


def _row(value=None, comparison=None, *, source, reason=None) -> dict:
    return {"value": value, "comparison": comparison, "source": source, "reason": reason}


def _closes_from_bars(bars: list[dict]) -> list[float]:
    """Closes with NULL entries dropped.

    `load_price_bars` documents that `close`/`volume` pass through exactly as
    stored, including NULL, and that the caller must handle it. A NULL close
    cannot enter `float()` or a price-derived signal, so it is dropped here
    rather than left to blow up the row (or the whole panel) that touches it.
    """
    return [float(b["close"]) for b in bars if b["close"] is not None]


def _dated_closes_from_bars(bars: list[dict]) -> list[tuple[str, float]]:
    """Closes paired with the bar date they came from, NULL entries dropped.

    Dropping NULL closes shortens the list relative to `bars`, so a plain
    `closes[-1]` no longer reliably means "the newest bar's close" -- if the
    newest bar's close is NULL, it means an OLDER bar's close instead, silently.
    Carrying the date alongside each close lets a caller that reports "price"
    say which date it actually priced against.
    """
    return [(b["date"], float(b["close"])) for b in bars if b["close"] is not None]


def _dated_volumes_from_bars(bars: list[dict]) -> list[tuple[str, int]]:
    """Volumes paired with the bar date they came from, NULL entries dropped.

    Mirrors `_dated_closes_from_bars`. An unknown volume is not zero traded
    volume: substituting 0 for NULL would drag a mean down and distort
    `volume_ratio`. Only `None` is dropped -- a genuinely stored `0` is a real
    reading and must be kept, so this checks `is not None` rather than
    truthiness. The date is kept alongside each volume so a caller reporting
    the window can say what calendar span it actually spans, since dropping
    NULLs makes "the last n bars" a count of positions, not days.
    """
    return [(b["date"], int(b["volume"])) for b in bars if b["volume"] is not None]


def _volume_source(dated_volumes: list[tuple[str, int]], total_bars: int, recent: int, baseline: int) -> str:
    """Describe the window `volume_ratio` actually used.

    The window is a count of BARS, not days: NULL-filtering makes the kept
    volumes non-contiguous, so "the last n bars" no longer spans n calendar
    days. When NULLs were in fact dropped (the filtered series is shorter
    than the raw bar count), the baseline's real date span is stated too, so
    a reader can see how much calendar time it actually covers.
    """
    label = f"own bars: {recent}/{baseline} bars"
    if len(dated_volumes) < total_bars:
        window = dated_volumes[-baseline:] if baseline > 0 else []
        if window:
            label = f"{label} (baseline spans {window[0][0]} to {window[-1][0]})"
    return label


def build_verdict(ticker: str, *, bars_loader=load_price_bars) -> dict:
    """Assemble the evidence panel for one ticker.

    `bars_loader` is injected so the whole path is testable without the
    network. Note what a missed injection would NOT hit: the default reads the
    local store and never opens a socket, so `tests/conftest.py`'s network
    guard cannot see one.
    """
    ticker = ticker.upper()
    bars = bars_loader(ticker)
    rows: dict[str, dict] = {}

    peers, peer_reason = resolve_peers(ticker)
    peer_source = f"peers: {len(peers)} stored" if peer_reason is None else "peers"

    dated_closes = _dated_closes_from_bars(bars)
    closes = [close for _, close in dated_closes]
    dated_volumes = _dated_volumes_from_bars(bars)
    volumes = [volume for _, volume in dated_volumes]

    # The newest bar may carry a NULL close (dropped above), in which case the
    # latest usable close is an OLDER bar's price. Refusing outright would be
    # too aggressive -- it is genuinely the last known price -- so instead its
    # date is surfaced wherever that price is reported, per finding B.
    latest_bar_date = bars[-1]["date"] if bars else None
    latest_close_date = dated_closes[-1][0] if dated_closes else None
    stale_price_note = (
        f"price as of {latest_close_date}, latest bar {latest_bar_date}"
        if latest_close_date is not None and latest_close_date != latest_bar_date
        else None
    )

    # --- drawdown ------------------------------------------------------------
    computed = drawdown_from_peak(closes)
    if computed is None:
        rows["drawdown"] = _row(
            source=peer_source, reason=f"insufficient_history: {len(closes)} of {len(bars)} bars usable"
        )
    elif peer_reason is not None:
        rows["drawdown"] = _row(source=peer_source, reason=peer_reason)
    else:
        pct, peak, index = computed
        peer_pcts = [
            p[0]
            for p in (
                drawdown_from_peak(_closes_from_bars(bars_loader(peer)))
                for peer in peers
            )
            if p is not None
        ]
        if peer_pcts:
            comparison = f"peer mean {sum(peer_pcts) / len(peer_pcts):.1%}"
            drawdown_source = f"peers: {len(peer_pcts)} stored"
        else:
            comparison = None
            drawdown_source = f"peers: {len(peers)} resolved, 0 with bars"
        # The stale-price note qualifies the subject's OWN price, not the
        # sector comparison -- `comparison` is reserved for the peer figure,
        # so the note belongs in `source` even when there is no comparison.
        if stale_price_note is not None:
            drawdown_source = f"{drawdown_source}; {stale_price_note}"
        rows["drawdown"] = _row(pct, comparison, source=drawdown_source)

    # --- volume ----------------------------------------------------------
    # Computed purely from the subject's own bars, so it never refuses on a
    # peer-set failure and never wears `peer_source`.
    if not volumes:
        # No usable volume at all -- distinct from "not enough history": the
        # bars are there, only the volume column is empty. A degenerate
        # 0-length window (e.g. "1/0 bars") is not a real source, so none is
        # emitted; the count of bars that lack volume stands in its place.
        no_volume = f"0 of {len(bars)} bars have volume"
        rows["volume"] = _row(source=f"own bars: {no_volume}", reason=f"no_volume: {no_volume}")
    else:
        ratio = volume_ratio(volumes, _RECENT_DAYS, _BASELINE_DAYS)
        if ratio is not None:
            volume_source = _volume_source(dated_volumes, len(bars), _RECENT_DAYS, _BASELINE_DAYS)
        else:
            fallback_recent = max(1, len(volumes) // 2)
            fallback_baseline = len(volumes)
            ratio = volume_ratio(volumes, fallback_recent, fallback_baseline)
            volume_source = _volume_source(dated_volumes, len(bars), fallback_recent, fallback_baseline)

        if ratio is None:
            rows["volume"] = _row(source=volume_source, reason=f"insufficient_history: {len(bars)} bars")
        else:
            rows["volume"] = _row(ratio, None, source=volume_source)

    # --- trailing PE ---------------------------------------------------------
    benchmark, vintage, bench_reason = resolve_for_ticker(ticker)
    if benchmark is None:
        rows["trailing_pe"] = _row(source="Damodaran", reason=bench_reason)
    elif benchmark.columns.get("trailing_pe") is None:
        rows["trailing_pe"] = _row(
            source="Damodaran", reason=f"no_sector_pe: {vintage} has no trailing_pe"
        )
    else:
        rows["trailing_pe"] = _row(
            None,
            f"sector avg {benchmark.columns['trailing_pe'].value:.1f}",
            source=f"Damodaran {vintage}",
            reason="no_eps",
        )

    # --- DCF gap -------------------------------------------------------------
    case_id = find_conservative_case_id(ticker)
    if case_id is None:
        rows["dcf_gap"] = _row(source="conservative case", reason=f"no_case: {ticker}")
    elif not closes:
        rows["dcf_gap"] = _row(
            source="conservative case", reason=f"insufficient_history: {len(closes)} of {len(bars)} bars usable"
        )
    else:
        price_date, price = dated_closes[-1]
        case_source = f"conservative case #{case_id}"
        if price <= 0:
            rows["dcf_gap"] = _row(source=case_source, reason=f"non_positive_price: {price}")
        else:
            try:
                intrinsic = run_stored_case(case_id)["value_per_share_diluted"]
            except ValueError as exc:
                rows["dcf_gap"] = _row(source=case_source, reason=f"invalid_case #{case_id}: {exc}")
            else:
                rows["dcf_gap"] = _row(
                    (intrinsic - price) / price,
                    f"intrinsic {intrinsic:.2f} vs price {price:.2f} as of {price_date}",
                    source=case_source,
                )

    return {"ticker": ticker, "direction": DIRECTION, "rows": rows}
