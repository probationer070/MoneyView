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

    closes = [float(b["close"]) for b in bars]
    volumes = [int(b["volume"] or 0) for b in bars]

    # --- drawdown ------------------------------------------------------------
    computed = drawdown_from_peak(closes)
    if computed is None:
        rows["drawdown"] = _row(source=peer_source, reason=f"insufficient_history: {len(bars)} bars")
    elif peer_reason is not None:
        rows["drawdown"] = _row(source=peer_source, reason=peer_reason)
    else:
        pct, peak, index = computed
        peer_pcts = [
            p[0]
            for p in (
                drawdown_from_peak([float(b["close"]) for b in bars_loader(peer)])
                for peer in peers
            )
            if p is not None
        ]
        comparison = (
            f"peer mean {sum(peer_pcts) / len(peer_pcts):.1%}" if peer_pcts else None
        )
        rows["drawdown"] = _row(
            pct, comparison, source=f"peers: {len(peer_pcts)} stored",
        )

    # --- volume --------------------------------------------------------------
    ratio = volume_ratio(volumes, _RECENT_DAYS, _BASELINE_DAYS) or volume_ratio(
        volumes, max(1, len(volumes) // 2), len(volumes)
    )
    if ratio is None:
        rows["volume"] = _row(source=peer_source, reason=f"insufficient_history: {len(bars)} bars")
    elif peer_reason is not None:
        rows["volume"] = _row(source=peer_source, reason=peer_reason)
    else:
        rows["volume"] = _row(ratio, None, source=peer_source)

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
        rows["dcf_gap"] = _row(source="conservative case", reason="insufficient_history: 0 bars")
    else:
        intrinsic = run_stored_case(case_id)["value_per_share_diluted"]
        price = closes[-1]
        rows["dcf_gap"] = _row(
            (intrinsic - price) / price,
            f"intrinsic {intrinsic:.2f} vs price {price:.2f}",
            source=f"conservative case #{case_id}",
        )

    return {"ticker": ticker, "direction": DIRECTION, "rows": rows}
