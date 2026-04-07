"""
Market data service for local SQLite plus live Yahoo Finance refresh.

Reads from SQLite first for speed, but refreshes from yfinance/Yahoo Chart API
when the newest stored bar is older than the previous trading day.
"""

from __future__ import annotations

import logging
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import List

import pandas as pd
import requests

# Allow importing from project root for API package execution.
_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from apps.api.models.schemas import DeltaBadge, IndexQuote, StockOHLCV
from apps.api.services.db import get_db

logger = logging.getLogger(__name__)

MARKET_INDICES = {
    "S&P 500": "^GSPC",
    "Dow Jones": "^DJI",
    "Nasdaq": "^IXIC",
    "KOSPI 200": "^KS200",
    "Gold": "GC=F",
    "Oil (WTI)": "CL=F",
    "Natural Gas": "NG=F",
    "USD/KRW": "KRW=X",
    "Bitcoin": "BTC-USD",
}

INDEX_DB_ALIASES = {
    "^GSPC": ["^GSPC", "S&P 500"],
    "^DJI": ["^DJI", "Dow Jones"],
    "^IXIC": ["^IXIC", "Nasdaq"],
    "^KS200": ["^KS200", "KOSPI 200"],
    "GC=F": ["GC=F", "Gold"],
    "CL=F": ["CL=F", "Oil (WTI)"],
    "NG=F": ["NG=F", "Natural Gas"],
    "KRW=X": ["KRW=X", "USD_KRW", "USD/KRW"],
    "BTC-USD": ["BTC-USD", "Bitcoin"],
}


class MarketDataService:
    """Fetch and persist market index / stock OHLCV data."""

    @staticmethod
    def _row_get(row, key: str, default=0):
        if hasattr(row, "keys") and key not in row.keys():
            return default
        try:
            return row[key]
        except (KeyError, IndexError):
            return default

    @staticmethod
    def _rows_to_ohlcv(rows) -> List[StockOHLCV]:
        seen_dates = set()
        deduped_rows = []
        for row in rows:
            row_date = str(row["date"])
            if row_date in seen_dates:
                continue
            seen_dates.add(row_date)
            deduped_rows.append(row)

        return [
            StockOHLCV(
                date=str(r["date"]),
                open=float(r["open"] or 0),
                high=float(r["high"] or 0),
                low=float(r["low"] or 0),
                close=float(r["close"] or 0),
                volume=int(r["volume"] or 0),
                dividends=float(MarketDataService._row_get(r, "dividends", 0) or 0),
                stock_splits=float(MarketDataService._row_get(r, "stock_splits", 0) or 0),
            )
            for r in deduped_rows
        ]

    @staticmethod
    def _normalise_date(df: pd.DataFrame) -> pd.DataFrame:
        """Ensure Date column is tz-naive string YYYY-MM-DD."""
        if "Date" in df.columns:
            df["Date"] = pd.to_datetime(df["Date"])
            if hasattr(df["Date"].dt, "tz") and df["Date"].dt.tz is not None:
                df["Date"] = df["Date"].dt.tz_localize(None)
            df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
        return df

    @staticmethod
    def _previous_trading_day(today: date | None = None) -> date:
        day = (today or date.today()) - timedelta(days=1)
        while day.weekday() >= 5:
            day -= timedelta(days=1)
        return day

    @staticmethod
    def _latest_row_date(rows) -> date | None:
        for row in rows:
            raw = str(row["date"])[:10]
            try:
                return datetime.strptime(raw, "%Y-%m-%d").date()
            except ValueError:
                continue
        return None

    def _rows_are_fresh(self, rows) -> bool:
        latest = self._latest_row_date(rows)
        return latest is not None and latest >= self._previous_trading_day()

    @staticmethod
    def _query_tickers(ticker: str, table: str) -> List[str]:
        if table != "indices":
            return [ticker]
        aliases = INDEX_DB_ALIASES.get(ticker, [ticker])
        return list(dict.fromkeys(aliases))

    @staticmethod
    def _index_name_for_ticker(ticker: str) -> str:
        for name, yahoo_ticker in MARKET_INDICES.items():
            if ticker == yahoo_ticker or ticker in INDEX_DB_ALIASES.get(yahoo_ticker, []):
                return name
        return ticker

    def _save_ohlcv_rows(self, ticker: str, rows: List[StockOHLCV]) -> None:
        table = "indices" if ticker in MARKET_INDICES.values() else "stocks"
        index_name = self._index_name_for_ticker(ticker)

        with get_db() as conn:
            columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
            has_actions = {"dividends", "stock_splits"}.issubset(columns)

            for row in rows:
                if table == "indices" and has_actions:
                    conn.execute(
                        """INSERT OR REPLACE INTO indices
                           (name, ticker, date, open, high, low, close, volume, dividends, stock_splits)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            index_name,
                            ticker,
                            row.date,
                            row.open,
                            row.high,
                            row.low,
                            row.close,
                            row.volume,
                            row.dividends,
                            row.stock_splits,
                        ),
                    )
                elif table == "indices":
                    conn.execute(
                        """INSERT OR REPLACE INTO indices
                           (name, ticker, date, open, high, low, close, volume)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                        (index_name, ticker, row.date, row.open, row.high, row.low, row.close, row.volume),
                    )
                else:
                    conn.execute(
                        """INSERT OR REPLACE INTO stocks
                           (ticker, date, open, high, low, close, volume, dividends, stock_splits)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (
                            ticker,
                            row.date,
                            row.open,
                            row.high,
                            row.low,
                            row.close,
                            row.volume,
                            row.dividends,
                            row.stock_splits,
                        ),
                    )

    def _fetch_yahoo_chart_ohlcv(self, ticker: str, period: str = "1y") -> List[StockOHLCV]:
        """Direct Yahoo chart API fallback, mirroring GlobalMacroCollector."""
        range_value = {
            "1w": "7d",
            "1mo": "1mo",
            "3mo": "3mo",
            "6mo": "6mo",
            "1y": "1y",
            "2y": "2y",
            "5y": "5y",
        }.get(period, "1y")
        response = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept-Language": "en-US,en;q=0.9",
                "Origin": "https://finance.yahoo.com",
                "Referer": "https://finance.yahoo.com/",
            },
            params={"interval": "1d", "events": "history", "range": range_value},
            timeout=10,
        )
        response.raise_for_status()
        payload = response.json()
        result = (payload.get("chart", {}).get("result") or [None])[0]
        if not result:
            return []

        timestamps = result.get("timestamp") or []
        quote = (result.get("indicators", {}).get("quote") or [{}])[0]
        opens = quote.get("open") or []
        highs = quote.get("high") or []
        lows = quote.get("low") or []
        closes = quote.get("close") or []
        volumes = quote.get("volume") or []

        rows: List[StockOHLCV] = []
        for idx, ts in enumerate(timestamps):
            close = closes[idx] if idx < len(closes) else None
            if close is None:
                continue
            rows.append(
                StockOHLCV(
                    date=datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
                    open=float((opens[idx] if idx < len(opens) else close) or close),
                    high=float((highs[idx] if idx < len(highs) else close) or close),
                    low=float((lows[idx] if idx < len(lows) else close) or close),
                    close=float(close),
                    volume=int((volumes[idx] if idx < len(volumes) else 0) or 0),
                )
            )
        self._save_ohlcv_rows(ticker, rows)
        return rows

    def _fetch_live_ohlcv(self, ticker: str, period: str = "1y") -> List[StockOHLCV]:
        """Fetch from yfinance first; fall back to Yahoo chart API."""
        try:
            import yfinance as yf

            df = yf.Ticker(ticker).history(period=period)
            if df.empty:
                raise ValueError("empty yfinance history")
            df.reset_index(inplace=True)
            df = self._normalise_date(df)

            rows = [
                StockOHLCV(
                    date=str(row.get("Date", "")),
                    open=float(row.get("Open", 0) or 0),
                    high=float(row.get("High", 0) or 0),
                    low=float(row.get("Low", 0) or 0),
                    close=float(row.get("Close", 0) or 0),
                    volume=int(row.get("Volume", 0) or 0),
                    dividends=float(row.get("Dividends", 0) or 0),
                    stock_splits=float(row.get("Stock Splits", 0) or 0),
                )
                for _, row in df.iterrows()
            ]
            self._save_ohlcv_rows(ticker, rows)
            logger.info("Fetched and cached %d bars for %s", len(rows), ticker)
            return rows
        except Exception as exc:
            logger.warning("yfinance fetch failed for %s: %s", ticker, exc)
            try:
                rows = self._fetch_yahoo_chart_ohlcv(ticker, period)
                if rows:
                    logger.info("Fetched %d Yahoo chart bars for %s", len(rows), ticker)
                return rows
            except Exception as yahoo_exc:
                logger.warning("Yahoo chart fetch failed for %s: %s", ticker, yahoo_exc)
                return []

    def get_stock_ohlcv(
        self,
        ticker: str,
        period: str = "1y",
        table: str = "stocks",
    ) -> List[StockOHLCV]:
        """Read OHLCV from SQLite and refresh live data if locally stale."""
        ticker = ticker.upper()
        period_days = {
            "1w": 7,
            "1mo": 30,
            "3mo": 90,
            "6mo": 180,
            "1y": 365,
            "2y": 730,
            "5y": 1825,
        }.get(period, 365)

        with get_db() as conn:
            tickers = self._query_tickers(ticker, table)
            placeholders = ",".join("?" for _ in tickers)
            rows = conn.execute(
                f"""SELECT * FROM {table}
                    WHERE ticker IN ({placeholders})
                    ORDER BY date DESC
                    LIMIT ?""",
                (*tickers, period_days),
            ).fetchall()

        if not rows:
            logger.info("OHLCV cache miss for %s; fetching live data", ticker)
            return self._fetch_live_ohlcv(ticker, period)

        if not self._rows_are_fresh(rows):
            latest = self._latest_row_date(rows)
            logger.info(
                "OHLCV data for %s is stale at %s; refreshing live data",
                ticker,
                latest.isoformat() if latest else "unknown",
            )
            live_rows = self._fetch_live_ohlcv(ticker, period)
            if live_rows:
                return live_rows[-period_days:]

        return list(reversed(self._rows_to_ohlcv(rows)))

    def get_all_indices(self) -> List[IndexQuote]:
        """Return summary card for every market index."""
        quotes: List[IndexQuote] = []
        for name, ticker in MARKET_INDICES.items():
            bars = self.get_stock_ohlcv(ticker, period="1y", table="indices")
            if len(bars) < 2:
                bars = self._fetch_live_ohlcv(ticker, "1y")
            if not bars:
                continue

            last = bars[-1].close
            prev = bars[-2].close if len(bars) >= 2 else last
            delta = DeltaBadge.compute(last, prev)
            sparkline = [b.close for b in bars[-30:]]

            quotes.append(
                IndexQuote(
                    name=name,
                    ticker=ticker,
                    last_close=last,
                    delta=delta,
                    sparkline=sparkline,
                )
            )
        return quotes

    def get_sparkline(self, ticker: str, days: int = 30) -> List[float]:
        bars = self.get_stock_ohlcv(ticker)
        return [b.close for b in bars[-days:]]
