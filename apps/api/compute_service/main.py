"""compute-service (private tier). Owns services + core_finance + SQLite + ingestion.

Phase 1: binds to loopback only. Exposes coarse compute operations over internal
HTTP. Returns domain models; the web envelope stays in the BFF.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from apps.api.compute_service.routes.portfolio import router as portfolio_router
from apps.api.core.dev_monitor import reset_current_request_id, set_current_request_id
from apps.api.core.logger import setup_logger
from apps.api.services.db import init_db

logger = setup_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("compute-service starting; initialising database.")
    init_db()
    yield
    logger.info("compute-service shutting down.")


compute_app = FastAPI(title="MoneyView compute-service", version="1.0.0", lifespan=lifespan)


@compute_app.middleware("http")
async def propagate_request_id(request: Request, call_next):
    """Adopt the BFF's X-Request-ID so perf events correlate across processes."""
    request_id = request.headers.get("X-Request-ID")
    token = set_current_request_id(request_id)
    try:
        response = await call_next(request)
    finally:
        reset_current_request_id(token)
    if request_id:
        response.headers["X-Request-ID"] = request_id
    return response


compute_app.include_router(portfolio_router, prefix="/compute", tags=["Compute"])


@compute_app.get("/compute/health")
async def health():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("apps.api.compute_service.main:compute_app", host="127.0.0.1", port=8600, reload=False)
