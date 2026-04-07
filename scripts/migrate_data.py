"""
CSV → SQLite data migration script.

Usage (from project root):
    python scripts/migrate_data.py

What it does:
  1. Reads all stock CSVs from src/stocks/{TICKER}/prices.csv  → stocks table
  2. Reads all macro/economic CSVs from src/**/*.csv            → indicators table
  3. Reads all index CSVs from src/indices/*.csv               → indices table
  4. Reads stock_targets.json                                   → watchlist table
  5. Prints row count comparison: CSV vs DB

Schema A (macro):   category, name, code, value, unit, date, source, cycle, description
Schema B (stocks):  Date, Open, High, Low, Close, Volume, Dividends, Stock Splits
"""

import sys
import json
import logging
from pathlib import Path

# Run from project root
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pandas as pd
from apps.api.services.db import get_db, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
)
logger = logging.getLogger(__name__)

SRC = ROOT / "src"
STOCKS_DIR  = SRC / "stocks"
INDICES_DIR = SRC / "indices"

# Directories that contain Schema A (macro indicator) CSVs
MACRO_DIRS = [
    SRC / "금리",
    SRC / "물가",
    SRC / "통화",
    SRC / "환율",
    SRC / "경기",
    SRC / "원자재",
]


# ---------------------------------------------------------------------------
# Schema B — Stocks
# ---------------------------------------------------------------------------

def _migrate_stocks() -> int:
    """Read src/stocks/{TICKER}/prices.csv into stocks table."""
    total = 0
    if not STOCKS_DIR.exists():
        logger.warning("stocks dir not found: %s", STOCKS_DIR)
        return 0

    for ticker_dir in sorted(STOCKS_DIR.iterdir()):
        if not ticker_dir.is_dir():
            continue
        ticker = ticker_dir.name
        prices_csv = ticker_dir / "prices.csv"
        if not prices_csv.exists():
            continue
        try:
            df = pd.read_csv(prices_csv)
            # Normalise Date
            if "Date" in df.columns:
                df["Date"] = pd.to_datetime(df["Date"])
                if df["Date"].dt.tz is not None:
                    df["Date"] = df["Date"].dt.tz_localize(None)
                df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")

            with get_db() as conn:
                for _, row in df.iterrows():
                    conn.execute(
                        """INSERT OR REPLACE INTO stocks
                           (ticker, date, open, high, low, close, volume,
                            dividends, stock_splits)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            ticker,
                            str(row.get("Date", "")),
                            float(row.get("Open", 0) or 0),
                            float(row.get("High", 0) or 0),
                            float(row.get("Low",  0) or 0),
                            float(row.get("Close",0) or 0),
                            int(float(row.get("Volume", 0) or 0)),
                            float(row.get("Dividends", 0) or 0),
                            float(row.get("Stock Splits", 0) or 0),
                        ),
                    )
            n = len(df)
            total += n
            logger.info("  ✓ stocks  %-12s  %d rows", ticker, n)
        except Exception as e:
            logger.error("  ✗ %s: %s", ticker, e)
    return total


# ---------------------------------------------------------------------------
# Schema A — Macro Indicators
# ---------------------------------------------------------------------------

def _migrate_indicators(directory: Path, category_override: str = "") -> int:
    """Read a macro indicator directory into the indicators table."""
    if not directory.exists():
        return 0
    total = 0
    for csv_file in sorted(directory.glob("*.csv")):
        try:
            df = pd.read_csv(csv_file, encoding="utf-8-sig")
            # Expect: category, name, code, value, unit, date, source, cycle, description
            required = {"category", "name", "code", "value", "date"}
            if not required.issubset(set(df.columns)):
                logger.warning("  skip %s — unexpected columns: %s", csv_file.name, list(df.columns))
                continue

            with get_db() as conn:
                for _, row in df.iterrows():
                    conn.execute(
                        """INSERT OR REPLACE INTO indicators
                           (category, name, code, value, unit, date, source, cycle, description)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            str(row.get("category",    category_override)),
                            str(row.get("name",        "")),
                            str(row.get("code",        "")),
                            float(row["value"]) if pd.notna(row.get("value")) else None,
                            str(row.get("unit",        "")),
                            str(row.get("date",        "")),
                            str(row.get("source",      "")),
                            str(row.get("cycle",       "")),
                            str(row.get("description", "")),
                        ),
                    )
            n = len(df)
            total += n
            logger.info("  ✓ indicators  %-30s  %d rows", csv_file.name, n)
        except Exception as e:
            logger.error("  ✗ %s: %s", csv_file.name, e)
    return total


# ---------------------------------------------------------------------------
# Schema B (variant) — Indices
# ---------------------------------------------------------------------------

def _migrate_indices() -> int:
    """Read src/indices/ into indices table (if the directory exists)."""
    if not INDICES_DIR.exists():
        logger.info("  (no src/indices/ directory — skipping)")
        return 0
    total = 0
    for csv_file in sorted(INDICES_DIR.glob("*.csv")):
        try:
            df = pd.read_csv(csv_file)
            # Try to infer ticker and name from filename
            ticker = csv_file.stem
            if "Date" in df.columns:
                df["Date"] = pd.to_datetime(df["Date"])
                if df["Date"].dt.tz is not None:
                    df["Date"] = df["Date"].dt.tz_localize(None)
                df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")

            with get_db() as conn:
                for _, row in df.iterrows():
                    conn.execute(
                        """INSERT OR REPLACE INTO indices
                           (name, ticker, date, open, high, low, close, volume)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            ticker,
                            str(row.get("Ticker", ticker)),
                            str(row.get("Date", "")),
                            float(row.get("Open",   0) or 0),
                            float(row.get("High",   0) or 0),
                            float(row.get("Low",    0) or 0),
                            float(row.get("Close",  0) or 0),
                            int(float(row.get("Volume", 0) or 0)),
                        ),
                    )
            n = len(df)
            total += n
            logger.info("  ✓ indices  %-20s  %d rows", ticker, n)
        except Exception as e:
            logger.error("  ✗ %s: %s", csv_file.name, e)
    return total


# ---------------------------------------------------------------------------
# Watchlist (stock_targets.json)
# ---------------------------------------------------------------------------

def _migrate_watchlist() -> int:
    """Read the packaged webscrap stock_targets.json into watchlist table."""
    json_path = ROOT / "apps" / "api" / "services" / "webscrap" / "stock_targets.json"
    if not json_path.exists():
        logger.warning("  stock_targets.json not found at %s", json_path)
        return 0
    try:
        data = json.loads(json_path.read_text(encoding="utf-8"))
        n = 0
        with get_db() as conn:
            for group_name, group in data.items():
                for t in group.get("targets", []):
                    ticker = t.get("ticker", "")
                    if not ticker:
                        continue
                    conn.execute(
                        """INSERT OR IGNORE INTO watchlist (ticker, name, sector, group_name)
                           VALUES (?, ?, ?, ?)""",
                        (ticker, t.get("name", ticker), t.get("sector", ""), group_name),
                    )
                    n += 1
        logger.info("  ✓ watchlist  %d entries", n)
        return n
    except Exception as e:
        logger.error("  ✗ watchlist: %s", e)
        return 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    logger.info("=" * 60)
    logger.info("MoneyView Data Migration: CSV → SQLite")
    logger.info("DB: %s", (ROOT / "data" / "processed" / "moneyview.db").resolve())
    logger.info("=" * 60)

    logger.info("\n[1/4] Initialising database schema …")
    init_db()

    logger.info("\n[2/4] Migrating stocks (Schema B) …")
    stocks_n = _migrate_stocks()

    logger.info("\n[3/4] Migrating macro indicators (Schema A) …")
    macro_n = 0
    for macro_dir in MACRO_DIRS:
        macro_n += _migrate_indicators(macro_dir)

    logger.info("\n[4/4] Migrating indices + watchlist …")
    idx_n  = _migrate_indices()
    wl_n   = _migrate_watchlist()

    logger.info("\n" + "=" * 60)
    logger.info("Migration complete!")
    logger.info("  Stocks:      %d rows", stocks_n)
    logger.info("  Indicators:  %d rows", macro_n)
    logger.info("  Indices:     %d rows", idx_n)
    logger.info("  Watchlist:   %d entries", wl_n)
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
