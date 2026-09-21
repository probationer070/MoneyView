"""run_records_sync: the one routine every trigger for records peer sync uses (spec §3).

read peer files -> merge -> apply to SQLite -> write this PC's file, under one process lock. It
never raises: a failure is recorded in the status, and the local records keep working.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from apps.api.models.schemas import RecordsSyncStatus, WatchlistPeer, WatchlistSkippedFile
from apps.api.services.db import get_db
from apps.api.services.records_sync import store
from apps.api.services.records_sync.files import read_peer_files, write_own_file
from apps.api.services.records_sync.merge import merge_record_states
from apps.api.services.peer_sync.model import next_stamp
from apps.api.services.watchlist_sync import store as watchlist_store

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_status = RecordsSyncStatus()


def sync_root() -> Path | None:
    raw = os.getenv("MONEYVIEW_SYNC_DIR", "").strip()
    return Path(raw) if raw else None


def is_enabled() -> bool:
    return sync_root() is not None


def current_status() -> RecordsSyncStatus:
    if not is_enabled():
        return RecordsSyncStatus(enabled=False)
    return _status


def run_records_sync(trigger: str) -> None:
    global _status
    root = sync_root()
    if root is None:
        _status = RecordsSyncStatus(enabled=False)
        return
    with _lock:
        pc_id = None
        try:
            with get_db() as conn:
                pc_id = watchlist_store.get_or_create_pc_id(conn)
            peers, skipped = read_peer_files(root, pc_id)
            with get_db() as conn:
                # Serialises this read-merge-apply window against every other SQLite writer, so a
                # local write landing between the snapshot and apply_state can never be silently
                # deleted or overwritten. backfill_uids and ensure_first_sync run inside this same
                # transaction, not in an earlier block: a record inserted while read_peer_files was
                # doing its (unlocked) cloud-folder I/O could otherwise get a uid -- immediately, for
                # a natural-identity kind such as event_category -- with no record_sync row yet.
                # read_local_state would not see it, and apply_state would delete it as absent from
                # the merged state.
                conn.execute("BEGIN IMMEDIATE")
                store.backfill_uids(conn)
                store.ensure_first_sync(conn, pc_id)
                merged = merge_record_states([store.read_local_state(conn), *(peer.state for peer in peers)])
                renamed = store.apply_state(conn, merged)
            finished = next_stamp()
            write_own_file(root, pc_id, merged, finished)
            _status = RecordsSyncStatus(
                enabled=True,
                pc_id=pc_id,
                peers=[WatchlistPeer(pc_id=p.pc_id, written_at=p.written_at) for p in peers],
                skipped_files=[WatchlistSkippedFile(name=s.name, reason=s.reason) for s in skipped],
                last_sync_at=finished,
                last_error=None,
                renamed=renamed,
            )
        except Exception as error:  # noqa: BLE001 - sync must never break the local records
            logger.warning("records.peer_sync_failed trigger=%s error=%s", trigger, error)
            _status = RecordsSyncStatus(
                enabled=True, pc_id=pc_id, peers=[], skipped_files=[],
                last_sync_at=_status.last_sync_at, last_error=str(error), renamed=[],
            )
