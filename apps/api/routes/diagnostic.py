from datetime import datetime, timezone

from fastapi import APIRouter, Query

from apps.api.core.logger import get_log_path, read_log_tail
from apps.api.models.schemas import APIMeta, APIResponse, LogTailResponse

router = APIRouter()


@router.get("/logs/api-tail", response_model=APIResponse[LogTailResponse])
async def get_api_log_tail(lines: int = Query(default=100, ge=1, le=500)):
    """Return a recent plain-text tail of the persistent API server log."""
    tail_lines = read_log_tail(max_lines=lines)
    return APIResponse(
        data=LogTailResponse(
            log_path=str(get_log_path()),
            line_count=len(tail_lines),
            lines=tail_lines,
        ),
        meta=APIMeta(last_updated_at=datetime.now(timezone.utc).isoformat(), request_id=""),
    )
