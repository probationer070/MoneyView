import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

from apps.api.models.schemas import WatchlistItem, WatchlistResyncResult, WatchlistSyncResult
from apps.api.services.db import get_db

WATCHLIST_STATE_DATASET = "watchlist_state"
WATCHLIST_SYNC_DATASET = "watchlist_sync_status"

DEFAULT_WATCHLIST_ITEMS: List[WatchlistItem] = [
    WatchlistItem(ticker="AAPL", name="Apple", sector="Technology", group_name="built_in", weight=0.2),
    WatchlistItem(ticker="MSFT", name="Microsoft", sector="Technology", group_name="built_in", weight=0.2),
    WatchlistItem(ticker="NVDA", name="NVIDIA", sector="Semiconductors", group_name="built_in", weight=0.2),
    WatchlistItem(ticker="GOOGL", name="Alphabet", sector="Communication Services", group_name="built_in", weight=0.2),
    WatchlistItem(ticker="AMZN", name="Amazon", sector="Consumer Discretionary", group_name="built_in", weight=0.2),
]
DEFAULT_WATCHLIST_METADATA: Dict[str, WatchlistItem] = {item.ticker: item for item in DEFAULT_WATCHLIST_ITEMS}


def load_watchlist_seed(json_path: Path) -> Tuple[List[WatchlistItem], str]:
    """Load bootstrap watchlist items from JSON, DB regeneration, or built-in defaults."""
    items = _load_watchlist_from_json(json_path)
    if items:
        return items, "json_seed"
    regenerated = _regenerate_watchlist_json_from_db(json_path)
    if regenerated:
        return regenerated, "db_regenerated_json"
    return list(DEFAULT_WATCHLIST_ITEMS), "built_in_seed"


def ensure_watchlist_bootstrapped(json_path: Path) -> None:
    """Seed the watchlist table once when it is empty and no user/bootstrap state exists."""
    with get_db() as conn:
        if not json_path.exists():
            regenerated = _build_watchlist_items_from_db(conn)
            if regenerated:
                _write_watchlist_json(json_path, regenerated)

        row = conn.execute("SELECT COUNT(*) AS count FROM watchlist").fetchone()
        if row and int(row["count"]) > 0:
            return
        if _has_watchlist_state(conn):
            return

        items, source = load_watchlist_seed(json_path)
        for item in items:
            conn.execute(
                """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name, weight)
                   VALUES (?, ?, ?, ?, ?)""",
                (item.ticker.upper(), item.name, item.sector, item.group_name, item.weight),
            )
        _mark_watchlist_state(conn, source)


def mark_watchlist_state(source: str) -> None:
    """Record that watchlist state is now managed, preventing future automatic reseeding."""
    with get_db() as conn:
        _mark_watchlist_state(conn, source)


def resync_watchlist_from_json(json_path: Path) -> WatchlistResyncResult:
    """Explicitly replace the watchlist table with the current JSON seed file contents."""
    items = _load_watchlist_from_json(json_path)
    if not items:
        raise ValueError(f"no valid watchlist items found in {json_path}")

    normalized_items = list(_dedupe_watchlist_items(items).values())
    synced_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute("DELETE FROM watchlist")
        for item in normalized_items:
            conn.execute(
                """INSERT INTO watchlist (ticker, name, sector, group_name, weight)
                   VALUES (?, ?, ?, ?, ?)""",
                (item.ticker, item.name, item.sector, item.group_name, item.weight),
            )
        _mark_watchlist_state(conn, "manual_json_resync")
        _mark_watchlist_sync_status(conn, "manual_json_resync", synced_at)

    return WatchlistResyncResult(
        item_count=len(normalized_items),
        tickers=[item.ticker for item in normalized_items],
        source="manual_json_resync",
        json_path=str(json_path),
    )


def sync_watchlist_to_json(json_path: Path) -> WatchlistSyncResult:
    """Safely export the current DB-backed watchlist into stock_targets.json."""
    with get_db() as conn:
        items = _build_watchlist_items_from_watchlist(conn)
    if not items:
        raise ValueError("no watchlist items available to sync")

    _write_watchlist_json(json_path, items)
    synced_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        _mark_watchlist_sync_status(conn, "watchlist_db_sync", synced_at)
    return WatchlistSyncResult(
        item_count=len(items),
        tickers=[item.ticker for item in items],
        source="watchlist_db_sync",
        json_path=str(json_path),
        preserved_weights=True,
        last_updated_at=synced_at,
    )


def get_watchlist_sync_status(json_path: Path) -> dict[str, str]:
    """Return the last explicit sync/import action metadata."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT last_updated_at, source FROM dataset_metadata WHERE dataset_name = ?",
            (WATCHLIST_SYNC_DATASET,),
        ).fetchone()
    if row is None:
        return {
            "source": "",
            "last_updated_at": "",
            "json_path": str(json_path),
        }
    return {
        "source": str(row["source"] or ""),
        "last_updated_at": str(row["last_updated_at"] or ""),
        "json_path": str(json_path),
    }


def _load_watchlist_from_json(json_path: Path) -> List[WatchlistItem]:
    if not json_path.exists():
        return []

    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
    except Exception:
        return []

    items: List[WatchlistItem] = []
    for group_name, group in data.items():
        for target in group.get("targets", []):
            ticker = str(target.get("ticker", "")).upper().strip()
            if not ticker:
                continue
            items.append(
                WatchlistItem(
                    ticker=ticker,
                    name=target.get("name", ticker),
                    sector=target.get("sector", ""),
                    group_name=group_name,
                    weight=float(target.get("weight", 0.0) or 0.0),
                )
            )
    return items


def _dedupe_watchlist_items(items: List[WatchlistItem]) -> Dict[str, WatchlistItem]:
    deduped: Dict[str, WatchlistItem] = {}
    for item in items:
        ticker = item.ticker.upper().strip()
        if not ticker:
            continue
        deduped[ticker] = item.model_copy(update={"ticker": ticker})
    return deduped


def _regenerate_watchlist_json_from_db(json_path: Path) -> List[WatchlistItem]:
    with get_db() as conn:
        items = _build_watchlist_items_from_db(conn)
    if items:
        _write_watchlist_json(json_path, items)
    return items


def _build_watchlist_items_from_db(conn) -> List[WatchlistItem]:
    items_by_ticker: Dict[str, WatchlistItem] = {}

    for item in _build_watchlist_items_from_watchlist(conn):
        items_by_ticker[item.ticker] = item

    for row in conn.execute(
        """SELECT ticker, name, sector
           FROM corporate_companies
           ORDER BY ticker"""
    ).fetchall():
        ticker = str(row["ticker"] or "").upper().strip()
        if not ticker or ticker in items_by_ticker:
            continue
        metadata = DEFAULT_WATCHLIST_METADATA.get(ticker)
        items_by_ticker[ticker] = WatchlistItem(
            ticker=ticker,
            name=row["name"] or (metadata.name if metadata else ticker),
            sector=row["sector"] or (metadata.sector if metadata else ""),
            group_name="corporate_db",
            weight=0.0,
        )

    for row in conn.execute(
        """SELECT ticker
           FROM corporate_metrics
           ORDER BY ticker"""
    ).fetchall():
        ticker = str(row["ticker"] or "").upper().strip()
        if not ticker or ticker in items_by_ticker:
            continue
        metadata = DEFAULT_WATCHLIST_METADATA.get(ticker)
        items_by_ticker[ticker] = WatchlistItem(
            ticker=ticker,
            name=metadata.name if metadata else ticker,
            sector=metadata.sector if metadata else "",
            group_name="corporate_metrics",
            weight=0.0,
        )

    return list(items_by_ticker.values())


def _build_watchlist_items_from_watchlist(conn) -> List[WatchlistItem]:
    items: List[WatchlistItem] = []
    for row in conn.execute(
        """SELECT ticker, name, sector, group_name, weight
           FROM watchlist
           ORDER BY group_name, ticker"""
    ).fetchall():
        ticker = str(row["ticker"] or "").upper().strip()
        if not ticker:
            continue
        metadata = DEFAULT_WATCHLIST_METADATA.get(ticker)
        items.append(
            WatchlistItem(
            ticker=ticker,
            name=row["name"] or (metadata.name if metadata else ticker),
            sector=row["sector"] or (metadata.sector if metadata else ""),
            group_name=row["group_name"] or "watchlist",
            weight=float(row["weight"] or 0.0),
            )
        )
    return items


def _write_watchlist_json(json_path: Path, items: List[WatchlistItem]) -> None:
    grouped: Dict[str, dict] = {}
    for item in items:
        group = grouped.setdefault(item.group_name or "custom", {"targets": []})
        group["targets"].append(
            {
                "ticker": item.ticker,
                "name": item.name,
                "sector": item.sector,
                "weight": item.weight,
            }
        )

    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(grouped, indent=2), encoding="utf-8")


def _has_watchlist_state(conn) -> bool:
    row = conn.execute(
        "SELECT dataset_name FROM dataset_metadata WHERE dataset_name = ?",
        (WATCHLIST_STATE_DATASET,),
    ).fetchone()
    return row is not None


def _mark_watchlist_state(conn, source: str) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO dataset_metadata (dataset_name, last_updated_at, source)
           VALUES (?, ?, ?)""",
        (
            WATCHLIST_STATE_DATASET,
            datetime.now(timezone.utc).isoformat(),
            source,
        ),
    )


def _mark_watchlist_sync_status(conn, source: str, last_updated_at: str) -> None:
    conn.execute(
        """INSERT OR REPLACE INTO dataset_metadata (dataset_name, last_updated_at, source)
           VALUES (?, ?, ?)""",
        (
            WATCHLIST_SYNC_DATASET,
            last_updated_at,
            source,
        ),
    )
