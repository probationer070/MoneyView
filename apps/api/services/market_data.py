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

import numpy as np
import pandas as pd
import requests

# Allow importing from project root for API package execution.
_ROOT = Path(__file__).resolve().parents[3]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from apps.api.models.schemas import DeltaBadge, IndexQuote, MarketDataQuality, MarketIndexDetail, MarketRegimeContext, MarketVolumeSummary, StockOHLCV, TechnicalIndicators
from apps.api.services.db import get_db

logger = logging.getLogger(__name__)

DEFAULT_OHLCV_PERIOD = "5y"
DEFAULT_OHLCV_DAYS = 1825

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
            last_updated=datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
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
        period_days = {
            "1w": 7,
            "1mo": 30,
            "3mo": 90,
            "6mo": 180,
            "1y": 365,
            "2y": 730,
            "5y": 1825,
        }.get(period, DEFAULT_OHLCV_DAYS)

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
            live_rows = self._fetch_live_ohlcv(ticker, period)
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
        rows_cover_period = self._rows_cover_period(rows, period_days)
        cached_rows = list(reversed(self._rows_to_ohlcv(rows)))
        latest_cached_date = cached_rows[-1].date if cached_rows else None
        if not rows_fresh or not rows_cover_period:
            latest = self._latest_row_date(rows)
            oldest = self._oldest_row_date(rows)
            logger.info(
                "OHLCV data for %s needs refresh; latest=%s oldest=%s requested_period=%s",
                ticker,
                latest.isoformat() if latest else "unknown",
                oldest.isoformat() if oldest else "unknown",
                period,
            )
            live_rows = self._fetch_live_ohlcv(ticker, period)
            if live_rows:
                live_rows = live_rows[-period_days:]
                latest_live_date = live_rows[-1].date if live_rows else latest_cached_date
                return live_rows, self._build_data_quality(
                    source="live_refresh",
                    freshness_status="live_refresh",
                    requested_period=period,
                    latest_trading_date=latest_live_date,
                    used_live_refresh=True,
                    used_stale_cache_fallback=False,
                    detail_note="Local cache was incomplete or stale, so the service refreshed this detail payload from the live provider.",
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

    def _rows_cover_period(self, rows, period_days: int) -> bool:
        latest = self._latest_row_date(rows)
        oldest = self._oldest_row_date(rows)
        if latest is None or oldest is None:
            return False
        required_span_days = int(period_days * 0.9)
        return (latest - oldest).days >= required_span_days

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
