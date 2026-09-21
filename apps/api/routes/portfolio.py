"""
Portfolio routes for the portfolio view.
"""

from pathlib import Path
from typing import List

from fastapi import APIRouter, Body, HTTPException

from apps.api.models.schemas import (
    APIResponse,
    AttributionRequest,
    AttributionResult,
    DeltaBadge,
    PortfolioPreferences,
    PortfolioStock,
    WatchlistGroupUpdate,
    WatchlistItem,
    WatchlistPeerSyncStatus,
    WatchlistResyncResult,
    WatchlistSyncStatus,
    WatchlistSyncResult,
)
from apps.api.compute.client import get_compute_client
from apps.api.compute.errors import ComputeError
from apps.api.core.logger import setup_logger
from apps.api.services.acquisition.runner import retire_subject, schedule_acquisition
from apps.api.services.db import get_db
from apps.api.services.market_data import MarketDataService
from apps.api.services.news_service import NewsService
from apps.api.services.portfolio_service import PortfolioAnalyticsService
from apps.api.services import watchlist_seed
from apps.api.services.records_sync import service as records_sync
from apps.api.services.records_sync import store as records_sync_store
from apps.api.services.records_sync.kinds import KIND_PREFERENCES
from apps.api.services.watchlist_seed import (
    ensure_watchlist_bootstrapped,
    get_watchlist_sync_status,
    mark_watchlist_state,
    merge_missing_watchlist_items,
    resync_watchlist_from_json,
    sync_watchlist_to_json,
)
from apps.api.services.watchlist_sync import service as watchlist_sync
from apps.api.services.watchlist_sync import store as watchlist_sync_store

_API_ROOT = Path(__file__).resolve().parents[1]
_WATCHLIST_JSON = _API_ROOT / "services" / "webscrap" / "stock_targets.json"

router = APIRouter()
logger = setup_logger(__name__)
_mkt = MarketDataService()
_news = NewsService()
_portfolio_analytics = PortfolioAnalyticsService(_mkt)


@router.get("/watchlist", response_model=List[PortfolioStock])
def get_watchlist():
    """
    Return all watchlist stocks with latest close, delta badge, and sparkline.
    Seed once from JSON or built-in defaults when local state is empty.
    """
    # With sync on, this runs the full peer sync (spec §2): the response never shows an older
    # state than a readable peer file holds.
    ensure_watchlist_bootstrapped(_WATCHLIST_JSON)
    if not watchlist_sync.is_enabled():
        # Sync replaces the git-based seed merge; left on, it would revive a ticker deleted on
        # another PC (spec §3).
        merge_missing_watchlist_items(_WATCHLIST_JSON)

    with get_db() as conn:
        rows = conn.execute("SELECT * FROM watchlist ORDER BY group_name, ticker").fetchall()

    result: List[PortfolioStock] = []
    for row in rows:
        ticker = str(row["ticker"]).upper()
        bars = _mkt.get_stock_ohlcv(ticker, period="1mo")
        if len(bars) >= 2:
            last_close = bars[-1].close
            previous_close = bars[-2].close
            sparkline = [bar.close for bar in bars[-20:]]
        elif len(bars) == 1:
            last_close = bars[-1].close
            previous_close = bars[-1].close
            sparkline = [bars[-1].close]
        else:
            # No bar carries a usable close -- either the ticker has no history or every
            # cached bar was unsettled. Report that, rather than a 0.0 the tile would
            # render as a real price and DeltaBadge would score as a -100% collapse.
            last_close = None
            previous_close = None
            sparkline = []

        result.append(
            PortfolioStock(
                ticker=ticker,
                name=row["name"] or ticker,
                sector=row["sector"] or "",
                group_name=row["group_name"] or "custom",
                weight=float(row["weight"] or 0.0),
                last_close=last_close,
                delta=(
                    DeltaBadge.compute(last_close, previous_close)
                    if last_close is not None and previous_close is not None
                    else None
                ),
                sparkline=sparkline,
                id=int(row["id"]),
            )
        )
    return result


@router.get("/preferences", response_model=APIResponse[PortfolioPreferences])
def get_portfolio_preferences():
    """Return persisted portfolio workspace preferences."""
    records_sync.run_records_sync("read")
    with get_db() as conn:
        row = conn.execute(
            """SELECT total_investment_amount, transaction_fee_rate, updated_at
               FROM portfolio_preferences
               WHERE singleton_id = 1"""
        ).fetchone()

    preferences = PortfolioPreferences(
        total_investment_amount=float(row["total_investment_amount"] or 0.0) if row else 10_000.0,
        transaction_fee_rate=float(row["transaction_fee_rate"] or 0.002) if row else 0.002,
        updated_at=str(row["updated_at"] or "") if row else "",
    )
    return APIResponse(data=preferences)


@router.put("/preferences", response_model=APIResponse[PortfolioPreferences])
def save_portfolio_preferences(preferences: PortfolioPreferences = Body(...)):
    """Persist portfolio workspace preferences used by allocation tools."""
    payload = preferences.model_copy(update={"transaction_fee_rate": 0.002})
    with get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO portfolio_preferences
               (singleton_id, total_investment_amount, transaction_fee_rate, updated_at)
               VALUES (1, ?, ?, CURRENT_TIMESTAMP)""",
            (payload.total_investment_amount, payload.transaction_fee_rate),
        )
        records_sync_store.stamp(
            conn, KIND_PREFERENCES, KIND_PREFERENCES, watchlist_sync.local_pc_id(conn)
        )
        row = conn.execute(
            """SELECT total_investment_amount, transaction_fee_rate, updated_at
               FROM portfolio_preferences
               WHERE singleton_id = 1"""
        ).fetchone()
    records_sync.run_records_sync("mutation")

    return APIResponse(
        data=PortfolioPreferences(
            total_investment_amount=float(row["total_investment_amount"] or 0.0),
            transaction_fee_rate=float(row["transaction_fee_rate"] or 0.002),
            updated_at=str(row["updated_at"] or ""),
        )
    )


@router.get("/stock/{ticker}", response_model=dict)
def get_stock_detail(ticker: str, period: str = "5y"):
    """Return prices and recent news for a single stock."""
    normalized_ticker = ticker.upper().strip()
    bars = _mkt.get_stock_ohlcv(normalized_ticker, period=period)
    news = _news.get_news(ticker=normalized_ticker, limit=10)
    return {
        "ticker": normalized_ticker,
        "prices": [bar.model_dump() for bar in bars],
        "news": [item.model_dump() for item in news],
    }


@router.post("/watchlist", response_model=WatchlistItem)
def upsert_watchlist_item(item: WatchlistItem = Body(...)):
    """Add or update a watchlist entry."""
    normalized = WatchlistItem(
        ticker=item.ticker.upper().strip(),
        name=item.name.strip() or item.ticker.upper().strip(),
        sector=item.sector.strip(),
        group_name=item.group_name.strip() or "custom",
        weight=float(item.weight),
    )

    with get_db() as conn:
        existing = conn.execute(
            "SELECT name, sector, group_name, weight, updated_at, updated_by FROM watchlist WHERE ticker = ?",
            (normalized.ticker,),
        ).fetchone()
        changed = existing is None or (
            existing["name"], existing["sector"], existing["group_name"], float(existing["weight"] or 0.0)
        ) != (normalized.name, normalized.sector, normalized.group_name, normalized.weight)
        pc_id = watchlist_sync.local_pc_id(conn)
        stamp = watchlist_sync_store.causal_stamp(conn, normalized.ticker) if changed else existing["updated_at"]
        author = pc_id if changed else existing["updated_by"]
        conn.execute(
            """INSERT OR REPLACE INTO watchlist (ticker, name, sector, group_name, weight, updated_at, updated_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (normalized.ticker, normalized.name, normalized.sector, normalized.group_name,
             normalized.weight, stamp, author),
        )
    mark_watchlist_state("user_mutation")
    watchlist_sync.run_sync("mutation")
    # Adding a stock is the natural moment to acquire its history: one 10-year backfill,
    # off the request path. Without it the next comparison discovers the ticker and pays
    # a live fetch in-band while a user waits.
    #
    # Only on a genuinely new row. This endpoint is an upsert and is also the metadata
    # and weight edit path -- a sector change, "normalize allocations", the allocation
    # auto-save -- so scheduling per call would turn one bulk allocation edit into N
    # concurrent live provider fetches. Concurrent live fetching is what earned a Yahoo
    # rate limit that invalidated a day of measurements (see acquisition/sources/bars.py).
    #
    # Guarded because acquisition is best-effort: a scheduling failure must never fail
    # the user's watchlist write, which is the operation they actually asked for
    # (design 10 -- no acquisition failure propagates into a request).
    if existing is None:
        try:
            schedule_acquisition("equity_bars", normalized.ticker)
        except Exception as error:  # noqa: BLE001 - best-effort, never fails the write
            logger.warning("watchlist.schedule_acquisition_failed ticker=%s error=%s",
                           normalized.ticker, error)
    return normalized


@router.post("/watchlist/{ticker}/group", response_model=WatchlistItem)
def set_watchlist_group(ticker: str, payload: WatchlistGroupUpdate = Body(...)):
    """Move one ticker into a group, touching nothing else.

    Deliberately not `POST /watchlist`. That endpoint is a full-row upsert and
    `WatchlistItem.weight` defaults to 0.0, so a caller who sends only a ticker and a
    group silently zeroes the allocation -- and flattens name and sector too. Group
    membership decides what the tile grid shows, so this gets toggled casually and must
    never cost a weight the user set deliberately.
    """
    normalized_ticker = ticker.upper().strip()
    group_name = payload.group_name.strip()
    if not group_name:
        raise HTTPException(
            status_code=422,
            detail="invalid_group_name: group_name must be a non-empty name; "
                   "defaulting it here would move the row somewhere the caller did not ask for",
        )

    with get_db() as conn:
        row = conn.execute(
            "SELECT ticker, name, sector, weight, group_name FROM watchlist WHERE ticker = ?",
            (normalized_ticker,),
        ).fetchone()
        if row is None:
            raise HTTPException(
                status_code=404,
                detail=f"unknown_ticker: {normalized_ticker} is not on the watchlist; "
                       "add it before changing its group",
            )
        if row["group_name"] != group_name:
            conn.execute("UPDATE watchlist SET group_name = ? WHERE ticker = ?", (group_name, normalized_ticker))
            watchlist_sync_store.stamp_row(conn, normalized_ticker, watchlist_sync.local_pc_id(conn))

    mark_watchlist_state("user_mutation")
    watchlist_sync.run_sync("mutation")
    return WatchlistItem(
        ticker=normalized_ticker,
        name=row["name"] or normalized_ticker,
        sector=row["sector"] or "",
        group_name=group_name,
        weight=float(row["weight"] or 0.0),
    )


@router.post("/watchlist/resync", response_model=APIResponse[WatchlistResyncResult])
def resync_watchlist():
    """Explicitly replace the watchlist table with the current stock_targets.json contents."""
    if watchlist_sync.is_enabled():
        # The server guard is authoritative; hiding the button is only convenience (spec §3).
        raise HTTPException(status_code=409, detail="Import is unavailable while watchlist sync is on: "
                            "a bulk replace would be undone by the next merge and would never reach other PCs.")
    try:
        result = resync_watchlist_from_json(_WATCHLIST_JSON)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return APIResponse(data=result)


@router.post("/watchlist/sync", response_model=APIResponse[WatchlistSyncResult])
def sync_watchlist():
    """Export the DB-backed watchlist to the personal, git-ignored data/exports/watchlist-export.json."""
    try:
        result = sync_watchlist_to_json(watchlist_seed.EXPORT_JSON)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return APIResponse(data=result)


@router.get("/watchlist/sync-status", response_model=APIResponse[WatchlistSyncStatus])
def get_watchlist_sync_metadata():
    """Return the last explicit watchlist sync/import metadata."""
    return APIResponse(data=WatchlistSyncStatus(**get_watchlist_sync_status(watchlist_seed.EXPORT_JSON)))


@router.get("/watchlist/peer-sync", response_model=APIResponse[WatchlistPeerSyncStatus])
def get_watchlist_peer_sync():
    """Last recorded peer-sync attempt. Read-only: it never triggers a sync (spec §2)."""
    return APIResponse(data=watchlist_sync.current_status())


@router.delete("/watchlist/{ticker}")
def delete_watchlist_item(ticker: str):
    """Delete a watchlist entry by ticker."""
    normalized_ticker = ticker.upper().strip()
    with get_db() as conn:
        row = conn.execute("SELECT ticker FROM watchlist WHERE ticker = ?", (normalized_ticker,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"watchlist ticker not found: {normalized_ticker}")
        if watchlist_sync.is_enabled():
            # Tombstones only while sync is on (spec §1, Switch). Recorded before the DELETE, so
            # the tombstone outranks the row being deleted (causal stamp).
            watchlist_sync_store.record_removal(conn, normalized_ticker, watchlist_sync.local_pc_id(conn))
        conn.execute("DELETE FROM watchlist WHERE ticker = ?", (normalized_ticker,))
    mark_watchlist_state("user_mutation")
    watchlist_sync.run_sync("mutation")
    try:
        retire_subject("equity_bars", normalized_ticker)
    except Exception as error:  # noqa: BLE001 - best-effort, never fails the delete
        logger.warning("watchlist.retire_subject_failed ticker=%s error=%s",
                       normalized_ticker, error)
    return {"status": "ok", "ticker": normalized_ticker}


@router.post("/attribution", response_model=APIResponse[AttributionResult])
async def get_portfolio_attribution(payload: AttributionRequest = Body(...)):
    """
    Portfolio-level arithmetic Brinson-Fachler attribution.

    Returns domain schemas only and avoids chart-specific shaping in the API layer.
    Compute runs behind the ComputeClient seam (in-process or compute-service).
    """
    try:
        result = await get_compute_client().build_attribution(payload)
    except ComputeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    return APIResponse(data=result)
