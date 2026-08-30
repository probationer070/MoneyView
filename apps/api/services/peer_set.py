"""Same-industry peers drawn from what this installation already stores.

This is a WATCHLIST, not a sector census. Six semiconductor tickers someone
follows are not the semiconductor sector, and every consumer must report the
peer count rather than present the comparison as authoritative.
"""

from __future__ import annotations

from apps.api.services.db import get_db

# Matches `resolve_benchmark`'s own `minimum=3`. Two layers that both average
# over a peer group must not disagree about what "enough" means.
MIN_PEERS = 3


def resolve_peers(ticker: str) -> tuple[list[str], str | None]:
    """Tickers sharing `ticker`'s industry, excluding itself.

    Exactly one of (peers, reason) is non-empty/non-None.
    """
    ticker = ticker.upper()
    with get_db() as conn:
        row = conn.execute(
            "SELECT industry FROM corporate_quote_facts WHERE ticker = ?", (ticker,)
        ).fetchone()
        if row is None or not row["industry"]:
            return [], f"no_industry: {ticker}"
        peers = [
            r["ticker"]
            for r in conn.execute(
                "SELECT ticker FROM corporate_quote_facts "
                "WHERE industry = ? AND ticker != ? ORDER BY ticker",
                (row["industry"], ticker),
            ).fetchall()
        ]
    if len(peers) < MIN_PEERS:
        return [], f"peer_set_too_thin: {len(peers)} peers"
    return peers, None
