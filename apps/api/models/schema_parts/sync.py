from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field

from .watchlist import WatchlistPeer, WatchlistPeerSyncStatus, WatchlistSkippedFile


class RecordsSyncStatus(BaseModel):
    """The last recorded records peer-sync attempt. Replaced as a whole by every attempt (spec §2)."""

    enabled: bool = False
    pc_id: Optional[str] = None
    peers: List[WatchlistPeer] = Field(default_factory=list)
    skipped_files: List[WatchlistSkippedFile] = Field(default_factory=list)
    last_sync_at: Optional[str] = None
    last_error: Optional[str] = None
    renamed: List[str] = Field(default_factory=list)


class SyncStatus(BaseModel):
    """Both peer-sync halves, reported together (task 7)."""

    watchlist: WatchlistPeerSyncStatus
    records: RecordsSyncStatus
