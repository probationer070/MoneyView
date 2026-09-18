"""Rule events: a rule instance is data, and its `kind` selects a registered generator.

The fake calendar makes placement testable without holiday data. One test uses the real XNYS
calendar for the case that motivated injecting one: 19 Jun 2026 is June's third Friday AND the
Juneteenth market holiday, so that quarter's expiry is Thursday 18 Jun. XNYS covers twenty years
back from today, so that test stays valid until about 2046.
"""

from datetime import date, timedelta

import pytest

from apps.api.services.events import rules
from apps.api.services.events.rules import RuleEventSource, exchange_calendar, register_rule_kind
from apps.api.services.events.validation import EventDataError


class FakeCalendar:
    def __init__(self, closed=(), first=date(2020, 1, 1), last=date(2026, 12, 31)):
        self._closed = set(closed)
        self._first = first
        self._last = last

    def first_session(self):
        return self._first

    def last_session(self):
        return self._last

    def is_session(self, day):
        return day.weekday() < 5 and day not in self._closed

    def previous_session(self, day):
        day -= timedelta(days=1)
        while not self.is_session(day):
            day -= timedelta(days=1)
        return day


QUAD = {
    "id": "quad-witching",
    "category": "quad-witching",
    "label": "Quadruple witching",
    "note": "Quarterly expiration.",
    "source": "https://example.com/expiration-rule",
    "kind": "nth_weekday_of_month",
    "months": [3, 6, 9, 12],
    "weekday": "FRI",
    "nth": 3,
    "if_closed": "previous_trading_day",
    "from": "2020-01-01",
}


def _dates(source, start, end):
    return [event.start_date for event in source.events(start, end)]


def test_the_third_friday_of_each_listed_month_is_generated():
    source = RuleEventSource(QUAD, FakeCalendar(), where="test")

    assert _dates(source, date(2025, 1, 1), date(2025, 12, 31)) == [
        "2025-03-21", "2025-06-20", "2025-09-19", "2025-12-19",
    ]


def test_a_closed_friday_moves_to_the_previous_session():
    source = RuleEventSource(QUAD, FakeCalendar(closed={date(2026, 6, 19)}), where="test")

    assert _dates(source, date(2026, 1, 1), date(2026, 12, 31)) == [
        "2026-03-20", "2026-06-18", "2026-09-18", "2026-12-18",
    ]


def test_a_shifted_date_is_kept_when_the_range_ends_between_it_and_the_scheduled_friday():
    source = RuleEventSource(QUAD, FakeCalendar(closed={date(2026, 6, 19)}), where="test")

    assert _dates(source, date(2026, 6, 1), date(2026, 6, 18)) == ["2026-06-18"]


def test_the_real_nyse_calendar_keeps_the_juneteenth_expiry_when_the_range_ends_on_it():
    source = RuleEventSource(QUAD, exchange_calendar("XNYS"), where="test")

    assert _dates(source, date(2026, 6, 1), date(2026, 6, 18)) == ["2026-06-18"]


def test_generated_events_carry_the_rule_fields_and_rule_origin():
    [event] = RuleEventSource(QUAD, FakeCalendar(), where="test").events(date(2026, 3, 1), date(2026, 3, 31))

    assert event.model_dump() == {
        "id": "quad-witching-2026-03-20", "label": "Quadruple witching", "category": "quad-witching",
        "start_date": "2026-03-20", "end_date": None, "source": "https://example.com/expiration-rule",
        "note": "Quarterly expiration.", "origin": "rule", "missing_category": None,
    }


def test_nothing_is_generated_before_the_rule_from_date():
    source = RuleEventSource({**QUAD, "from": "2026-06-01"}, FakeCalendar(), where="test")

    assert _dates(source, None, date(2026, 12, 31)) == ["2026-06-19", "2026-09-18", "2026-12-18"]


def test_a_request_past_calendar_coverage_returns_what_it_can_without_failing():
    source = RuleEventSource(QUAD, FakeCalendar(last=date(2026, 7, 1)), where="test")

    assert _dates(source, date(2026, 1, 1), date(2028, 12, 31)) == ["2026-03-20", "2026-06-19"]
    assert _dates(source, date(2028, 1, 1), date(2028, 12, 31)) == []


def test_an_unregistered_kind_is_refused_when_the_source_is_built():
    with pytest.raises(EventDataError, match="no_such_kind"):
        RuleEventSource({**QUAD, "kind": "no_such_kind"}, FakeCalendar(), where="test")


@pytest.mark.parametrize("missing", ["id", "category", "label", "kind", "from", "source"])
def test_a_rule_missing_a_required_field_is_refused(missing):
    rule = {key: value for key, value in QUAD.items() if key != missing}
    with pytest.raises(EventDataError, match=missing):
        RuleEventSource(rule, FakeCalendar(), where="test")


@pytest.mark.parametrize("override", [{"months": [13]}, {"weekday": "FRIDAY"}, {"nth": 5}, {"if_closed": "skip"}])
def test_bad_nth_weekday_parameters_are_refused(override):
    source = RuleEventSource({**QUAD, **override}, FakeCalendar(), where="test")
    with pytest.raises(EventDataError):
        source.events(date(2026, 1, 1), date(2026, 12, 31))


def test_a_registered_kind_is_used_without_changing_the_generator_module(monkeypatch):
    monkeypatch.setattr(rules, "_RULE_KINDS", dict(rules._RULE_KINDS))
    register_rule_kind("first_session_of_range", lambda rule, calendar, start, end: [start])

    source = RuleEventSource({**QUAD, "kind": "first_session_of_range"}, FakeCalendar(), where="test")

    assert _dates(source, date(2026, 5, 4), date(2026, 5, 8)) == ["2026-05-04"]


def test_registering_a_kind_twice_is_refused(monkeypatch):
    monkeypatch.setattr(rules, "_RULE_KINDS", dict(rules._RULE_KINDS))
    with pytest.raises(ValueError, match="already registered"):
        register_rule_kind("nth_weekday_of_month", lambda *args: [])


def test_the_real_nyse_calendar_moves_the_juneteenth_2026_expiry_to_thursday():
    source = RuleEventSource(QUAD, exchange_calendar("XNYS"), where="test")

    assert _dates(source, date(2026, 1, 1), date(2026, 12, 31)) == [
        "2026-03-20", "2026-06-18", "2026-09-18", "2026-12-18",
    ]
