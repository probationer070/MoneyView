"""Both peer-sync halves, reported together (task 7)."""

from fastapi import APIRouter

from apps.api.models.schemas import APIResponse, SyncStatus
from apps.api.services.records_sync import service as records_sync
from apps.api.services.watchlist_sync import service as watchlist_sync

router = APIRouter()


@router.get("/status", response_model=APIResponse[SyncStatus])
def get_sync_status():
    """Both peer-sync halves. Read-only: it never triggers a sync."""
    return APIResponse(data=SyncStatus(watchlist=watchlist_sync.current_status(),
                                       records=records_sync.current_status()))
