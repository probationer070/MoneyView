from datetime import date, timedelta

from apps.api.services.market_data import MarketDataService


def _row(row_date: date) -> dict:
    return {
        "date": row_date.isoformat(),
        "open": 1.0,
        "high": 1.0,
        "low": 1.0,
        "close": 1.0,
        "volume": 1,
    }


def test_rows_cover_period_rejects_fresh_one_year_cache_for_five_year_request(monkeypatch):
    service = MarketDataService()
    latest = date(2026, 4, 8)
    rows = [_row(latest - timedelta(days=offset)) for offset in range(365)]
    monkeypatch.setattr(service, "_previous_trading_day", lambda today=None: latest)

    assert service._rows_are_fresh(rows)
    assert not service._rows_cover_period(rows, 1825)


def test_rows_cover_period_accepts_five_year_span():
    service = MarketDataService()
    latest = date(2026, 4, 8)
    rows = [_row(latest - timedelta(days=offset)) for offset in range(1826)]

    assert service._rows_cover_period(rows, 1825)
