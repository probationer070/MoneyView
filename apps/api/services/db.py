"""
SQLite connection manager — WAL mode, single-file, desktop-optimised.

Usage:
    from apps.api.services.db import get_db, init_db

    # In FastAPI lifespan:
    init_db()

    # In route handlers:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM stocks WHERE ticker=?", (ticker,)).fetchall()
"""

import sqlite3
import os
import logging
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

logger = logging.getLogger(__name__)

# Resolve DB path from env or default
_DB_PATH = Path(os.getenv("DB_PATH", "data/processed/moneyview.db"))


def _configure(conn: sqlite3.Connection) -> None:
    """Apply performance pragmas for a desktop SQLite session."""
    conn.execute("PRAGMA journal_mode=WAL")       # concurrent reads during writes
    conn.execute("PRAGMA cache_size=-65536")      # 64 MB page cache
    conn.execute("PRAGMA synchronous=NORMAL")     # safe for local desktop
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA temp_store=MEMORY")
    conn.row_factory = sqlite3.Row               # dict-like row access


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context-managed SQLite connection with WAL mode."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    _configure(conn)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


_CREATE_SCHEMA_SQL = """
-- ============================================================
-- Schema B: Financial Asset OHLCV
-- ============================================================

CREATE TABLE IF NOT EXISTS indices (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    ticker       TEXT NOT NULL,
    date         TEXT NOT NULL,
    open         REAL,
    high         REAL,
    low          REAL,
    close        REAL,
    volume       INTEGER,
    dividends    REAL DEFAULT 0.0,
    stock_splits REAL DEFAULT 0.0,
    UNIQUE(ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_indices_ticker_date ON indices(ticker, date);

CREATE TABLE IF NOT EXISTS stocks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT NOT NULL,
    date         TEXT NOT NULL,
    open         REAL,
    high         REAL,
    low          REAL,
    close        REAL,
    volume       INTEGER,
    dividends    REAL DEFAULT 0.0,
    stock_splits REAL DEFAULT 0.0,
    UNIQUE(ticker, date)
);
CREATE INDEX IF NOT EXISTS idx_stocks_ticker_date ON stocks(ticker, date);

-- ============================================================
-- Schema A: Macro / Economic Indicators
-- ============================================================

CREATE TABLE IF NOT EXISTS indicators (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category    TEXT NOT NULL,
    name        TEXT NOT NULL,
    code        TEXT NOT NULL,
    value       REAL,
    unit        TEXT DEFAULT '',
    date        TEXT NOT NULL,
    source      TEXT DEFAULT '',
    cycle       TEXT DEFAULT '',
    description TEXT DEFAULT '',
    UNIQUE(code, date)
);
CREATE INDEX IF NOT EXISTS idx_indicators_code_date ON indicators(code, date);
CREATE INDEX IF NOT EXISTS idx_indicators_category  ON indicators(category);

-- ============================================================
-- News
-- ============================================================

CREATE TABLE IF NOT EXISTS news (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker         TEXT,
    headline       TEXT NOT NULL,
    url            TEXT DEFAULT '',
    source         TEXT DEFAULT '',
    published_date TEXT DEFAULT '',
    sentiment      TEXT DEFAULT 'neutral',
    importance     INTEGER DEFAULT 1,
    hash           TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_news_ticker ON news(ticker);

-- ============================================================
-- Watchlist (from stock_targets.json)
-- ============================================================

CREATE TABLE IF NOT EXISTS watchlist (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker     TEXT NOT NULL UNIQUE,
    name       TEXT DEFAULT '',
    sector     TEXT DEFAULT '',
    group_name TEXT DEFAULT 'custom'
);

-- ============================================================
-- Data Freshness & Cache Control
-- ============================================================

CREATE TABLE IF NOT EXISTS dataset_metadata (
    dataset_name    TEXT PRIMARY KEY,
    last_updated_at TEXT NOT NULL,
    source          TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS corporate_metrics (
    ticker          TEXT PRIMARY KEY,
    growth          REAL NOT NULL DEFAULT 6.0,
    roic            REAL NOT NULL DEFAULT 18.0,
    wacc            REAL NOT NULL DEFAULT 10.0,
    debt_ratio      REAL NOT NULL DEFAULT 18.0,
    unlevered_beta  REAL NOT NULL DEFAULT 1.05,
    crp             REAL NOT NULL DEFAULT 1.1,
    reinvestment    REAL NOT NULL DEFAULT 34.0,
    fcff            REAL NOT NULL DEFAULT 92.0,
    innovation      REAL NOT NULL DEFAULT 82.0,
    market_share    REAL NOT NULL DEFAULT 64.0,
    governance      REAL NOT NULL DEFAULT 74.0,
    esg_penalty     REAL NOT NULL DEFAULT 22.0,
    updated_at      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS corporate_companies (
    ticker     TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    sector     TEXT DEFAULT '',
    source     TEXT DEFAULT 'manual',
    updated_at TEXT NOT NULL DEFAULT ''
);
"""


def init_db() -> None:
    """Create all tables if they do not exist. Safe to call multiple times."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    _configure(conn)
    try:
        conn.executescript(_CREATE_SCHEMA_SQL)
        _ensure_schema_compatibility(conn)
        conn.commit()
        logger.info("DB initialised at %s", _DB_PATH.resolve())
    finally:
        conn.close()


def _ensure_schema_compatibility(conn: sqlite3.Connection) -> None:
    """Apply additive migrations for older local SQLite files."""
    index_columns = {row["name"] for row in conn.execute("PRAGMA table_info(indices)")}
    if "dividends" not in index_columns:
        conn.execute("ALTER TABLE indices ADD COLUMN dividends REAL DEFAULT 0.0")
    if "stock_splits" not in index_columns:
        conn.execute("ALTER TABLE indices ADD COLUMN stock_splits REAL DEFAULT 0.0")
    conn.execute(
        """CREATE TABLE IF NOT EXISTS corporate_companies (
            ticker     TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            sector     TEXT DEFAULT '',
            source     TEXT DEFAULT 'manual',
            updated_at TEXT NOT NULL DEFAULT ''
        )"""
    )


def get_db_path() -> Path:
    return _DB_PATH
