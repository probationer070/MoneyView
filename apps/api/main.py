"""
FastAPI application entry point.

Run locally:
    uvicorn apps.api.main:app --reload --port 8000

From project root (e:\\MoneyView):
    python -m uvicorn apps.api.main:app --reload --port 8000
"""

import asyncio
import json
import os
import socket
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from apps.api.core.logger import configure_logging, setup_logger
from apps.api.core.middleware import StructuralMiddleware
from apps.api.core.transport_progress import TransportProgressMiddleware
from apps.api.routes import (
    corporate_router,
    dev_monitor_router,
    diagnostic_router,
    detail_router,
    market_router,
    monte_carlo_router,
    news_router,
    portfolio_router,
    report_router,
    stock_router,
)
from apps.api.services.db import get_db, init_db
from apps.api.services.market_data import MarketDataService

configure_logging()
logger = setup_logger(__name__)


def persist_port_atomic(port: int) -> None:
    """Write the chosen port atomically for frontend discovery."""
    target = Path("data/cache/moneyview_port.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_file = target.with_suffix(".tmp")

    try:
        with open(temp_file, "w", encoding="utf-8") as handle:
            json.dump({"port": port}, handle)
        os.replace(temp_file, target)
        logger.info("Port written safely to %s", target)
    except Exception as exc:
        logger.error("Failed to IPC store port file: %s", exc)


def find_available_port(start_port: int = 8000, max_port: int = 8100) -> int:
    """Find an available local port for desktop startup fallback."""
    for port in range(start_port, max_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(("127.0.0.1", port)) != 0:
                persist_port_atomic(port)
                return port
    persist_port_atomic(start_port)
    return start_port


async def wal_flush_cycle() -> None:
    """Background task to guard SQLite WAL growth every 15 minutes."""
    while True:
        await asyncio.sleep(15 * 60)
        try:
            with get_db() as conn:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            logger.info("Periodic background WAL truncate cycle OK.")
        except Exception as exc:
            logger.warning("Non-fatal background WAL checkpoint error: %s", exc)


async def stock_prewarm_cycle() -> None:
    """Schedule background cache hydration for configured tickers on startup."""
    try:
        tickers = await asyncio.to_thread(MarketDataService().prewarm_configured_tickers)
        if tickers:
            logger.info("Configured stock prewarm scheduled for %d tickers.", len(tickers))
    except Exception as exc:
        logger.warning("Non-fatal stock prewarm startup error: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle."""
    logger.info("MoneyView API starting; initialising database.")
    init_db()
    logger.info("Database ready.")

    task_wal = asyncio.create_task(wal_flush_cycle())

    # Read at call time, not import time, so a test process that sets this in
    # conftest still takes effect on an already-imported module.
    #
    # This cycle fetches live market data on startup. Under pytest that
    # means real network traffic, and stock_prewarm_cycle's asyncio.to_thread
    # worker cannot be cancelled -- it outlives the TestClient block, keeps
    # emitting into the dev-monitor sink, and evicts the events a test is
    # asserting on from its recent(limit=N) window.
    startup_jobs_disabled = os.getenv("MONEYVIEW_DISABLE_STARTUP_JOBS", "").lower() in {
        "1", "true", "yes",
    }
    background = [task_wal]
    if not startup_jobs_disabled:
        background.append(asyncio.create_task(stock_prewarm_cycle()))

    yield

    for task in background:
        task.cancel()
    # Await the cancellations so shutdown does not return while they are still
    # propagating. An in-flight asyncio.to_thread worker still cannot be killed
    # -- that is a CPython constraint, not something this gather fixes -- so a
    # prewarm started before shutdown can still outlive the app in production.
    # The real fix is a cooperative stop flag inside prewarm_configured_tickers,
    # which is out of scope here.
    await asyncio.gather(*background, return_exceptions=True)

    from apps.api.core.dev_monitor import get_dev_monitor_sink

    sink = get_dev_monitor_sink()
    shutdown = getattr(sink, "shutdown", None)
    if callable(shutdown):
        shutdown()

    logger.info("Tearing down SQLite connections and WAL truncate.")
    try:
        with get_db() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        logger.info("WAL checkpoint truncated cleanly.")
    except Exception as exc:
        logger.error("WAL cleanup failed: %s", exc)

    logger.info("MoneyView API shutting down.")


app = FastAPI(
    title="MoneyView API",
    description="Financial analytics backend; local-first desktop",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(StructuralMiddleware)
app.add_middleware(TransportProgressMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3101",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3101",
        "http://localhost:9080",
        "http://127.0.0.1:9080",
        "tauri://localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator().instrument(app).expose(app)

app.include_router(market_router, prefix="/api/v1/market", tags=["Market"])
app.include_router(portfolio_router, prefix="/api/v1/portfolio", tags=["Portfolio"])
app.include_router(detail_router, prefix="/api/v1/detail", tags=["Detail"])
app.include_router(news_router, prefix="/api/v1/news", tags=["News"])
app.include_router(corporate_router, prefix="/api/v1/corporate", tags=["Corporate"])
app.include_router(diagnostic_router, prefix="/api/v1/diagnostic", tags=["Diagnostic"])
app.include_router(dev_monitor_router, prefix="/api/v1/dev", tags=["Dev Monitor"])
app.include_router(report_router, prefix="/api/v1/report", tags=["Report"])
app.include_router(monte_carlo_router, prefix="/api/v1/monte-carlo", tags=["Monte Carlo"])
app.include_router(stock_router, prefix="/api/v1/stock", tags=["Stock"])


@app.get("/api/v1/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/api/v1/healthz", tags=["Health"])
async def healthz():
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    target_port = find_available_port()
    logger.info("Binding to robust desktop port: %s", target_port)
    uvicorn.run("apps.api.main:app", host="127.0.0.1", port=target_port, reload=False)
