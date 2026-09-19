"""run_sync: the one transaction every trigger uses (spec §2).

read peer files -> merge -> apply to SQLite -> write this PC's file, under one process lock. It
never raises: a failure is recorded in the status, and the local Watchlist keeps working.
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
from pathlib import Path

from apps.api.models.schemas import WatchlistPeer, WatchlistPeerSyncStatus, WatchlistSkippedFile
from apps.api.services.db import get_db
from apps.api.services.watchlist_sync import store
from apps.api.services.watchlist_sync.files import read_peer_files, write_own_file
from apps.api.services.watchlist_sync.model import merge_states, next_stamp

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_status = WatchlistPeerSyncStatus()


def sync_root() -> Path | None:
    raw = os.getenv("MONEYVIEW_SYNC_DIR", "").strip()
    return Path(raw) if raw else None


def is_enabled() -> bool:
    return sync_root() is not None


def local_pc_id(conn: sqlite3.Connection) -> str:
    return store.get_or_create_pc_id(conn)


def current_status() -> WatchlistPeerSyncStatus:
    if not is_enabled():
        return WatchlistPeerSyncStatus(enabled=False)
    return _status


def run_sync(trigger: str, seed_json: Path | None = None) -> None:
    global _status
    root = sync_root()
    if root is None:
        _status = WatchlistPeerSyncStatus(enabled=False)
        return
    with _lock:
        pc_id = None
        try:
            with get_db() as conn:
                pc_id = store.get_or_create_pc_id(conn)
                store.ensure_first_sync(conn, pc_id)
            peers, skipped = read_peer_files(root, pc_id)
            with get_db() as conn:
                empty = store.watchlist_is_empty(conn)
            if empty and not peers and not skipped:
                # Spec §3 precedence: with no peer file at all, a fresh PC runs today's bootstrap.
                # An unreadable peer is never "no peers": the PC stays empty until a later sync
                # reads it, rather than spreading starter defaults.
                from apps.api.services import watchlist_seed

                watchlist_seed.bootstrap_from_seed(seed_json or watchlist_seed.SEED_JSON)
            elif empty and peers:
                # I2: a PC that joins an existing sync through peers is bootstrapped too, or a
                # later attempt where every peer file is unreadable would look fresh again and
                # reseed the defaults, spreading them back out to every other PC.
                from apps.api.services import watchlist_seed

                watchlist_seed.mark_watchlist_state("peer_sync")
            with get_db() as conn:
                # Serialises this read-merge-apply window against every other SQLite writer, so a
                # local write landing between the snapshot and apply_state can never be silently
                # deleted or overwritten (I1).
                conn.execute("BEGIN IMMEDIATE")
                merged = merge_states([store.read_local_state(conn), *(peer.state for peer in peers)])
                store.apply_state(conn, merged)
            finished = next_stamp()
            write_own_file(root, pc_id, merged, finished)
            _status = WatchlistPeerSyncStatus(
                enabled=True,
                pc_id=pc_id,
                peers=[WatchlistPeer(pc_id=p.pc_id, written_at=p.written_at) for p in peers],
                skipped_files=[WatchlistSkippedFile(name=s.name, reason=s.reason) for s in skipped],
                last_sync_at=finished,
                last_error=None,
            )
        except Exception as error:  # noqa: BLE001 - sync must never break the local Watchlist
            logger.warning("watchlist.peer_sync_failed trigger=%s error=%s", trigger, error)
            _status = WatchlistPeerSyncStatus(
                enabled=True, pc_id=pc_id, peers=[], skipped_files=[],
                last_sync_at=_status.last_sync_at, last_error=str(error),
            )
