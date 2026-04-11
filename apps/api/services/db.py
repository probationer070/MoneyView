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
    group_name TEXT DEFAULT 'custom',
    weight     REAL DEFAULT 0.0
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

CREATE TABLE IF NOT EXISTS corporate_comparison_snapshots (
    snapshot_date              TEXT NOT NULL,
    snapshot_taken_at          TEXT NOT NULL,
    snapshot_source            TEXT DEFAULT 'auto_daily',
    risk_free_rate             REAL NOT NULL DEFAULT 0.0,
    equity_risk_premium        REAL NOT NULL DEFAULT 0.0,
    stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
    ticker                     TEXT NOT NULL,
    name                       TEXT DEFAULT '',
    sector                     TEXT DEFAULT '',
    group_name                 TEXT DEFAULT 'custom',
    weight                     REAL DEFAULT 0.0,
    roic                       REAL NOT NULL DEFAULT 0.0,
    wacc                       REAL NOT NULL DEFAULT 0.0,
    roic_minus_wacc            REAL NOT NULL DEFAULT 0.0,
    dcf_value                  REAL NOT NULL DEFAULT 0.0,
    current_price              REAL NOT NULL DEFAULT 0.0,
    stock_expected_return      REAL NOT NULL DEFAULT 0.0,
    market_expected_return     REAL NOT NULL DEFAULT 0.0,
    expected_return_spread     REAL NOT NULL DEFAULT 0.0,
    stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
    has_price_data             INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (snapshot_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_date
    ON corporate_comparison_snapshots(snapshot_date DESC, ticker);

CREATE TABLE IF NOT EXISTS corporate_comparison_snapshots_v2 (
    snapshot_date                TEXT NOT NULL,
    universe_key                 TEXT NOT NULL,
    comparison_universe          TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark',
    benchmark_ticker             TEXT DEFAULT '^GSPC',
    custom_tickers               TEXT DEFAULT '',
    snapshot_taken_at            TEXT NOT NULL,
    snapshot_source              TEXT DEFAULT 'auto_daily',
    risk_free_rate               REAL NOT NULL DEFAULT 0.0,
    equity_risk_premium          REAL NOT NULL DEFAULT 0.0,
    stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
    ticker                       TEXT NOT NULL,
    name                         TEXT DEFAULT '',
    sector                       TEXT DEFAULT '',
    group_name                   TEXT DEFAULT 'custom',
    weight                       REAL DEFAULT 0.0,
    roic                         REAL NOT NULL DEFAULT 0.0,
    wacc                         REAL NOT NULL DEFAULT 0.0,
    roic_minus_wacc              REAL NOT NULL DEFAULT 0.0,
    dcf_value                    REAL NOT NULL DEFAULT 0.0,
    current_price                REAL NOT NULL DEFAULT 0.0,
    stock_expected_return        REAL NOT NULL DEFAULT 0.0,
    market_expected_return       REAL NOT NULL DEFAULT 0.0,
    expected_return_spread       REAL NOT NULL DEFAULT 0.0,
    stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
    has_price_data               INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (snapshot_date, universe_key, ticker)
);
CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v2_date
    ON corporate_comparison_snapshots_v2(snapshot_date DESC, universe_key, ticker);

CREATE TABLE IF NOT EXISTS corporate_comparison_snapshots_v3 (
    snapshot_version             TEXT NOT NULL,
    snapshot_date                TEXT NOT NULL,
    universe_key                 TEXT NOT NULL,
    comparison_universe          TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark',
    benchmark_ticker             TEXT DEFAULT '^GSPC',
    custom_tickers               TEXT DEFAULT '',
    snapshot_taken_at            TEXT NOT NULL,
    snapshot_source              TEXT DEFAULT 'auto_daily',
    risk_free_rate               REAL NOT NULL DEFAULT 0.0,
    equity_risk_premium          REAL NOT NULL DEFAULT 0.0,
    stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
    ticker                       TEXT NOT NULL,
    name                         TEXT DEFAULT '',
    sector                       TEXT DEFAULT '',
    group_name                   TEXT DEFAULT 'custom',
    weight                       REAL DEFAULT 0.0,
    roic                         REAL NOT NULL DEFAULT 0.0,
    wacc                         REAL NOT NULL DEFAULT 0.0,
    roic_minus_wacc              REAL NOT NULL DEFAULT 0.0,
    dcf_value                    REAL NOT NULL DEFAULT 0.0,
    current_price                REAL NOT NULL DEFAULT 0.0,
    dcf_implied_return           REAL NOT NULL DEFAULT 0.0,
    capm_expected_return         REAL NOT NULL DEFAULT 0.0,
    stock_expected_return        REAL NOT NULL DEFAULT 0.0,
    market_expected_return       REAL NOT NULL DEFAULT 0.0,
    expected_return_spread       REAL NOT NULL DEFAULT 0.0,
    stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
    has_price_data               INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (snapshot_version, ticker)
);
CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_lookup
    ON corporate_comparison_snapshots_v3(snapshot_date DESC, universe_key, snapshot_taken_at DESC, ticker);
"""


def init_db() -> None:
    """Create all tables if they do not exist. Safe to call multiple times."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    _configure(conn)
    try:
        try:
            conn.executescript(_CREATE_SCHEMA_SQL)
        except sqlite3.OperationalError as exc:
            if "no such column: universe_key" not in str(exc):
                raise
            logger.info("DB bootstrap detected legacy snapshot tables without universe columns; applying compatibility migrations.")
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
    conn.execute(
        """CREATE TABLE IF NOT EXISTS corporate_comparison_snapshots (
            snapshot_date                TEXT NOT NULL,
            snapshot_taken_at            TEXT NOT NULL,
            snapshot_source              TEXT DEFAULT 'auto_daily',
            risk_free_rate               REAL NOT NULL DEFAULT 0.0,
            equity_risk_premium          REAL NOT NULL DEFAULT 0.0,
            stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
            ticker                       TEXT NOT NULL,
            name                         TEXT DEFAULT '',
            sector                       TEXT DEFAULT '',
            group_name                   TEXT DEFAULT 'custom',
            weight                       REAL DEFAULT 0.0,
            roic                         REAL NOT NULL DEFAULT 0.0,
            wacc                         REAL NOT NULL DEFAULT 0.0,
            roic_minus_wacc              REAL NOT NULL DEFAULT 0.0,
            dcf_value                    REAL NOT NULL DEFAULT 0.0,
            current_price                REAL NOT NULL DEFAULT 0.0,
            stock_expected_return        REAL NOT NULL DEFAULT 0.0,
            market_expected_return       REAL NOT NULL DEFAULT 0.0,
            expected_return_spread       REAL NOT NULL DEFAULT 0.0,
            stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
            has_price_data               INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (snapshot_date, ticker)
        )"""
    )
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_date
           ON corporate_comparison_snapshots(snapshot_date DESC, ticker)"""
    )
    snapshot_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots)")}
    if "comparison_universe" not in snapshot_columns:
        conn.execute(
            "ALTER TABLE corporate_comparison_snapshots ADD COLUMN comparison_universe TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark'"
        )
    if "risk_free_rate" not in snapshot_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots ADD COLUMN risk_free_rate REAL NOT NULL DEFAULT 0.0")
    if "equity_risk_premium" not in snapshot_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots ADD COLUMN equity_risk_premium REAL NOT NULL DEFAULT 0.0")
    if "stock_expected_return_method" not in snapshot_columns:
        conn.execute(
            "ALTER TABLE corporate_comparison_snapshots ADD COLUMN stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside'"
        )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS corporate_comparison_snapshots_v2 (
            snapshot_date                TEXT NOT NULL,
            universe_key                 TEXT NOT NULL,
            comparison_universe          TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark',
            benchmark_ticker             TEXT DEFAULT '^GSPC',
            custom_tickers               TEXT DEFAULT '',
            snapshot_taken_at            TEXT NOT NULL,
            snapshot_source              TEXT DEFAULT 'auto_daily',
            risk_free_rate               REAL NOT NULL DEFAULT 0.0,
            equity_risk_premium          REAL NOT NULL DEFAULT 0.0,
            stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
            ticker                       TEXT NOT NULL,
            name                         TEXT DEFAULT '',
            sector                       TEXT DEFAULT '',
            group_name                   TEXT DEFAULT 'custom',
            weight                       REAL DEFAULT 0.0,
            roic                         REAL NOT NULL DEFAULT 0.0,
            wacc                         REAL NOT NULL DEFAULT 0.0,
            roic_minus_wacc              REAL NOT NULL DEFAULT 0.0,
            dcf_value                    REAL NOT NULL DEFAULT 0.0,
            current_price                REAL NOT NULL DEFAULT 0.0,
            stock_expected_return        REAL NOT NULL DEFAULT 0.0,
            market_expected_return       REAL NOT NULL DEFAULT 0.0,
            expected_return_spread       REAL NOT NULL DEFAULT 0.0,
            stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
            has_price_data               INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (snapshot_date, universe_key, ticker)
        )"""
    )
    v2_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v2)")}
    if "universe_key" not in v2_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v2 ADD COLUMN universe_key TEXT NOT NULL DEFAULT ''")
    if "comparison_universe" not in v2_columns:
        conn.execute(
            "ALTER TABLE corporate_comparison_snapshots_v2 ADD COLUMN comparison_universe TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark'"
        )
    if "benchmark_ticker" not in v2_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v2 ADD COLUMN benchmark_ticker TEXT DEFAULT '^GSPC'")
    if "custom_tickers" not in v2_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v2 ADD COLUMN custom_tickers TEXT DEFAULT ''")
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v2_date
           ON corporate_comparison_snapshots_v2(snapshot_date DESC, universe_key, ticker)"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS corporate_comparison_snapshots_v3 (
            snapshot_version             TEXT NOT NULL,
            snapshot_date                TEXT NOT NULL,
            universe_key                 TEXT NOT NULL,
            comparison_universe          TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark',
            benchmark_ticker             TEXT DEFAULT '^GSPC',
            custom_tickers               TEXT DEFAULT '',
            snapshot_taken_at            TEXT NOT NULL,
            snapshot_source              TEXT DEFAULT 'auto_daily',
            risk_free_rate               REAL NOT NULL DEFAULT 0.0,
            equity_risk_premium          REAL NOT NULL DEFAULT 0.0,
            stock_expected_return_method TEXT DEFAULT 'dcf_implied_upside',
            ticker                       TEXT NOT NULL,
            name                         TEXT DEFAULT '',
            sector                       TEXT DEFAULT '',
            group_name                   TEXT DEFAULT 'custom',
            weight                       REAL DEFAULT 0.0,
            roic                         REAL NOT NULL DEFAULT 0.0,
            wacc                         REAL NOT NULL DEFAULT 0.0,
            roic_minus_wacc              REAL NOT NULL DEFAULT 0.0,
            dcf_value                    REAL NOT NULL DEFAULT 0.0,
            current_price                REAL NOT NULL DEFAULT 0.0,
            dcf_implied_return           REAL NOT NULL DEFAULT 0.0,
            capm_expected_return         REAL NOT NULL DEFAULT 0.0,
            stock_expected_return        REAL NOT NULL DEFAULT 0.0,
            market_expected_return       REAL NOT NULL DEFAULT 0.0,
            expected_return_spread       REAL NOT NULL DEFAULT 0.0,
            stock_expected_return_source TEXT DEFAULT 'dcf_implied_upside',
            has_price_data               INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (snapshot_version, ticker)
        )"""
    )
    v3_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_comparison_snapshots_v3)")}
    if "universe_key" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN universe_key TEXT NOT NULL DEFAULT ''")
    if "comparison_universe" not in v3_columns:
        conn.execute(
            "ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN comparison_universe TEXT NOT NULL DEFAULT 'portfolio_plus_benchmark'"
        )
    if "benchmark_ticker" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN benchmark_ticker TEXT DEFAULT '^GSPC'")
    if "custom_tickers" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN custom_tickers TEXT DEFAULT ''")
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_lookup
           ON corporate_comparison_snapshots_v3(snapshot_date DESC, universe_key, snapshot_taken_at DESC, ticker)"""
    )
    if "dcf_implied_return" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN dcf_implied_return REAL NOT NULL DEFAULT 0.0")
    if "capm_expected_return" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN capm_expected_return REAL NOT NULL DEFAULT 0.0")
    v3_row = conn.execute("SELECT 1 FROM corporate_comparison_snapshots_v3 LIMIT 1").fetchone()
    if v3_row is None:
        conn.execute(
            """INSERT OR IGNORE INTO corporate_comparison_snapshots_v3 (
                   snapshot_version, snapshot_date, universe_key, comparison_universe, benchmark_ticker,
                   custom_tickers, snapshot_taken_at, snapshot_source, risk_free_rate, equity_risk_premium,
                   stock_expected_return_method, ticker, name, sector, group_name, weight, roic, wacc,
                   roic_minus_wacc, dcf_value, current_price, dcf_implied_return, capm_expected_return,
                   stock_expected_return, market_expected_return, expected_return_spread,
                   stock_expected_return_source, has_price_data
               )
               SELECT
                   snapshot_date || '|' || universe_key || '|' || snapshot_taken_at,
                   snapshot_date,
                   universe_key,
                   comparison_universe,
                   benchmark_ticker,
                   custom_tickers,
                   snapshot_taken_at,
                   snapshot_source,
                   risk_free_rate,
                   equity_risk_premium,
                   stock_expected_return_method,
                   ticker,
                   name,
                   sector,
                   group_name,
                   weight,
                   roic,
                   wacc,
                   roic_minus_wacc,
                   dcf_value,
                   current_price,
                   stock_expected_return,
                   market_expected_return,
                   stock_expected_return,
                   market_expected_return,
                   expected_return_spread,
                   stock_expected_return_source,
                   has_price_data
               FROM corporate_comparison_snapshots_v2"""
        )
    watchlist_columns = {row["name"] for row in conn.execute("PRAGMA table_info(watchlist)")}
    if "weight" not in watchlist_columns:
        conn.execute("ALTER TABLE watchlist ADD COLUMN weight REAL DEFAULT 0.0")
        watchlist_rows = conn.execute("SELECT ticker FROM watchlist ORDER BY ticker").fetchall()
        count = len(watchlist_rows)
        if count > 0:
            conn.execute("UPDATE watchlist SET weight = ?", (1.0 / count,))


def get_db_path() -> Path:
    return _DB_PATH
