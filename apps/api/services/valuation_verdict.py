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
from apps.api.services.valuation_case import CaseNotFound, run_stored_case
from packages.core_finance.price_signals import (
    drawdown_from_peak,
    volume_ratio,
)

DIRECTION = (
    "Testing UNDERVALUATION. Each row states the basis it was compared "
    "against, and those bases differ: only a row benchmarked against the top "
    "of the sector carries that framing. Where a row IS benchmarked that way, "
    "the basis is conservative for identifying undervaluation and "
    "anti-conservative for the opposite -- a company that looks expensive "
    "against the best industries in its sector may be reasonably priced "
    "against its actual peers."
)

# The drawdown lookback, in usable bars. A peak is only meaningful relative to
# the window it was taken over, so subject and peers must use the SAME one: a
# subject measured over 300 bars beside peers measured over 5 produces a real
# number, a real label, and a meaningless comparison. Peers with less history
# are dropped rather than silently compared on a different basis.
_DRAWDOWN_BARS = 252

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


def _own_window_source(closes: list[float], window: list[float]) -> str:
    """Describe the window the subject's own drawdown was actually computed over.

    `window` is capped at `_DRAWDOWN_BARS` bars even when more history exists,
    so a value computed on it is silently NOT the subject's full-history
    drawdown -- without this, a stock down 90% over its full history could
    publish a computed `0.0` with nothing disclosing that most of its history
    was discarded. When the window is truncated AND the true peak sits outside
    it, the full-history figure is named too; otherwise it would be noise, since
    a peak inside the window makes the two figures identical.
    """
    source = f"own window: last {len(window)} of {len(closes)} bars"
    if len(closes) > len(window):
        # `drawdown_from_peak` refuses a non-positive peak as well as an empty
        # series, and this helper is called from the `non_positive_peak` branch
        # itself -- so the full-history figure may not exist. Unpacking it
        # unconditionally raised out of `build_verdict`, breaking the
        # per-signal invariant on the one branch that most needed the source.
        full = drawdown_from_peak(closes)
        if full is not None:
            full_pct, _, full_peak_index = full
            if full_peak_index < len(closes) - len(window):
                source = f"{source} (full-history drawdown {full_pct:.1%}, peak outside window)"
    return source


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
    # I1/I2/I3/I4: one fixed window for subject and peers; a refusal about the
    # subject's OWN bars names the subject's bars, never the peer set; and a
    # non-positive peak is reported as such rather than blamed on history.
    window = closes[-_DRAWDOWN_BARS:]
    if len(window) < _DRAWDOWN_BARS:
        # "usable" is reserved for NULL-filtering everywhere else in this
        # panel (dcf_gap, volume), so it means the same thing here: closes
        # that survived the filter, out of bars that actually arrived. The
        # reason names both that count AND how many bars arrived, so "0
        # bars stored" and "5 bars, all filtered out" no longer read alike.
        rows["drawdown"] = _row(
            source=f"own bars: {len(closes)} of {len(bars)} bars usable",
            reason=(
                f"insufficient_history: {len(closes)} of {_DRAWDOWN_BARS} bars "
                f"needed for the drawdown window ({len(bars)} bars stored)"
            ),
        )
    elif max(window) <= 0:
        # `drawdown_from_peak` refuses an empty series and a non-positive peak
        # alike; only the caller knows which happened, and "insufficient
        # history" is false when every bar is present.
        rows["drawdown"] = _row(
            source=_own_window_source(closes, window), reason=f"non_positive_peak: {max(window)}"
        )
    elif peer_reason is not None:
        rows["drawdown"] = _row(source=_own_window_source(closes, window), reason=peer_reason)
    else:
        pct, peak, index = drawdown_from_peak(window)
        peer_pcts = []
        for peer in peers:
            peer_window = _closes_from_bars(bars_loader(peer))[-_DRAWDOWN_BARS:]
            if len(peer_window) < _DRAWDOWN_BARS or max(peer_window) <= 0:
                continue
            peer_pcts.append(drawdown_from_peak(peer_window)[0])
        # Both counts, always: "3 stored" meant "3 resolved" on one path and
        # "3 contributed" on another, which are different facts. The subject's
        # own window comes first: `value` stays on the 252-bar basis to stay
        # comparable to the peer mean, but the basis it rests on must be named
        # too, not just the peers it is being compared against (ND-A).
        drawdown_source = (
            f"{_own_window_source(closes, window)}; "
            f"peers: {len(peer_pcts)} of {len(peers)} over {_DRAWDOWN_BARS} bars"
        )
        comparison = (
            f"peer mean {sum(peer_pcts) / len(peer_pcts):.1%}" if peer_pcts else None
        )
        # The stale-price note qualifies the subject's OWN price, not the
        # sector comparison -- `comparison` is reserved for the peer figure.
        if stale_price_note is not None:
            drawdown_source = f"{drawdown_source}; {stale_price_note}"
        rows["drawdown"] = _row(pct, comparison, source=drawdown_source)

    # --- volume ----------------------------------------------------------
    # Computed purely from the subject's own bars, so it never refuses on a
    # peer-set failure and never wears the peer set's source label.
    if not volumes:
        if not bars:
            # No bars arrived at all -- distinct from "bars arrived, but none
            # carry volume" (below). `no_volume` would blame an absent volume
            # column for the absence of the bars themselves, and `own bars`
            # would claim provenance for data that was never fetched.
            rows["volume"] = _row(
                source="own bars: none stored",
                reason="insufficient_history: 0 of 0 bars usable",
            )
        else:
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
            # `fallback_baseline` always equals `len(volumes)`, so the length
            # guard in `volume_ratio` can never trip on this call -- the only
            # way it still returns None is `baseline_mean <= 0`, i.e. every
            # stored volume over that window is zero. `insufficient_history`
            # would blame a shortage of data that is not actually short.
            rows["volume"] = _row(
                source=volume_source,
                reason=f"zero_volume: baseline mean 0 over {fallback_baseline} bars",
            )
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
        # `resolve_benchmark` averages each column independently and keeps any
        # column with >= 3 surviving contributors -- a `trailing_pe` average
        # resting on 3 or 4 of the top-5-by-ROC basket is normal, not an edge
        # case. `.industries` holds the real contributor count; naming the
        # basket size alone would claim all 5 fed this average when fewer may
        # have.
        pe_industries = benchmark.columns["trailing_pe"].industries
        rows["trailing_pe"] = _row(
            None,
            f"sector avg {benchmark.columns['trailing_pe'].value:.1f}",
            source=(
                f"Damodaran {vintage} top-5-by-ROC sector basket "
                f"({len(pe_industries)} of 5 industries)"
            ),
            reason=(
                "eps_not_wired: the sector PE resolved, but this panel does not "
                "read EPS -- confirming Yahoo's EPS line-item labels needs a "
                "stored bundle no fixture carries, and guessing them would be "
                "worse than refusing"
            ),
        )

    # --- DCF gap -------------------------------------------------------------
    case_id = find_conservative_case_id(ticker)
    if case_id is None:
        # `find_conservative_case_id` returns None both when no vintage is
        # loaded at all and when this ticker simply has no stored case. Blaming
        # the ticker for the former sends the reader to debug an input that was
        # never the problem -- and its sibling row already names the real cause.
        no_vintage = bench_reason is not None and bench_reason.startswith("no_vintage")
        rows["dcf_gap"] = _row(
            source="conservative case",
            reason=(
                bench_reason if no_vintage
                else f"no_case: {ticker} has no stored conservative case"
            ),
        )
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
            except (ValueError, CaseNotFound) as exc:
                rows["dcf_gap"] = _row(source=case_source, reason=f"invalid_case #{case_id}: {exc}")
            else:
                rows["dcf_gap"] = _row(
                    (intrinsic - price) / price,
                    f"intrinsic {intrinsic:.2f} vs price {price:.2f} as of {price_date}",
                    source=case_source,
                )

    return {"ticker": ticker, "direction": DIRECTION, "rows": rows}
