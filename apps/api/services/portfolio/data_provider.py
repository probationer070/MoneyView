from __future__ import annotations

from datetime import date
from hashlib import sha256
from typing import Dict, List

import numpy as np

from apps.api.core.dev_monitor import perf_timer
from apps.api.models.schemas import PeriodEnum
from apps.api.services.db import get_db
from apps.api.services.market_data import MARKET_INDICES, MarketDataService


PERIOD_TO_DAYS = {
    PeriodEnum.one_week: 7,
    PeriodEnum.one_month: 30,
    PeriodEnum.three_month: 90,
    PeriodEnum.six_month: 180,
    PeriodEnum.one_year: 365,
    PeriodEnum.two_year: 730,
    PeriodEnum.five_year: 1825,
}


class DataProvider:
    """Handles portfolio data access and deterministic fallback series."""

    def __init__(self, market_data: MarketDataService | None = None):
        self._market = market_data or MarketDataService()

    @staticmethod
    def _seed_from_key(key: str) -> int:
        return int(sha256(key.encode("utf-8")).hexdigest()[:16], 16) % (2**32)

    def synthetic_series(self, key: str, length: int = 260) -> np.ndarray:
        rng = np.random.default_rng(self._seed_from_key(key))
        return rng.normal(loc=0.0003, scale=0.012, size=length).astype(float)

    def _synthetic_or_raise(self, ticker: str, reason: str, allow_synthetic_fallback: bool, key: str, length: int) -> np.ndarray:
        if not allow_synthetic_fallback:
            raise ValueError(
                f"Missing usable price data for {ticker}: {reason}. "
                "Provide data or set allow_synthetic_fallback=true for demo/test scenarios."
            )
        return self.synthetic_series(key, length=length)

    @staticmethod
    def table_for_ticker(ticker: str) -> str:
        return "indices" if ticker in MARKET_INDICES.values() else "stocks"

    def load_close_series(
        self,
        ticker: str,
        period: PeriodEnum,
        date_from: date | None = None,
        as_of_date: date | None = None,
    ) -> np.ndarray:
        with perf_timer(scope="db", operation="ticker.series", ticker=ticker) as span_metadata:
            limit = PERIOD_TO_DAYS.get(period, PERIOD_TO_DAYS[PeriodEnum.five_year])
            table = self.table_for_ticker(ticker)
            where_clause = "WHERE ticker = ?"
            params: list = [ticker]
            if date_from is not None:
                where_clause += " AND date >= ?"
                params.append(date_from.isoformat())
            if as_of_date is not None:
                where_clause += " AND date <= ?"
                params.append(as_of_date.isoformat())
            params.append(limit)

            with get_db() as conn:
                rows = conn.execute(
                    f"""SELECT date, close FROM {table}
                        {where_clause}
                        ORDER BY date DESC
                        LIMIT ?""",
                    tuple(params),
                ).fetchall()

            if not rows:
                series = np.array([], dtype=float)
            else:
                closes = [float(row["close"] or 0.0) for row in reversed(rows)]
                series = np.array(closes, dtype=float)

            span_metadata["series_points"] = int(series.size)
            span_metadata["bytes"] = int(series.nbytes)
            return series

    def scalar_return(
        self,
        ticker: str,
        period: PeriodEnum,
        date_from: date | None = None,
        as_of_date: date | None = None,
        allow_synthetic_fallback: bool = False,
    ) -> tuple[float, bool]:
        if ticker == "CASH":
            return 0.0, False

        prices = self.load_close_series(ticker, period, date_from=date_from, as_of_date=as_of_date)
        if len(prices) < 2:
            synthetic = self._synthetic_or_raise(
                ticker,
                "fewer than two close prices",
                allow_synthetic_fallback,
                f"scalar:{ticker}:{period.value}:{date_from or ''}:{as_of_date or ''}",
                20,
            )
            return float(np.sum(synthetic)), True

        start = float(prices[0])
        end = float(prices[-1])
        if start <= 0 or end <= 0:
            synthetic = self._synthetic_or_raise(
                ticker,
                "non-positive close prices",
                allow_synthetic_fallback,
                f"scalar:{ticker}:{period.value}:{date_from or ''}:{as_of_date or ''}",
                20,
            )
            return float(np.sum(synthetic)), True
        return float((end / start) - 1.0), False

    def return_series(
        self,
        ticker: str,
        period: PeriodEnum,
        min_len: int,
        date_from: date | None = None,
        as_of_date: date | None = None,
        allow_synthetic_fallback: bool = False,
    ) -> tuple[np.ndarray, bool]:
        if ticker == "CASH":
            return np.zeros(min_len, dtype=float), False

        prices = self.load_close_series(ticker, period, date_from=date_from, as_of_date=as_of_date)
        if len(prices) < 3:
            synthetic = self._synthetic_or_raise(
                ticker,
                "fewer than three close prices",
                allow_synthetic_fallback,
                f"series:{ticker}:{period.value}:{date_from or ''}:{as_of_date or ''}",
                min_len,
            )
            return synthetic, True
        if np.any(prices <= 0):
            synthetic = self._synthetic_or_raise(
                ticker,
                "non-positive close prices",
                allow_synthetic_fallback,
                f"series:{ticker}:{period.value}:{date_from or ''}:{as_of_date or ''}",
                min_len,
            )
            return synthetic, True

        returns = np.diff(prices) / prices[:-1]
        if len(returns) < min_len:
            synthetic = self._synthetic_or_raise(
                ticker,
                f"fewer than {min_len} return observations",
                allow_synthetic_fallback,
                f"series:{ticker}:{period.value}:{date_from or ''}:{as_of_date or ''}",
                min_len,
            )
            return synthetic, True
        return returns[-min_len:], False

    def sector_map(self, tickers: List[str]) -> Dict[str, str]:
        if not tickers:
            return {}

        query_tickers = [t for t in tickers if t != "CASH"]
        sector_map = {ticker: "UNCLASSIFIED" for ticker in tickers}
        sector_map["CASH"] = "CASH"

        if not query_tickers:
            return sector_map

        placeholders = ",".join("?" for _ in query_tickers)
        sql = f"SELECT ticker, sector FROM watchlist WHERE ticker IN ({placeholders})"
        with get_db() as conn:
            rows = conn.execute(sql, query_tickers).fetchall()

        for row in rows:
            ticker = str(row["ticker"]).upper().strip()
            sector = str(row["sector"] or "").strip() or "UNCLASSIFIED"
            sector_map[ticker] = sector
        return sector_map
