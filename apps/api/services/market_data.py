"""
Market data service for local SQLite plus live Yahoo Finance refresh.

Reads from SQLite first for speed, but refreshes from yfinance/Yahoo Chart API
when the newest stored bar is older than the previous trading day.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time
from dataclasses import dataclass
from json import JSONDecodeError
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List

import numpy as np
import pandas as pd
import requests
from cachetools import TTLCache

# Allow importing from project root for API package execution.
_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from apps.api.core.dev_monitor import emit_cache_event, perf_timer
from apps.api.models.schemas import DeltaBadge, IndexQuote, MarketDataQuality, MarketIndexDetail, MarketRegimeContext, MarketVolumeSummary, StockOHLCV, StockPriceLookup, TechnicalIndicators
from apps.api.services.db import get_db

logger = logging.getLogger(__name__)

YAHOO_PROVIDER_ERRORS = (
    requests.RequestException,
    ValueError,
    KeyError,
    IndexError,
    TypeError,
    JSONDecodeError,
)

DEFAULT_OHLCV_PERIOD = "5y"
DEFAULT_OHLCV_DAYS = 1825
PROVIDER_FETCH_CACHE_TTL_SECONDS = int(os.getenv("MONEYVIEW_LIVE_FETCH_CACHE_TTL_SECONDS", "30"))
PROVIDER_FETCH_CACHE_MAXSIZE = int(os.getenv("MONEYVIEW_LIVE_FETCH_CACHE_MAXSIZE", "96"))


@dataclass(frozen=True)
class MarketDataFreshnessRule:
    """Explicit cache coverage rule for a requested OHLCV period."""

    period: str
    days: int
    minimum_coverage_ratio: float = 0.9

    @property
    def minimum_span_days(self) -> int:
        return int(self.days * self.minimum_coverage_ratio)


OHLCV_FRESHNESS_RULES = {
    "1w": MarketDataFreshnessRule("1w", 7),
    "1mo": MarketDataFreshnessRule("1mo", 30),
    "3mo": MarketDataFreshnessRule("3mo", 90),
    "6mo": MarketDataFreshnessRule("6mo", 180),
    "1y": MarketDataFreshnessRule("1y", 365),
    "2y": MarketDataFreshnessRule("2y", 730),
    "5y": MarketDataFreshnessRule("5y", DEFAULT_OHLCV_DAYS),
}

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

INSTRUMENT_METADATA = {
    "^GSPC": {"instrument_type": "index", "unit_label": "index points"},
    "^DJI": {"instrument_type": "index", "unit_label": "index points"},
    "^IXIC": {"instrument_type": "index", "unit_label": "index points"},
    "^KS200": {"instrument_type": "index", "unit_label": "index points"},
    "GC=F": {"instrument_type": "commodity", "unit_label": "USD per ounce"},
    "CL=F": {"instrument_type": "commodity", "unit_label": "USD per barrel"},
    "NG=F": {"instrument_type": "commodity", "unit_label": "USD per MMBtu"},
    "KRW=X": {"instrument_type": "fx", "base_asset": "USD", "quote_asset": "KRW", "unit_label": "KRW per USD"},
    "BTC-USD": {"instrument_type": "crypto", "base_asset": "BTC", "quote_asset": "USD", "unit_label": "USD per BTC"},
}

EQUITY_INDEX_TICKERS = ("^GSPC", "^DJI", "^IXIC", "^KS200")

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

    _refresh_lock = threading.Lock()
    _inflight_refreshes: set[str] = set()
    _refresh_failures: dict[str, dict[str, str]] = {}
    _provider_fetch_cache = TTLCache(maxsize=PROVIDER_FETCH_CACHE_MAXSIZE, ttl=PROVIDER_FETCH_CACHE_TTL_SECONDS)

    @staticmethod
    def _freshness_rule(period: str) -> MarketDataFreshnessRule:
        return OHLCV_FRESHNESS_RULES.get(period, OHLCV_FRESHNESS_RULES[DEFAULT_OHLCV_PERIOD])

    @classmethod
    def _copy_bars(cls, rows: List[StockOHLCV]) -> List[StockOHLCV]:
        return [StockOHLCV(**row.model_dump()) for row in rows]

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
    def _aggregate_monthly_bars(bars: List[StockOHLCV]) -> List[StockOHLCV]:
        monthly: dict[str, StockOHLCV] = {}
        for bar in sorted(bars, key=lambda item: item.date):
            month_key = bar.date[:7]
            existing = monthly.get(month_key)
            if existing is None:
                monthly[month_key] = StockOHLCV(**bar.model_dump())
                continue
            existing.high = max(existing.high, bar.high)
            existing.low = min(existing.low, bar.low)
            existing.close = bar.close
            existing.volume += bar.volume
        return list(monthly.values())

    @staticmethod
    def _sma(closes: np.ndarray, period: int) -> float | None:
        if len(closes) < period:
            return None
        return round(float(closes[-period:].mean()), 4)

    @staticmethod
    def _ema(closes: np.ndarray, span: int) -> np.ndarray:
        alpha = 2.0 / (span + 1)
        result = np.empty_like(closes, dtype=float)
        result[0] = closes[0]
        for index in range(1, len(closes)):
            result[index] = alpha * closes[index] + (1 - alpha) * result[index - 1]
        return result

    @staticmethod
    def _rsi(closes: np.ndarray, period: int = 14) -> float | None:
        if len(closes) < period + 1:
            return None
        delta = np.diff(closes)
        gains = np.where(delta > 0, delta, 0.0)
        losses = np.where(delta < 0, -delta, 0.0)
        avg_gain = gains[-period:].mean()
        avg_loss = losses[-period:].mean()
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100 - (100 / (1 + rs)), 2)

    @classmethod
    def _macd(cls, closes: np.ndarray) -> tuple[float | None, float | None, float | None]:
        if len(closes) < 26:
            return None, None, None
        ema12 = cls._ema(closes, 12)
        ema26 = cls._ema(closes, 26)
        line = ema12 - ema26
        signal = cls._ema(line, 9)
        histogram = line - signal
        return round(float(line[-1]), 4), round(float(signal[-1]), 4), round(float(histogram[-1]), 4)

    @staticmethod
    def _bollinger(closes: np.ndarray, period: int = 20) -> tuple[float | None, float | None, float | None]:
        if len(closes) < period:
            return None, None, None
        window = closes[-period:]
        middle = window.mean()
        std = window.std()
        return round(float(middle + 2 * std), 4), round(float(middle), 4), round(float(middle - 2 * std), 4)

    @classmethod
    def _compute_technicals(cls, ticker: str, bars: List[StockOHLCV]) -> TechnicalIndicators:
        if not bars:
            return TechnicalIndicators(ticker=ticker)
        closes = np.array([bar.close for bar in bars], dtype=float)
        macd, macd_signal, macd_hist = cls._macd(closes)
        bb_upper, bb_mid, bb_lower = cls._bollinger(closes)
        return TechnicalIndicators(
            ticker=ticker,
            rsi_14=cls._rsi(closes),
            macd=macd,
            macd_signal=macd_signal,
            macd_hist=macd_hist,
            bb_upper=bb_upper,
            bb_mid=bb_mid,
            bb_lower=bb_lower,
            ma_20=cls._sma(closes, 20),
            ma_50=cls._sma(closes, 50),
            ma_200=cls._sma(closes, 200),
            as_of_date=bars[-1].date,
        )

    @staticmethod
    def _compute_volume_summary(bars: List[StockOHLCV]) -> MarketVolumeSummary:
        if not bars:
            return MarketVolumeSummary()
        latest = bars[-1]
        trailing_20 = [bar.volume for bar in bars[-20:]]
        trailing_60 = [bar.volume for bar in bars[-60:]]
        avg_20 = float(np.mean(trailing_20)) if trailing_20 else None
        avg_60 = float(np.mean(trailing_60)) if trailing_60 else None
        volume_vs_20d = None
        if avg_20 and avg_20 > 0:
            volume_vs_20d = round(((latest.volume - avg_20) / avg_20) * 100, 2)
        return MarketVolumeSummary(
            latest_volume=latest.volume,
            average_20d_volume=round(avg_20, 2) if avg_20 is not None else None,
            average_60d_volume=round(avg_60, 2) if avg_60 is not None else None,
            volume_vs_20d_pct=volume_vs_20d,
            as_of_date=latest.date,
        )

    @staticmethod
    def _build_data_quality(
        *,
        source: str,
        freshness_status: str,
        requested_period: str,
        latest_trading_date: str | None,
        used_live_refresh: bool,
        used_stale_cache_fallback: bool,
        detail_note: str,
    ) -> MarketDataQuality:
        return MarketDataQuality(
            source=source,
            freshness_status=freshness_status,
            used_live_refresh=used_live_refresh,
            used_stale_cache_fallback=used_stale_cache_fallback,
            requested_period=requested_period,
            last_updated=datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            latest_trading_date=latest_trading_date,
            detail_note=detail_note,
        )

    def _get_stock_ohlcv_with_metadata(
        self,
        ticker: str,
        period: str = DEFAULT_OHLCV_PERIOD,
        table: str = "stocks",
    ) -> tuple[List[StockOHLCV], MarketDataQuality]:
        ticker = ticker.upper()
        freshness_rule = self._freshness_rule(period)
        emit_cache_event(
            operation="cache.lookup",
            status="success",
            ticker=ticker,
            component="market_data.ohlcv",
            metadata={"table": table, "requested_period": period, "source": "sqlite"},
        )

        with get_db() as conn:
            rows = self._select_ohlcv_rows(conn, ticker, table, freshness_rule.days)

        if not rows:
            emit_cache_event(
                operation="cache.miss",
                status="cache_miss",
                ticker=ticker,
                component="market_data.ohlcv",
                metadata={"table": table, "requested_period": period, "source": "sqlite"},
                message="No cached OHLCV rows were available.",
            )
            logger.info("OHLCV cache miss for %s; fetching live data", ticker)
            live_rows = self._fill_ohlcv_cache(ticker, period=period, table=table, reason="miss")
            latest_date = live_rows[-1].date if live_rows else None
            return live_rows, self._build_data_quality(
                source="live_fetch",
                freshness_status="live_refresh",
                requested_period=period,
                latest_trading_date=latest_date,
                used_live_refresh=True,
                used_stale_cache_fallback=False,
                detail_note="Cache miss; the service fetched live data for this detail request.",
            )

        rows_fresh = self._rows_are_fresh(rows)
        rows_cover_period = self._rows_cover_period(rows, freshness_rule)
        cached_rows = list(reversed(self._rows_to_ohlcv(rows)))
        latest_cached_date = cached_rows[-1].date if cached_rows else None
        if not rows_fresh or not rows_cover_period:
            emit_cache_event(
                operation="cache.stale",
                status="warning",
                ticker=ticker,
                component="market_data.ohlcv",
                metadata={
                    "table": table,
                    "requested_period": period,
                    "source": "sqlite",
                    "latest_cached_date": latest_cached_date,
                    "rows_fresh": rows_fresh,
                    "rows_cover_period": rows_cover_period,
                },
                message="Cached OHLCV rows were stale or incomplete.",
            )
            latest = self._latest_row_date(rows)
            oldest = self._oldest_row_date(rows)
            logger.info(
                "OHLCV data for %s needs refresh; latest=%s oldest=%s requested_period=%s",
                ticker,
                latest.isoformat() if latest else "unknown",
                oldest.isoformat() if oldest else "unknown",
                period,
            )
            live_rows = self._fill_ohlcv_cache(ticker, period=period, table=table, reason="stale")
            if live_rows:
                live_rows = live_rows[-freshness_rule.days:]
                latest_live_date = live_rows[-1].date if live_rows else latest_cached_date
                emit_cache_event(
                    operation="cache.write",
                    status="success",
                    ticker=ticker,
                    component="market_data.ohlcv",
                    metadata={"table": table, "requested_period": period, "source": "live_refresh", "rows": len(live_rows)},
                )
                return live_rows, self._build_data_quality(
                    source="live_refresh",
                    freshness_status="live_refresh",
                    requested_period=period,
                    latest_trading_date=latest_live_date,
                    used_live_refresh=True,
                    used_stale_cache_fallback=False,
                    detail_note="Local cache was incomplete or stale, so the service refreshed this detail payload from the live provider.",
                )
            emit_cache_event(
                operation="cache.fallback",
                status="warning",
                ticker=ticker,
                component="market_data.ohlcv",
                metadata={"table": table, "requested_period": period, "source": "cache_fallback", "fallback_used": True},
                message="Live refresh failed; stale cached OHLCV rows were returned.",
            )
            return cached_rows, self._build_data_quality(
                source="cache_fallback",
                freshness_status="stale_cache",
                requested_period=period,
                latest_trading_date=latest_cached_date,
                used_live_refresh=False,
                used_stale_cache_fallback=True,
                detail_note="Live refresh was unavailable, so this detail payload fell back to the latest cached history.",
            )

        emit_cache_event(
            operation="cache.hit",
            status="cache_hit",
            ticker=ticker,
            component="market_data.ohlcv",
            metadata={
                "table": table,
                "requested_period": period,
                "source": "sqlite",
                "rows": len(cached_rows),
                "latest_cached_date": latest_cached_date,
            },
        )
        return cached_rows, self._build_data_quality(
            source="cache",
            freshness_status="fresh_cache",
            requested_period=period,
            latest_trading_date=latest_cached_date,
            used_live_refresh=False,
            used_stale_cache_fallback=False,
            detail_note="This detail payload was served from local cached history that passed freshness and coverage checks.",
        )

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

    @staticmethod
    def _oldest_row_date(rows) -> date | None:
        for row in reversed(rows):
            raw = str(row["date"])[:10]
            try:
                return datetime.strptime(raw, "%Y-%m-%d").date()
            except ValueError:
                continue
        return None

    def _rows_are_fresh(self, rows) -> bool:
        latest = self._latest_row_date(rows)
        return latest is not None and latest >= self._previous_trading_day()

    def _rows_cover_period(self, rows, period: int | MarketDataFreshnessRule) -> bool:
        latest = self._latest_row_date(rows)
        oldest = self._oldest_row_date(rows)
        if latest is None or oldest is None:
            return False
        freshness_rule = MarketDataFreshnessRule("custom", period) if isinstance(period, int) else period
        return (latest - oldest).days >= freshness_rule.minimum_span_days

    def _fill_ohlcv_cache(self, ticker: str, *, period: str, table: str, reason: str):
        """Fetch live rows to fill the cache, emitting the fill's duration.

        The `cache.miss` / `cache.stale` events are emitted when the miss is *detected*,
        so they can never carry the cost of the fetch they trigger -- which is exactly
        the cost each later hit avoids. Without this span `avg_miss_cost_ms` and
        `estimated_time_saved_ms` are structurally 0.0 and the cache's value is
        unmeasurable.
        """
        # perf_timer, not an emit afterwards: it establishes span context for the body,
        # so the external fetch nests *beneath* this span. Emitting after the fetch made
        # cache.populate a sibling of the work it timed, and both self-times then counted
        # in full -- 2791 ms twice against a 3446 ms request, which tripped
        # overlap_detected and made criterion 2 uncomputable.
        with perf_timer(
            scope="cache",
            operation="cache.populate",
            ticker=ticker,
            component="market_data.ohlcv",
            metadata={"table": table, "requested_period": period, "reason": reason},
        ):
            return self._fetch_live_ohlcv_cached(ticker, period=period, table=table)

    def _select_ohlcv_rows(self, conn, ticker: str, table: str, limit: int):
        """Read the most recent `limit` bars, canonical ticker first.

        `ORDER BY date DESC` is satisfiable directly from idx_<table>_ticker_date only
        when the IN clause holds a single value; with several values SQLite must add
        "USE TEMP B-TREE FOR ORDER BY", measured at 8.9ms/call against 0.2ms for the
        single-value form. Index aliases match no rows in current databases, so paying
        that sort on every index read bought nothing. Aliases are therefore retried
        only when the canonical ticker comes back empty, which keeps older databases
        that stored display names ("S&P 500") as the ticker working.
        """

        def _query(values: List[str]):
            placeholders = ",".join("?" for _ in values)
            return conn.execute(
                f"""SELECT * FROM {table}
                    WHERE ticker IN ({placeholders})
                    ORDER BY date DESC
                    LIMIT ?""",
                (*values, limit),
            ).fetchall()

        rows = _query([ticker])
        if rows:
            return rows
        aliases = [alias for alias in self._query_tickers(ticker, table) if alias != ticker]
        return _query(aliases) if aliases else rows

    @staticmethod
    def _query_tickers(ticker: str, table: str) -> List[str]:
        if table != "indices":
            return [ticker]
        aliases = INDEX_DB_ALIASES.get(ticker, [ticker])
        return list(dict.fromkeys(aliases))

    @staticmethod
    def _table_for_ticker(ticker: str) -> str:
        return "indices" if ticker.upper() in MARKET_INDICES.values() else "stocks"

    @classmethod
    def _refresh_key(cls, ticker: str, period: str, table: str) -> str:
        return f"{table}:{ticker.upper()}:{period}"

    def _read_cached_rows(
        self,
        ticker: str,
        *,
        period: str = DEFAULT_OHLCV_PERIOD,
        table: str = "stocks",
    ):
        freshness_rule = self._freshness_rule(period)
        with get_db() as conn:
            return self._select_ohlcv_rows(conn, ticker.upper(), table, freshness_rule.days)

    def _fetch_live_ohlcv_with_retry(
        self,
        ticker: str,
        *,
        period: str = DEFAULT_OHLCV_PERIOD,
        attempts: int | None = None,
        base_backoff_seconds: float | None = None,
    ) -> List[StockOHLCV]:
        max_attempts = attempts or max(1, int(os.getenv("MONEYVIEW_PRICE_FETCH_RETRIES", "3")))
        backoff_seconds = base_backoff_seconds or float(os.getenv("MONEYVIEW_PRICE_FETCH_BACKOFF_SECONDS", "0.5"))
        last_rows: List[StockOHLCV] = []
        for attempt in range(1, max_attempts + 1):
            with perf_timer(
                scope="external",
                operation="external.fetch_history_retry",
                ticker=ticker.upper(),
                provider="yfinance",
                component="market_data",
                metadata={"requested_period": period, "retry_count": attempt - 1, "max_attempts": max_attempts},
            ) as metadata:
                last_rows = self._fetch_live_ohlcv_cached(ticker, period=period, table=self._table_for_ticker(ticker))
                metadata["rows"] = len(last_rows)
            if last_rows:
                if attempt > 1:
                    logger.info("Recovered live OHLCV fetch for %s on retry %d", ticker, attempt)
                return last_rows
            if attempt < max_attempts:
                sleep_seconds = backoff_seconds * (2 ** (attempt - 1))
                logger.warning(
                    "Live OHLCV fetch retry scheduled for %s after failed attempt %d/%d; sleeping %.2fs",
                    ticker,
                    attempt,
                    max_attempts,
                    sleep_seconds,
                )
                time.sleep(sleep_seconds)
        return last_rows

    def _fetch_live_ohlcv_cached(
        self,
        ticker: str,
        *,
        period: str = DEFAULT_OHLCV_PERIOD,
        table: str | None = None,
    ) -> List[StockOHLCV]:
        normalized_ticker = ticker.upper()
        resolved_table = table or self._table_for_ticker(normalized_ticker)
        key = self._refresh_key(normalized_ticker, period, resolved_table)
        now = datetime.now(timezone.utc)

        with self._refresh_lock:
            cached = self._provider_fetch_cache.get(key)
            if cached is not None:
                fetched_at, rows = cached
                age_seconds = (now - fetched_at).total_seconds()
                if age_seconds < PROVIDER_FETCH_CACHE_TTL_SECONDS:
                    emit_cache_event(
                        operation="cache.hit",
                        status="cache_hit",
                        ticker=normalized_ticker,
                        provider="yfinance",
                        component="market_data.provider_cache",
                        metadata={
                            "table": resolved_table,
                            "requested_period": period,
                            "source": "provider_ttl_cache",
                            "cache_age_seconds": round(age_seconds, 2),
                            "ttl_seconds": PROVIDER_FETCH_CACHE_TTL_SECONDS,
                            "rows": len(rows),
                        },
                    )
                    logger.info(
                        "OHLCV provider cache hit for %s period=%s age_seconds=%.2f",
                        normalized_ticker,
                        period,
                        age_seconds,
                    )
                    return self._copy_bars(rows)
                emit_cache_event(
                    operation="cache.stale",
                    status="warning",
                    ticker=normalized_ticker,
                    provider="yfinance",
                    component="market_data.provider_cache",
                    metadata={
                        "table": resolved_table,
                        "requested_period": period,
                        "source": "provider_ttl_cache",
                        "cache_age_seconds": round(age_seconds, 2),
                        "ttl_seconds": PROVIDER_FETCH_CACHE_TTL_SECONDS,
                        "rows": len(rows),
                    },
                    message="Provider TTL cache entry expired and will be refreshed.",
                )
                self._provider_fetch_cache.pop(key, None)
            else:
                emit_cache_event(
                    operation="cache.miss",
                    status="cache_miss",
                    ticker=normalized_ticker,
                    provider="yfinance",
                    component="market_data.provider_cache",
                    metadata={
                        "table": resolved_table,
                        "requested_period": period,
                        "source": "provider_ttl_cache",
                        "ttl_seconds": PROVIDER_FETCH_CACHE_TTL_SECONDS,
                    },
                )

        with perf_timer(
            scope="external",
            operation="external.fetch_history",
            ticker=normalized_ticker,
            provider="yfinance",
            component="market_data",
            metadata={"requested_period": period, "table": resolved_table, "retry_count": 0},
        ) as metadata:
            rows = self._fetch_live_ohlcv(normalized_ticker, period)
            metadata["rows"] = len(rows)
        if rows:
            with self._refresh_lock:
                self._provider_fetch_cache[key] = (now, self._copy_bars(rows))
            emit_cache_event(
                operation="cache.write",
                status="success",
                ticker=normalized_ticker,
                provider="yfinance",
                component="market_data.provider_cache",
                metadata={
                    "table": resolved_table,
                    "requested_period": period,
                    "source": "provider_ttl_cache",
                    "ttl_seconds": PROVIDER_FETCH_CACHE_TTL_SECONDS,
                    "rows": len(rows),
                },
            )
        return rows

    def _refresh_ohlcv_in_background(
        self,
        ticker: str,
        *,
        period: str = DEFAULT_OHLCV_PERIOD,
        table: str = "stocks",
    ) -> None:
        key = self._refresh_key(ticker, period, table)

        def runner() -> None:
            try:
                rows = self._fetch_live_ohlcv_with_retry(ticker, period=period)
                if rows:
                    logger.info("Completed background OHLCV hydration for %s with %d bars", ticker, len(rows))
                    with self._refresh_lock:
                        self._refresh_failures.pop(key, None)
                    return
                logger.warning("Background OHLCV hydration failed for %s after all retries", ticker)
                with self._refresh_lock:
                    self._refresh_failures[key] = {
                        "failed_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                        "detail_note": "Live provider fetch failed after all retries for this cold cache miss.",
                    }
            finally:
                with self._refresh_lock:
                    self._inflight_refreshes.discard(key)

        with self._refresh_lock:
            if key in self._inflight_refreshes:
                return
            self._inflight_refreshes.add(key)
        threading.Thread(
            target=runner,
            name=f"moneyview-ohlcv-refresh-{ticker.lower()}",
            daemon=True,
        ).start()

    def prewarm_configured_tickers(self, *, period: str = "1mo") -> list[str]:
        raw_tickers = os.getenv("MONEYVIEW_PREWARM_TICKERS", "")
        unique_tickers = list(dict.fromkeys(ticker.strip().upper() for ticker in raw_tickers.split(",") if ticker.strip()))
        for ticker in unique_tickers:
            self._refresh_ohlcv_in_background(
                ticker,
                period=period,
                table=self._table_for_ticker(ticker),
            )
        if unique_tickers:
            logger.info("Scheduled startup stock prewarm for tickers: %s", ", ".join(unique_tickers))
        return unique_tickers

    def get_stock_price_lookup(
        self,
        ticker: str,
        *,
        period: str = "1mo",
    ) -> StockPriceLookup:
        normalized_ticker = ticker.upper().strip()
        table = self._table_for_ticker(normalized_ticker)
        rows = self._read_cached_rows(normalized_ticker, period=period, table=table)
        key = self._refresh_key(normalized_ticker, period, table)

        if rows:
            cached_rows = list(reversed(self._rows_to_ohlcv(rows)))
            latest_bar = cached_rows[-1]
            rows_fresh = self._rows_are_fresh(rows)
            if not rows_fresh:
                logger.info("Price lookup served stale cache for %s and scheduled background refresh", normalized_ticker)
                self._refresh_ohlcv_in_background(normalized_ticker, period=period, table=table)
            return StockPriceLookup(
                ticker=normalized_ticker,
                status="ok",
                price=latest_bar.close,
                as_of_date=latest_bar.date,
                source="cache" if rows_fresh else "cache_fallback",
                freshness_status="fresh_cache" if rows_fresh else "stale_cache",
                detail_note=(
                    "Latest price served from local cache."
                    if rows_fresh
                    else "Latest cached price served immediately while a background refresh is in progress."
                ),
            )

        logger.info("Price lookup cold miss for %s; no cached bars available", normalized_ticker)
        with self._refresh_lock:
            failure = self._refresh_failures.get(key)
            inflight = key in self._inflight_refreshes

        if failure and not inflight:
            return StockPriceLookup(
                ticker=normalized_ticker,
                status="not_found",
                source="live_fetch_failed",
                freshness_status="cache_miss",
                detail_note=failure["detail_note"],
            )

        self._refresh_ohlcv_in_background(normalized_ticker, period=period, table=table)

        return StockPriceLookup(
            ticker=normalized_ticker,
            status="fetching",
            source="cache_miss",
            freshness_status="cache_miss",
            retry_after_seconds=2,
            detail_note="No cached price was available, so a background fetch has been started.",
        )

    def get_latest_stock_price(self, ticker: str, *, period: str = "1mo") -> float:
        """Return the newest available quote, falling back to OHLCV close history."""
        normalized_ticker = ticker.upper().strip()
        if not normalized_ticker:
            return 0.0

        live_price = self._fetch_live_quote_price(normalized_ticker)
        if live_price is not None and live_price > 0:
            return float(live_price)

        table = self._table_for_ticker(normalized_ticker)
        bars = self.get_stock_ohlcv(normalized_ticker, period=period, table=table)
        if not bars:
            return 0.0
        return float(bars[-1].close)

    def get_latest_stored_price(self, ticker: str) -> float:
        """Return the newest locally stored close, without any network access.

        get_latest_stock_price above tries a live quote first and then falls back to
        get_stock_ohlcv, which itself refreshes from the provider when local bars are
        stale. Neither is usable beneath the metric layer: the architectural invariant is
        that metric computation reads only what acquisition already stored, so that a
        snapshot is reproducible and the same stored data always yields the same numbers.
        Reads the bars table directly for that reason -- 0.0 when nothing is stored, which
        the existing has_price_data handling already treats as a missing price.
        """
        normalized_ticker = ticker.upper().strip()
        if not normalized_ticker:
            return 0.0

        table = self._table_for_ticker(normalized_ticker)
        with get_db() as conn:
            rows = self._select_ohlcv_rows(conn, normalized_ticker, table, limit=1)
        if not rows:
            return 0.0
        return float(rows[0]["close"] or 0.0)

    def _fetch_live_quote_price(self, ticker: str) -> float | None:
        try:
            import yfinance as yf
        except ImportError as exc:
            logger.warning("yfinance import failed for latest quote %s: %s", ticker, exc)
        else:
            try:
                with perf_timer(
                    scope="external",
                    operation="external.fetch_quote",
                    ticker=ticker,
                    provider="yfinance",
                    component="market_data",
                    metadata={"cache_status": "unknown", "retry_count": 0, "missing_fields": []},
                ) as metadata:
                    fast_info = getattr(yf.Ticker(ticker), "fast_info", {}) or {}
                    missing_fields: list[str] = []
                    for key in ("last_price", "regular_market_price", "lastPrice", "regularMarketPrice"):
                        price = fast_info.get(key) if hasattr(fast_info, "get") else None
                        if price is not None and float(price) > 0:
                            metadata["matched_field"] = key
                            return float(price)
                        missing_fields.append(key)
                    metadata["missing_fields"] = missing_fields
            except YAHOO_PROVIDER_ERRORS as exc:
                logger.warning("yfinance latest quote fetch failed for %s: %s", ticker, exc)

        try:
            response = requests.get(
                f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Origin": "https://finance.yahoo.com",
                    "Referer": "https://finance.yahoo.com/",
                },
                params={"interval": "1d", "range": "1d"},
                timeout=10,
            )
            response.raise_for_status()
            payload = response.json()
            result = (payload.get("chart", {}).get("result") or [None])[0]
            meta = (result or {}).get("meta", {})
            for key in ("regularMarketPrice", "previousClose", "chartPreviousClose"):
                price = meta.get(key)
                if price is not None and float(price) > 0:
                    return float(price)
        except YAHOO_PROVIDER_ERRORS as exc:
            logger.warning("Yahoo chart latest quote fetch failed for %s: %s", ticker, exc)

        return None

    @staticmethod
    def _index_name_for_ticker(ticker: str) -> str:
        for name, yahoo_ticker in MARKET_INDICES.items():
            if ticker == yahoo_ticker or ticker in INDEX_DB_ALIASES.get(yahoo_ticker, []):
                return name
        return ticker

    @staticmethod
    def _instrument_metadata_for_ticker(ticker: str) -> dict[str, str]:
        return INSTRUMENT_METADATA.get(ticker, {"instrument_type": "index", "unit_label": "index points"})

    def _build_market_regime_context(self) -> MarketRegimeContext:
        latest_quotes: dict[str, IndexQuote] = {}
        for name, ticker in MARKET_INDICES.items():
            bars = self.get_stock_ohlcv(ticker, period="1mo", table="indices")
            if len(bars) < 2:
                continue
            last = bars[-1].close
            prev = bars[-2].close
            if last is None or prev is None:
                continue
            latest_quotes[ticker] = IndexQuote(
                name=name,
                ticker=ticker,
                instrument_type=self._instrument_metadata_for_ticker(ticker)["instrument_type"],
                last_close=last,
                delta=DeltaBadge.compute(last, prev),
                sparkline=[bar.close for bar in bars[-30:] if bar.close is not None],
            )

        equity_quotes = [latest_quotes[ticker] for ticker in EQUITY_INDEX_TICKERS if ticker in latest_quotes]
        equity_advancers = sum(1 for quote in equity_quotes if quote.delta.delta_pct > 0)
        equity_decliners = sum(1 for quote in equity_quotes if quote.delta.delta_pct < 0)
        breadth_ratio = round(equity_advancers / len(equity_quotes), 2) if equity_quotes else None

        risk_on_signals = 0
        risk_off_signals = 0

        def score_signal(condition: bool):
            nonlocal risk_on_signals, risk_off_signals
            if condition:
                risk_on_signals += 1
            else:
                risk_off_signals += 1

        if "^GSPC" in latest_quotes:
            score_signal(latest_quotes["^GSPC"].delta.delta_pct >= 0)
        if "^IXIC" in latest_quotes:
            score_signal(latest_quotes["^IXIC"].delta.delta_pct >= 0)
        if "GC=F" in latest_quotes:
            score_signal(latest_quotes["GC=F"].delta.delta_pct <= 0)
        if "KRW=X" in latest_quotes:
            score_signal(latest_quotes["KRW=X"].delta.delta_pct <= 0)
        if "BTC-USD" in latest_quotes:
            score_signal(latest_quotes["BTC-USD"].delta.delta_pct >= 0)

        signal_count = risk_on_signals + risk_off_signals
        if breadth_ratio is None or signal_count == 0:
            regime_label = "unknown"
            regime_summary = "Regime context is unavailable because there were not enough current market signals."
        elif breadth_ratio >= 0.75 and risk_on_signals >= risk_off_signals + 2:
            regime_label = "risk_on"
            regime_summary = "Most tracked equity indices are advancing and cross-asset signals lean toward pro-cyclical risk appetite."
        elif breadth_ratio <= 0.25 and risk_off_signals >= risk_on_signals + 2:
            regime_label = "risk_off"
            regime_summary = "Equity breadth is weak and cross-asset signals lean defensive, indicating a risk-off market regime."
        else:
            regime_label = "mixed"
            regime_summary = "Breadth and cross-asset signals are mixed, so the market backdrop is not giving a clean risk-on or risk-off read."

        return MarketRegimeContext(
            regime_label=regime_label,
            regime_summary=regime_summary,
            equity_advancers=equity_advancers,
            equity_decliners=equity_decliners,
            breadth_ratio=breadth_ratio,
            equity_index_count=len(equity_quotes),
            risk_on_signals=risk_on_signals,
            risk_off_signals=risk_off_signals,
            signal_count=signal_count,
        )

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

    def _fetch_yahoo_chart_ohlcv(self, ticker: str, period: str = DEFAULT_OHLCV_PERIOD) -> List[StockOHLCV]:
        """Direct Yahoo chart API fallback, mirroring GlobalMacroCollector."""
        range_value = {
            "1w": "7d",
            "1mo": "1mo",
            "3mo": "3mo",
            "6mo": "6mo",
            "1y": "1y",
            "2y": "2y",
            "5y": "5y",
        }.get(period, DEFAULT_OHLCV_PERIOD)
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

    def _fetch_live_ohlcv(self, ticker: str, period: str = DEFAULT_OHLCV_PERIOD) -> List[StockOHLCV]:
        """Fetch from yfinance first; fall back to Yahoo chart API."""
        try:
            import yfinance as yf
        except ImportError as exc:
            logger.warning("yfinance import failed for %s: %s", ticker, exc)
        else:
            try:
                df = yf.Ticker(ticker).history(period=period)
            except YAHOO_PROVIDER_ERRORS as exc:
                logger.warning("yfinance fetch failed for %s: %s", ticker, exc)
            else:
                if df.empty:
                    logger.warning("yfinance fetch returned no bars for %s", ticker)
                else:
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

        try:
            rows = self._fetch_yahoo_chart_ohlcv(ticker, period)
            if rows:
                logger.info("Fetched %d Yahoo chart bars for %s", len(rows), ticker)
            return rows
        except YAHOO_PROVIDER_ERRORS as yahoo_exc:
            logger.warning("Yahoo chart fetch failed for %s: %s", ticker, yahoo_exc)
            return []

    def get_stock_ohlcv(
        self,
        ticker: str,
        period: str = DEFAULT_OHLCV_PERIOD,
        table: str = "stocks",
    ) -> List[StockOHLCV]:
        """Read OHLCV from SQLite and refresh live data if locally stale."""
        bars, _ = self._get_stock_ohlcv_with_metadata(ticker, period=period, table=table)
        return bars

    def get_all_indices(self) -> List[IndexQuote]:
        """Return summary card for every market index."""
        quotes: List[IndexQuote] = []
        for name, ticker in MARKET_INDICES.items():
            bars = self.get_stock_ohlcv(ticker, period=DEFAULT_OHLCV_PERIOD, table="indices")
            if len(bars) < 2:
                bars = self._fetch_live_ohlcv(ticker, DEFAULT_OHLCV_PERIOD)
            if not bars:
                continue

            last = bars[-1].close
            if last is None:
                continue
            prev = bars[-2].close if len(bars) >= 2 and bars[-2].close is not None else last
            delta = DeltaBadge.compute(last, prev)
            sparkline = [b.close for b in bars[-30:] if b.close is not None]

            quotes.append(
                IndexQuote(
                    name=name,
                    ticker=ticker,
                    instrument_type=self._instrument_metadata_for_ticker(ticker)["instrument_type"],
                    last_close=last,
                    delta=delta,
                    sparkline=sparkline,
                )
            )
        return quotes

    def get_sparkline(self, ticker: str, days: int = 30) -> List[float]:
        bars = self.get_stock_ohlcv(ticker)
        return [b.close for b in bars[-days:]]

    def get_index_detail(self, ticker: str, period: str = DEFAULT_OHLCV_PERIOD) -> MarketIndexDetail:
        normalized_ticker = ticker.upper()
        daily_history, data_quality = self._get_stock_ohlcv_with_metadata(normalized_ticker, period=period, table="indices")
        monthly_history = self._aggregate_monthly_bars(daily_history)
        reverse_lookup = {value: key for key, value in MARKET_INDICES.items()}
        name = reverse_lookup.get(normalized_ticker, normalized_ticker)
        instrument_metadata = self._instrument_metadata_for_ticker(normalized_ticker)
        last_close = daily_history[-1].close if daily_history else None

        return MarketIndexDetail(
            name=name,
            ticker=normalized_ticker,
            instrument_type=instrument_metadata["instrument_type"],
            unit_label=instrument_metadata.get("unit_label"),
            base_asset=instrument_metadata.get("base_asset"),
            quote_asset=instrument_metadata.get("quote_asset"),
            period=period,
            as_of_date=daily_history[-1].date if daily_history else None,
            last_close=last_close,
            daily_history=daily_history,
            monthly_history=monthly_history,
            daily_indicators=self._compute_technicals(normalized_ticker, daily_history),
            monthly_indicators=self._compute_technicals(normalized_ticker, monthly_history),
            volume_summary=self._compute_volume_summary(daily_history),
            data_quality=data_quality,
            market_regime=self._build_market_regime_context() if instrument_metadata["instrument_type"] == "index" else None,
        )
