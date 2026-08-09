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
import re
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

from apps.api.core.dev_monitor import emit_performance_event, get_current_request_id
from apps.api.models.schema_parts.dev_monitor import PerformanceEvent

logger = logging.getLogger(__name__)

# Resolve DB path from env or default
_DB_PATH = Path(os.getenv("DB_PATH", "data/processed/moneyview.db"))
_SQL_ACTION_PATTERN = re.compile(r"^\s*(SELECT|INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|PRAGMA)\b", re.IGNORECASE)
_SQL_TABLE_PATTERNS = {
    "SELECT": re.compile(r"\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "INSERT": re.compile(r"\bINTO\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "REPLACE": re.compile(r"\bINTO\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "UPDATE": re.compile(r"\bUPDATE\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "DELETE": re.compile(r"\bFROM\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "ALTER": re.compile(r"\bTABLE\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "CREATE": re.compile(r"\bTABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "DROP": re.compile(r"\bTABLE(?:\s+IF\s+EXISTS)?\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
    "PRAGMA": re.compile(r"^\s*PRAGMA\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE),
}


def _parse_sql_operation(sql: str) -> tuple[str, str | None]:
    action_match = _SQL_ACTION_PATTERN.match(sql or "")
    if not action_match:
        return "query", None
    action = action_match.group(1).upper()
    table_match = _SQL_TABLE_PATTERNS.get(action, re.compile(r"$^")).search(sql)
    table = table_match.group(1) if table_match else None
    return action.lower(), table


def _emit_db_event(
    *,
    operation_type: str,
    table: str | None,
    duration_ms: float,
    status: str,
    row_count: int | None = None,
    error_code: str | None = None,
    message: str | None = None,
) -> None:
    request_id = get_current_request_id()
    metadata: dict[str, object] = {"operation_type": operation_type}
    if row_count is not None:
        metadata["rows"] = row_count
    emit_performance_event(
        PerformanceEvent(
            request_id=request_id,
            level="error" if status == "error" else ("warn" if status == "slow" else "info"),
            scope="db",
            operation=f"db.{operation_type}_{table or 'query'}",
            status=status,
            duration_ms=duration_ms,
            table=table,
            error_code=error_code,
            message=message,
            metadata=metadata,
        )
    )


class InstrumentedCursor(sqlite3.Cursor):
    def __init__(self, connection: sqlite3.Connection):
        super().__init__(connection)
        self._perf_started_at = 0.0
        self._perf_operation_type = "query"
        self._perf_table: str | None = None
        self._perf_emitted = False
        self._perf_select_like = False

    def _begin(self, sql: str) -> None:
        self._perf_started_at = time.perf_counter()
        self._perf_operation_type, self._perf_table = _parse_sql_operation(sql)
        self._perf_emitted = False
        self._perf_select_like = self._perf_operation_type in {"select", "pragma"}

    def _duration_ms(self) -> float:
        return round((time.perf_counter() - self._perf_started_at) * 1000, 1)

    def _emit_success(self, row_count: int | None = None) -> None:
        if self._perf_emitted:
            return
        duration_ms = self._duration_ms()
        status = "slow" if duration_ms >= 250.0 else "success"
        _emit_db_event(
            operation_type=self._perf_operation_type,
            table=self._perf_table,
            duration_ms=duration_ms,
            status=status,
            row_count=row_count,
        )
        self._perf_emitted = True

    def _emit_error(self, exc: Exception) -> None:
        if self._perf_emitted:
            return
        _emit_db_event(
            operation_type=self._perf_operation_type,
            table=self._perf_table,
            duration_ms=self._duration_ms(),
            status="error",
            error_code=type(exc).__name__,
            message=str(exc),
        )
        self._perf_emitted = True

    def execute(self, sql: str, parameters=()):
        self._begin(sql)
        try:
            result = super().execute(sql, parameters)
        except Exception as exc:
            self._emit_error(exc)
            raise
        if not self._perf_select_like:
            row_count = self.rowcount if self.rowcount >= 0 else None
            self._emit_success(row_count=row_count)
        return result

    def executemany(self, sql: str, seq_of_parameters):
        self._begin(sql)
        try:
            result = super().executemany(sql, seq_of_parameters)
        except Exception as exc:
            self._emit_error(exc)
            raise
        row_count = self.rowcount if self.rowcount >= 0 else None
        self._emit_success(row_count=row_count)
        return result

    def fetchone(self):
        row = super().fetchone()
        self._emit_success(row_count=1 if row is not None else 0)
        return row

    def fetchmany(self, size: int | None = None):
        rows = super().fetchmany(size)
        self._emit_success(row_count=len(rows))
        return rows

    def fetchall(self):
        rows = super().fetchall()
        self._emit_success(row_count=len(rows))
        return rows

    def close(self) -> None:
        if self._perf_select_like and not self._perf_emitted:
            self._emit_success()
        super().close()


class InstrumentedConnection(sqlite3.Connection):
    def cursor(self, factory=None):
        return super().cursor(factory or InstrumentedCursor)

    def execute(self, sql, parameters=(), /):
        return self.cursor().execute(sql, parameters)

    def executemany(self, sql, seq_of_parameters, /):
        return self.cursor().executemany(sql, seq_of_parameters)


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
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False, factory=InstrumentedConnection)
    _configure(conn)
    try:
        yield conn
        if conn.in_transaction:
            conn.commit()
    except Exception:
        if conn.in_transaction:
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

CREATE TABLE IF NOT EXISTS portfolio_preferences (
    singleton_id            INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    total_investment_amount REAL NOT NULL DEFAULT 10000.0,
    transaction_fee_rate    REAL NOT NULL DEFAULT 0.002,
    updated_at              TEXT NOT NULL DEFAULT ''
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
    metric_schema_version        INTEGER NOT NULL DEFAULT 1,
    bridge_quality               TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (snapshot_version, ticker)
);
CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_lookup
    ON corporate_comparison_snapshots_v3(snapshot_date DESC, universe_key, snapshot_taken_at DESC, ticker);
CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_universe_date
    ON corporate_comparison_snapshots_v3(universe_key, snapshot_date DESC, snapshot_taken_at DESC, snapshot_version);
CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_ticker_universe_date
    ON corporate_comparison_snapshots_v3(ticker, universe_key, snapshot_date DESC, snapshot_taken_at DESC);

CREATE TABLE IF NOT EXISTS acquisition_state (
    data_class      TEXT NOT NULL,
    subject         TEXT NOT NULL,
    last_checked_at TEXT,
    last_success_at TEXT,
    covered_from    TEXT,
    covered_to      TEXT,
    status          TEXT NOT NULL DEFAULT 'never_acquired',
    detail          TEXT,
    PRIMARY KEY (data_class, subject)
);

-- Statements are stored one row per line item per period, not as a serialised blob, so
-- they can be queried deterministically, updated in part, and grown with new metrics
-- without a schema change or a deserialisation step.
CREATE TABLE IF NOT EXISTS corporate_statements (
    ticker         TEXT NOT NULL,
    statement_type TEXT NOT NULL,
    frequency      TEXT NOT NULL,
    period_end     TEXT NOT NULL,
    line_item      TEXT NOT NULL,
    value          REAL,
    fetched_at     TEXT NOT NULL,
    PRIMARY KEY (ticker, statement_type, frequency, period_end, line_item)
);

CREATE INDEX IF NOT EXISTS idx_corporate_statements_lookup
    ON corporate_statements(ticker, statement_type, frequency, period_end);

-- Quote-derived facts are a separate class from statements because they have a different
-- natural frequency. Market cap is acquired here, never derived from shares outstanding:
-- the balance-sheet share count is absent for ETFs, aggregates share classes, and counts
-- ordinary shares rather than ADRs.
CREATE TABLE IF NOT EXISTS corporate_quote_facts (
    ticker              TEXT PRIMARY KEY,
    market_cap          REAL,
    shares_outstanding  REAL,
    currency            TEXT DEFAULT '',
    beta                REAL,
    fetched_at          TEXT NOT NULL
);

-- ============================================================
-- Schema: Segment build-up valuation cases (hand-authored)
--
-- Independent of the acquisition pipeline: a case is authored, not fetched, so
-- a private or pre-IPO company with no ticker and no statements is a first-class
-- subject. See docs/superpowers/specs/2026-08-09-segment-buildup-valuation-design.md
-- ============================================================

CREATE TABLE IF NOT EXISTS valuation_case (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    case_name          TEXT NOT NULL UNIQUE,
    ticker             TEXT,                      -- NULL for private / pre-IPO
    as_of_date         TEXT NOT NULL,
    base_year          INTEGER NOT NULL,
    target_year        INTEGER NOT NULL,
    riskfree_rate      REAL NOT NULL,
    wacc_initial       REAL NOT NULL,
    wacc_stable        REAL NOT NULL,
    wacc_converge_from INTEGER NOT NULL DEFAULT 6,
    marginal_tax_rate  REAL NOT NULL,
    nol_balance        REAL NOT NULL DEFAULT 0,
    roic_stable        REAL NOT NULL,
    terminal_growth    REAL,                      -- NULL means: use riskfree_rate
    cash               REAL NOT NULL DEFAULT 0,
    debt               REAL NOT NULL DEFAULT 0,
    ipo_proceeds       REAL NOT NULL DEFAULT 0,
    shares_basic       REAL NOT NULL,
    shares_new         REAL NOT NULL DEFAULT 0,
    parent_case_id     INTEGER REFERENCES valuation_case(id)
);

CREATE TABLE IF NOT EXISTS segment (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id                INTEGER NOT NULL REFERENCES valuation_case(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    base_revenue           REAL NOT NULL,
    base_margin            REAL NOT NULL,
    tam_target             REAL,
    market_share_target    REAL,
    revenue_target         REAL,
    margin_target          REAL NOT NULL,
    sales_to_capital_early REAL NOT NULL,
    sales_to_capital_late  REAL NOT NULL,
    ramp_start_year        INTEGER NOT NULL DEFAULT 1,
    UNIQUE(case_id, name)
);
CREATE INDEX IF NOT EXISTS idx_segment_case ON segment(case_id);

CREATE TABLE IF NOT EXISTS segment_narrative (
    segment_id      INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    input_field     TEXT NOT NULL,
    claim           TEXT NOT NULL,
    evidence_source TEXT,
    confidence      TEXT NOT NULL CHECK(confidence IN ('confirmed','derived','assumed')),
    three_p         TEXT NOT NULL CHECK(three_p IN ('possible','plausible','probable')),
    PRIMARY KEY (segment_id, input_field)
);
"""


def init_db() -> None:
    """Create all tables if they do not exist. Safe to call multiple times."""
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False, factory=InstrumentedConnection)
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
            metric_schema_version        INTEGER NOT NULL DEFAULT 1,
            bridge_quality               TEXT NOT NULL DEFAULT '',
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
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_universe_date
           ON corporate_comparison_snapshots_v3(universe_key, snapshot_date DESC, snapshot_taken_at DESC, snapshot_version)"""
    )
    conn.execute(
        """CREATE INDEX IF NOT EXISTS idx_corporate_comparison_snapshots_v3_ticker_universe_date
           ON corporate_comparison_snapshots_v3(ticker, universe_key, snapshot_date DESC, snapshot_taken_at DESC)"""
    )
    if "dcf_implied_return" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN dcf_implied_return REAL NOT NULL DEFAULT 0.0")
    if "capm_expected_return" not in v3_columns:
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN capm_expected_return REAL NOT NULL DEFAULT 0.0")
    if "metric_schema_version" not in v3_columns:
        # 0, not METRIC_SCHEMA_VERSION: these rows were computed before the column existed,
        # and stamping them with the current version would make pre- and post-change
        # snapshots indistinguishable -- exactly what the column exists to prevent.
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN metric_schema_version INTEGER NOT NULL DEFAULT 0")
    if "bridge_quality" not in v3_columns:
        # '' , not 'missing': these rows were computed before the bridge existed. The
        # aggregate filter excludes only 'missing', so legacy rows stay in every
        # historical average exactly as they read today. Defaulting them to 'missing'
        # would silently rewrite the history this column exists to preserve -- the same
        # reasoning as metric_schema_version defaulting to 0 above.
        conn.execute("ALTER TABLE corporate_comparison_snapshots_v3 ADD COLUMN bridge_quality TEXT NOT NULL DEFAULT ''")
    quote_facts_columns = {row["name"] for row in conn.execute("PRAGMA table_info(corporate_quote_facts)")}
    if "beta" not in quote_facts_columns:
        conn.execute("ALTER TABLE corporate_quote_facts ADD COLUMN beta REAL")
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
    conn.execute(
        """INSERT OR IGNORE INTO portfolio_preferences
           (singleton_id, total_investment_amount, transaction_fee_rate, updated_at)
           VALUES (1, 10000.0, 0.002, '')"""
    )


def get_db_path() -> Path:
    return _DB_PATH
