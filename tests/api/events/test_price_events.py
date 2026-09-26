"""Computed events from cached closes (todo I-C2): the two detectors and their registry source."""

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from apps.api.services.db import get_db
from apps.api.services.events import price_events
from apps.api.services.events.price_events import (
    PriceEventSource,
    cached_closes,
    detect_drawdowns,
    detect_oil_shocks,
)
from apps.api.services.events.registry import EVENTS_DIR


def _series(*closes, start=date(2024, 1, 1)):
    """Consecutive calendar days; the detectors count rows, not dates."""
    return [((start + timedelta(days=i)).isoformat(), float(c)) for i, c in enumerate(closes)]


# --- drawdowns ------------------------------------------------------------------------------

def test_a_decline_of_exactly_the_threshold_is_a_drawdown_spanning_peak_to_trough():
    closes = _series(100, 95, 90, 85, 95, 101)
    [event] = detect_drawdowns(closes)
    assert (event.start_date, event.end_date) == (closes[0][0], closes[3][0])
    assert event.basis.change_pct == -15.0
    assert (event.basis.from_close, event.basis.to_close) == (100.0, 85.0)
    assert event.basis.ongoing is False
    assert event.origin == "computed" and event.source is None


def test_a_decline_of_exactly_ten_percent_qualifies_despite_float_representation():
    [event] = detect_drawdowns(_series(100, 90, 100))
    assert event.basis.change_pct == -10.0


def test_a_decline_just_short_of_the_threshold_is_not_a_drawdown():
    assert detect_drawdowns(_series(100, 90.01, 100)) == []


def test_the_peak_is_the_highest_close_before_the_decline():
    [event] = detect_drawdowns(_series(100, 110, 105, 98, 111))
    assert event.basis.from_close == 110.0 and event.basis.change_pct == pytest.approx(-10.91)


def test_the_trough_is_the_lowest_close_before_recovery_not_the_first_crossing():
    [event] = detect_drawdowns(_series(100, 89, 80, 88, 100))
    assert event.basis.to_close == 80.0


def test_a_second_dip_before_the_peak_is_regained_belongs_to_the_same_episode():
    [event] = detect_drawdowns(_series(100, 85, 95, 88, 99, 100))
    assert event.basis.to_close == 85.0


def test_recovery_needs_the_peak_itself_and_starts_a_new_episode():
    events = detect_drawdowns(_series(100, 85, 99.99, 100, 120, 100, 130))
    assert [(e.basis.from_close, e.basis.to_close) for e in events] == [(100.0, 85.0), (120.0, 100.0)]


def test_a_close_exactly_at_the_peak_ends_the_episode():
    events = detect_drawdowns(_series(100, 85, 100, 89, 100.5))
    assert [(e.basis.from_date, e.basis.to_close) for e in events] == [("2024-01-01", 85.0), ("2024-01-03", 89.0)]


def test_an_unrecovered_drawdown_is_ongoing_and_names_the_last_close_read():
    closes = _series(100, 85, 80, 90)
    [event] = detect_drawdowns(closes)
    assert event.basis.ongoing is True and event.basis.as_of == closes[-1][0]
    assert "(ongoing)" in event.label and "Not regained" in event.note


def test_the_note_states_the_closes_and_the_rule_from_the_basis():
    [event] = detect_drawdowns(_series(100, 85, 101))
    assert "100.00" in event.note and "85.00" in event.note and "10%" in event.note


def test_no_closes_no_drawdowns():
    assert detect_drawdowns([]) == []


# --- oil shocks -----------------------------------------------------------------------------

def _oil(*closes):
    return detect_oil_shocks(_series(*closes), lookback=2)


def test_a_move_of_exactly_the_threshold_over_the_lookback_is_a_shock():
    [event] = _oil(100, 100, 120)
    assert event.basis.direction == "up" and event.basis.change_pct == 20.0
    assert event.basis.lookback_sessions == 2


def test_a_move_just_short_of_the_threshold_is_not_a_shock():
    assert _oil(100, 100, 119.99) == []


def test_a_fall_is_its_own_direction():
    [event] = _oil(100, 100, 80)
    assert event.basis.direction == "down" and event.basis.change_pct == -20.0
    assert event.id.startswith("oil-shock-down-")


def test_a_sustained_move_is_one_episode_reporting_its_largest_move():
    closes = _series(100, 100, 125, 130, 150, 160, 160, 160, 160)
    [event] = detect_oil_shocks(closes, lookback=2)
    # 2-session moves: +25, +30, +20, +23.1, then +6.7 (below the threshold)
    assert event.start_date == closes[0][0]           # the first qualifying window's start
    assert event.end_date == closes[5][0]             # the last qualifying session
    assert event.basis.change_pct == 30.0             # 100 -> 130 is the largest
    assert (event.basis.from_date, event.basis.to_date) == (closes[1][0], closes[3][0])


def test_windows_that_do_not_overlap_are_separate_episodes():
    events = _oil(100, 100, 120, 120, 120, 120, 144)
    assert len(events) == 2


def test_an_up_and_a_down_episode_are_both_reported_in_date_order():
    events = _oil(100, 100, 130, 130, 100, 100)
    assert [e.basis.direction for e in events] == ["up", "down"]


def test_a_series_shorter_than_the_lookback_has_no_shocks():
    assert _oil(100, 150) == []


# --- source, cache and registry -------------------------------------------------------------

def _insert(conn, ticker, day, close):
    conn.execute("INSERT INTO indices (name, ticker, date, close) VALUES (?, ?, ?, ?)",
                 (ticker, ticker, day, close))


def test_cached_closes_skip_nulls_and_other_tickers_oldest_first():
    with get_db() as conn:
        _insert(conn, "^GSPC", "2024-01-03", 90.0)
        _insert(conn, "^GSPC", "2024-01-01", 100.0)
        _insert(conn, "^GSPC", "2024-01-02", None)
        _insert(conn, "CL=F", "2024-01-02", 70.0)
    assert cached_closes("^GSPC") == [("2024-01-01", 100.0), ("2024-01-03", 90.0)]


def test_the_source_keeps_only_events_overlapping_the_range():
    closes = _series(100, 85, 101, 101, 101, 101, 85, 101)   # episodes starting day 0 and day 5
    source = PriceEventSource("^GSPC", detect_drawdowns, closes=lambda symbol: closes)
    assert len(source.events(None, None)) == 2
    [late] = source.events(date(2024, 1, 5), None)
    assert late.start_date == "2024-01-06"
    assert [e.start_date for e in source.events(None, date(2024, 1, 1))] == ["2024-01-01"]


def test_every_computed_category_is_a_committed_builtin_category():
    committed = {c["id"] for c in json.loads((Path(EVENTS_DIR) / "categories.json").read_text(encoding="utf-8"))["categories"]}
    assert {price_events.DRAWDOWN_CATEGORY, price_events.OIL_CATEGORY} <= committed


def test_the_default_registry_serves_computed_events_from_the_cache(tmp_path):
    from apps.api.services.events.registry import default_registry
    from tests.api.events.test_rules import FakeCalendar
    (tmp_path / "categories.json").write_text((Path(EVENTS_DIR) / "categories.json").read_text(encoding="utf-8"),
                                              encoding="utf-8")
    with get_db() as conn:
        for day, close in _series(100, 85, 101):
            _insert(conn, "^GSPC", day, close)
    [event] = default_registry(tmp_path, FakeCalendar()).events()
    assert event.category == "drawdown" and event.origin == "computed"
