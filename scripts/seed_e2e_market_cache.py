from __future__ import annotations

from datetime import date, timedelta

from apps.api.services.db import get_db, init_db
from apps.api.services.market_data import MARKET_INDICES


def _business_days(start: date, count: int) -> list[date]:
    days: list[date] = []
    current = start
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def seed_market_cache() -> None:
    init_db()
    start = date(2021, 1, 4)
    dates = _business_days(start, 1305)

    with get_db() as conn:
        conn.execute("DELETE FROM indices")
        for index_offset, (name, ticker) in enumerate(MARKET_INDICES.items()):
            base = 1000.0 + index_offset * 250.0
            for day_offset, current_date in enumerate(dates):
                drift = day_offset * 0.9
                seasonal = ((day_offset % 20) - 10) * 0.35
                close = round(base + drift + seasonal, 2)
                open_price = round(close - 1.2, 2)
                high = round(close + 2.1, 2)
                low = round(close - 2.4, 2)
                volume = 1_000_000 + index_offset * 50_000 + day_offset * 25
                conn.execute(
                    """INSERT OR REPLACE INTO indices
                       (name, ticker, date, open, high, low, close, volume, dividends, stock_splits)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        name,
                        ticker,
                        current_date.isoformat(),
                        open_price,
                        high,
                        low,
                        close,
                        volume,
                        0.0,
                        0.0,
                    ),
                )


if __name__ == "__main__":
    seed_market_cache()
