from __future__ import annotations

from apps.api.models.schemas import StockOHLCV
from apps.api.services.market_data import MarketDataService, month_delta


def _bar(day: str, close: float) -> StockOHLCV:
    return StockOHLCV(date=day, open=close, high=close, low=close, close=close, volume=1)


def _bar_without_close(day: str) -> StockOHLCV:
    # StockOHLCV.close is a required float, so a None close can only be built by bypassing validation.
    return StockOHLCV.model_construct(
        date=day, open=None, high=None, low=None, close=None, volume=1, dividends=0.0, stock_splits=0.0
    )


def _october_bars() -> list[StockOHLCV]:
    return [
        _bar("2026-09-01", 90.0),
        _bar("2026-09-15", 100.0),
        _bar("2026-10-01", 105.0),
        _bar("2026-10-15", 110.0),
    ]


def test_base_is_the_close_one_calendar_month_earlier():
    result = month_delta(_october_bars())

    assert result is not None
    assert result.delta_pct == 10.0
    assert result.prev_value == 100


def test_a_holiday_anchor_takes_the_bar_before_not_after():
    bars = [
        _bar("2026-09-14", 100.0),
        _bar("2026-09-16", 200.0),
        _bar("2026-10-15", 110.0),
    ]

    result = month_delta(bars)

    assert result is not None
    assert result.prev_value == 100


def test_month_end_clamps_to_the_last_day_of_the_shorter_month():
    bars = [
        _bar("2026-02-28", 100.0),
        _bar("2026-03-02", 300.0),
        _bar("2026-03-31", 110.0),
    ]
    result = month_delta(bars)
    assert result is not None
    assert result.prev_value == 100

    leap_bars = [
        _bar("2024-02-29", 100.0),
        _bar("2024-03-02", 300.0),
        _bar("2024-03-31", 110.0),
    ]
    leap_result = month_delta(leap_bars)
    assert leap_result is not None
    assert leap_result.prev_value == 100


def test_less_than_a_month_of_history_is_none():
    bars = [
        _bar("2026-09-20", 100.0),
        _bar("2026-09-25", 101.0),
        _bar("2026-10-15", 110.0),
    ]

    assert month_delta(bars) is None


def test_a_base_bar_without_a_close_is_skipped():
    bars = [
        _bar("2026-09-14", 100.0),
        _bar_without_close("2026-09-15"),
        _bar("2026-10-15", 110.0),
    ]

    result = month_delta(bars)

    assert result is not None
    assert result.prev_value == 100


def test_get_all_indices_sends_month_delta(monkeypatch):
    bars = _october_bars()
    monkeypatch.setattr(MarketDataService, "get_stock_ohlcv", lambda self, *args, **kwargs: bars)

    quotes = MarketDataService().get_all_indices()

    assert quotes
    for quote in quotes:
        assert quote.month_delta is not None
        assert quote.month_delta.delta_pct == 10.0


def test_a_january_last_bar_anchors_to_the_previous_december():
    bars = [
        _bar("2025-12-15", 100.0),
        _bar("2025-12-16", 300.0),
        _bar("2026-01-15", 110.0),
    ]

    result = month_delta(bars)

    assert result is not None
    assert result.prev_value == 100


def test_a_dense_daily_series_takes_the_calendar_anchor_not_a_bar_count():
    from datetime import date, timedelta

    bars = []
    day = date(2026, 8, 3)
    index = 0
    while day <= date(2026, 10, 15):
        if day.weekday() < 5:
            bars.append(_bar(day.isoformat(), 100.0 + index))
            index += 1
        day += timedelta(days=1)

    expected = next(bar.close for bar in bars if bar.date == "2026-09-15")
    assert bars[-22].close != expected

    result = month_delta(bars)

    assert result is not None
    assert result.prev_value == expected
