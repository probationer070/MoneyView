from datetime import date

import pandas as pd

from apps.api.services.acquisition.ranges import FetchRange
from apps.api.services.acquisition.sources.bars import fetch_bars, latest_action_date


class _FakeTicker:
    def __init__(self, symbol: str, frame: pd.DataFrame | None = None, actions: pd.DataFrame | None = None):
        self.symbol = symbol
        self._frame = frame if frame is not None else pd.DataFrame()
        self._actions = actions if actions is not None else pd.DataFrame()
        self.history_calls: list[dict] = []

    def history(self, **kwargs):
        self.history_calls.append(kwargs)
        return self._frame

    @property
    def actions(self):
        return self._actions


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "Date": [pd.Timestamp("2026-07-24"), pd.Timestamp("2026-07-25")],
            "Open": [1.0, 2.0], "High": [1.5, 2.5], "Low": [0.5, 1.5],
            "Close": [1.2, 2.2], "Volume": [100, 200],
        }
    )


def _action_frame() -> pd.DataFrame:
    """yfinance.history() always returns Dividends and Stock Splits alongside OHLCV."""
    return pd.DataFrame(
        {
            "Date": [pd.Timestamp("2026-07-24"), pd.Timestamp("2026-07-25")],
            "Open": [1.0, 2.0], "High": [1.5, 2.5], "Low": [0.5, 1.5],
            "Close": [1.2, 2.2], "Volume": [100, 200],
            "Dividends": [0.0, 0.24], "Stock Splits": [4.0, 0.0],
        }
    )


def _indexed_frame() -> pd.DataFrame:
    """Shaped like real yfinance output: a DatetimeIndex named 'Date', no 'Date' column."""
    frame = pd.DataFrame(
        {
            "Open": [1.0, 2.0], "High": [1.5, 2.5], "Low": [0.5, 1.5],
            "Close": [1.2, 2.2], "Volume": [100, 200],
        },
        index=pd.DatetimeIndex(
            [pd.Timestamp("2026-07-24"), pd.Timestamp("2026-07-25")], name="Date"
        ),
    )
    return frame


def test_fetch_bars_passes_start_and_end_not_period():
    """The whole point of this phase: a bounded range instead of a whole period."""
    fake = _FakeTicker("AAPL", _frame())
    rows = fetch_bars(
        "AAPL",
        FetchRange(date(2026, 7, 24), date(2026, 7, 26), "delta"),
        ticker_factory=lambda symbol: fake,
    )
    assert fake.history_calls == [{"start": "2026-07-24", "end": "2026-07-26", "auto_adjust": True}]
    assert [row.date for row in rows] == ["2026-07-24", "2026-07-25"]
    assert rows[0].close == 1.2


def test_fetch_bars_handles_datetime_index_shaped_like_real_yfinance_output():
    """Real yfinance.Ticker.history() returns a DatetimeIndex named 'Date', not a
    'Date' column. Without this test, the `frame.reset_index()` branch that handles
    that shape is never exercised by the suite."""
    fake = _FakeTicker("AAPL", _indexed_frame())
    rows = fetch_bars(
        "AAPL",
        FetchRange(date(2026, 7, 24), date(2026, 7, 26), "delta"),
        ticker_factory=lambda symbol: fake,
    )
    assert [row.date for row in rows] == ["2026-07-24", "2026-07-25"]
    assert rows[0].close == 1.2
    assert rows[1].close == 2.2
    assert rows[0].volume == 100


def test_fetch_bars_carries_dividends_and_splits_through():
    """`_save_ohlcv_rows` writes row.dividends and row.stock_splits with INSERT OR
    REPLACE against UNIQUE(ticker, date). Leaving them at the schema default means every
    acquisition silently overwrites the stored dividend and split for a date with 0.0 --
    destroying the only record of a corporate action the app keeps, on the very rows a
    corporate action caused to be refetched."""
    fake = _FakeTicker("AAPL", _action_frame())
    rows = fetch_bars(
        "AAPL",
        FetchRange(date(2026, 7, 24), date(2026, 7, 26), "corporate_action"),
        ticker_factory=lambda symbol: fake,
    )
    assert [row.stock_splits for row in rows] == [4.0, 0.0]
    assert [row.dividends for row in rows] == [0.0, 0.24]


def test_fetch_bars_defaults_actions_to_zero_when_the_provider_omits_them():
    """An index frame has no Dividends/Stock Splits columns. Absent must read as 0.0,
    not raise."""
    fake = _FakeTicker("^GSPC", _frame())
    rows = fetch_bars(
        "^GSPC",
        FetchRange(date(2026, 7, 24), date(2026, 7, 26), "delta"),
        ticker_factory=lambda symbol: fake,
    )
    assert [row.dividends for row in rows] == [0.0, 0.0]
    assert [row.stock_splits for row in rows] == [0.0, 0.0]


def test_empty_frame_returns_no_rows_without_raising():
    """A holiday, a delisting, or a gap all produce an empty frame. That is `empty`,
    not a failure, and must not raise."""
    fake = _FakeTicker("DEAD", pd.DataFrame())
    assert fetch_bars("DEAD", FetchRange(date(2026, 7, 24), date(2026, 7, 26), "delta"),
                      ticker_factory=lambda symbol: fake) == []


def test_latest_action_date_reads_the_most_recent_split_or_dividend():
    """Index is deliberately not in ascending order: the newest action is NOT last,
    so this fails if `max(...)` is ever swapped for `.index[-1]`."""
    actions = pd.DataFrame(
        {"Dividends": [0.24, 0.0], "Stock Splits": [0.0, 4.0]},
        index=[pd.Timestamp("2026-05-15"), pd.Timestamp("2020-08-31")],
    )
    fake = _FakeTicker("AAPL", actions=actions)
    assert latest_action_date("AAPL", ticker_factory=lambda symbol: fake) == date(2026, 5, 15)


def test_latest_action_date_is_none_when_there_are_no_actions():
    fake = _FakeTicker("AAPL", actions=pd.DataFrame())
    assert latest_action_date("AAPL", ticker_factory=lambda symbol: fake) is None
