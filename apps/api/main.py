"""
FastAPI application entry point.

Run locally:
    uvicorn apps.api.main:app --reload --port 8000

From project root (e:\MoneyView):
    python -m uvicorn apps.api.main:app --reload --port 8000
"""

import socket
import os
import json
import asyncio
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apps.api.core.logger import setup_logger
from apps.api.services.db import init_db, get_db
from apps.api.core.middleware import StructuralMiddleware

from apps.api.routes import (
    market_router,
    portfolio_router,
    detail_router,
    news_router,
    corporate_router,
    report_router,
    monte_carlo_router,
)

logger = setup_logger(__name__)

def persist_port_atomic(port: int):
    """Write bound port atomically to prevent Next.js from reading corrupted UI states."""
    target = Path("data/cache/moneyview_port.json")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_file = target.with_suffix(".tmp")
    
    try:
        with open(temp_file, "w") as f:
            json.dump({"port": port}, f)
        os.replace(temp_file, target) # Atomic POSIX
        logger.info(f"Port written safely to {target}")
    except Exception as e:
        logger.error(f"Failed to IPC store port file: {e}")

def find_available_port(start_port: int = 8000, max_port: int = 8100) -> int:
    """Find an available port for Tauri hook fallback."""
    for port in range(start_port, max_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            if sock.connect_ex(('127.0.0.1', port)) != 0:
                persist_port_atomic(port)
                return port
    persist_port_atomic(start_port)
    return start_port

async def wal_flush_cycle():
    """Background task to guard SQLite WAL growth every 15 minutes."""
    while True:
        await asyncio.sleep(15 * 60)
        try:
            with get_db() as conn:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            logger.info("Periodic background WAL Truncate cycle OK.")
        except Exception as e:
            logger.warning(f"Non-fatal background WAL checkpoint error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    logger.info("MoneyView API starting — initialising database …")
    init_db()
    logger.info("Database ready.")
    
    task_wal = asyncio.create_task(wal_flush_cycle())
    
    yield
    
    task_wal.cancel()
    
    logger.info("Tearing down SQLite connections & WAL truncate...")
    try:
        with get_db() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        logger.info("WAL checkpoint truncated cleanly.")
    except Exception as e:
        logger.error(f"WAL cleanup failed: {e}")
        
    logger.info("MoneyView API shutting down.")


app = FastAPI(
    title="MoneyView API",
    description="Financial analytics backend — local-first desktop",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(StructuralMiddleware)

# Allow Next.js dev server and future Tauri webview
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Next.js dev
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "tauri://localhost",       # Tauri webview
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API v1 prefix structure implemented
app.include_router(market_router,    prefix="/api/v1/market",    tags=["Market"])
app.include_router(portfolio_router, prefix="/api/v1/portfolio", tags=["Portfolio"])
app.include_router(detail_router,    prefix="/api/v1/detail",    tags=["Detail"])
app.include_router(news_router,      prefix="/api/v1/news",      tags=["News"])
app.include_router(corporate_router, prefix="/api/v1/corporate", tags=["Corporate"])
app.include_router(report_router,    prefix="/api/v1/report",    tags=["Report"])
app.include_router(monte_carlo_router, prefix="/api/v1/monte-carlo", tags=["Monte Carlo"])

@app.get("/api/v1/health", tags=["Health"])
async def health():
    return {"status": "ok", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    # Dynamic port loading for Tauri
    TARGET_PORT = find_available_port()
    logger.info(f"Binding to robust desktop port: {TARGET_PORT}")
    uvicorn.run("apps.api.main:app", host="127.0.0.1", port=TARGET_PORT, reload=False)
