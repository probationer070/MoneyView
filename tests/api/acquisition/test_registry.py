from datetime import UTC, datetime

from apps.api.services.acquisition.registry import REGISTRY, Scope, get_data_class


def test_phase_one_declares_equity_and_index_bars():
    assert set(REGISTRY) == {"equity_bars", "index_bars"}


def test_equity_bars_is_per_ticker_and_stores_to_stocks():
    declared = get_data_class("equity_bars")
    assert declared.scope is Scope.PER_TICKER
    assert declared.store == "stocks"


def test_index_bars_stores_to_indices():
    assert get_data_class("index_bars").store == "indices"


def test_both_bar_classes_use_the_midnight_utc_boundary():
    """Design decision: all boundaries declared and compared in UTC. 00:00 UTC sits
    3-4 hours after the US close in both DST halves."""
    now = datetime(2026, 7, 27, 9, 0, tzinfo=UTC)
    for name in ("equity_bars", "index_bars"):
        instant = get_data_class(name).boundary.most_recent_instant(now)
        assert instant == datetime(2026, 7, 27, 0, 0, tzinfo=UTC)


def test_unknown_data_class_raises_with_a_useful_message():
    try:
        get_data_class("statements")
    except KeyError as error:
        assert "statements" in str(error)
    else:
        raise AssertionError("an unknown data class must raise")
