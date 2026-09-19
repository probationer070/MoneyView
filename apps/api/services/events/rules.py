"""Rule events: dates generated from a rule instead of being listed one by one.

A rule instance is data (an entry in rules.json). Its `kind` selects a generator registered
here, which is code: a new kind is added with `register_rule_kind`, without editing the
generators or the registry.

The trading calendar is injected. Tests pass a fake; production passes XNYS from
`exchange_calendars`. Dates are generated only inside the intersection of the rule's `from`
date, the requested range, and the calendar's coverage -- a date the calendar does not cover
cannot be shifted off a holiday, so it is not generated, and a request reaching past coverage
returns what it can rather than failing.
"""

from __future__ import annotations

from datetime import date, timedelta
from functools import lru_cache
from typing import Any, Callable, Mapping, Protocol

from apps.api.models.schemas import MarketEvent
from apps.api.services.events.validation import (
    EventDataError,
    check_label,
    check_note,
    check_source,
    parse_iso_date,
)


class TradingCalendar(Protocol):
    def first_session(self) -> date: ...
    def last_session(self) -> date: ...
    def is_session(self, day: date) -> bool: ...
    def previous_session(self, day: date) -> date: ...


RuleGenerator = Callable[[Mapping[str, Any], TradingCalendar, date, date], list[date]]

_RULE_KINDS: dict[str, RuleGenerator] = {}


def register_rule_kind(name: str, generator: RuleGenerator) -> None:
    if name in _RULE_KINDS:
        raise ValueError(f"rule kind {name!r} is already registered")
    _RULE_KINDS[name] = generator


_WEEKDAYS = {"MON": 0, "TUE": 1, "WED": 2, "THU": 3, "FRI": 4, "SAT": 5, "SUN": 6}


def nth_weekday_of_month(rule: Mapping[str, Any], calendar: TradingCalendar, start: date, end: date) -> list[date]:
    """The nth given weekday of each listed month, moved to the previous session when closed."""
    months = rule.get("months")
    weekday = _WEEKDAYS.get(rule.get("weekday"))
    nth = rule.get("nth")
    if not isinstance(months, list) or not months or any(not isinstance(m, int) or not 1 <= m <= 12 for m in months):
        raise EventDataError(f"rule {rule.get('id')!r}: months must be a list of 1-12")
    if weekday is None:
        raise EventDataError(f"rule {rule.get('id')!r}: weekday must be one of {sorted(_WEEKDAYS)}")
    # A fifth weekday does not exist in every month, so it would silently skip some.
    if not isinstance(nth, int) or not 1 <= nth <= 4:
        raise EventDataError(f"rule {rule.get('id')!r}: nth must be 1-4")
    if rule.get("if_closed") != "previous_trading_day":
        raise EventDataError(f"rule {rule.get('id')!r}: if_closed must be 'previous_trading_day'")

    days: list[date] = []
    for year in range(start.year, end.year + 1):
        for month in sorted(months):
            first = date(year, month, 1)
            day = first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (nth - 1))
            if day < start:
                continue
            if day > calendar.last_session():
                continue
            if not calendar.is_session(day):
                day = calendar.previous_session(day)
            # Range-check after the holiday shift: a Friday past the range end can shift back into it.
            if start <= day <= end:
                days.append(day)
    return days


register_rule_kind("nth_weekday_of_month", nth_weekday_of_month)


class RuleEventSource:
    def __init__(self, rule: Mapping[str, Any], calendar: TradingCalendar, *, where: str):
        self.name = f"rule {rule.get('id')!r} in {where}"
        for key in ("id", "category", "label", "kind", "from", "source"):
            if key not in rule:
                raise EventDataError(f"{self.name} is missing {key!r}")
        check_label(rule["label"], what=self.name)
        check_note(rule.get("note", ""), what=self.name)
        check_source(rule["source"], required=True, what=self.name)
        self._from = parse_iso_date(rule["from"], what=f"{self.name} from")
        generator = _RULE_KINDS.get(rule["kind"])
        if generator is None:
            raise EventDataError(
                f"{self.name} names kind {rule['kind']!r}, which is not registered "
                f"(registered: {sorted(_RULE_KINDS)})"
            )
        self._generate = generator
        self._rule = dict(rule)
        self._calendar = calendar

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]:
        low = max(day for day in (self._from, start, self._calendar.first_session()) if day is not None)
        high = min(day for day in (end, self._calendar.last_session()) if day is not None)
        if low > high:
            return []
        return [
            MarketEvent(
                id=f"{self._rule['id']}-{day.isoformat()}",
                label=self._rule["label"].strip(),
                category=self._rule["category"],
                start_date=day.isoformat(),
                source=self._rule["source"],
                note=self._rule.get("note", ""),
                origin="rule",
            )
            for day in self._generate(self._rule, self._calendar, low, high)
        ]


class _ExchangeCalendar:
    """`exchange_calendars` behind the TradingCalendar protocol. Imported lazily: it loads pandas."""

    def __init__(self, code: str):
        import exchange_calendars

        self._calendar = exchange_calendars.get_calendar(code)

    def first_session(self) -> date:
        return self._calendar.first_session.date()

    def last_session(self) -> date:
        return self._calendar.last_session.date()

    def is_session(self, day: date) -> bool:
        return bool(self._calendar.is_session(day.isoformat()))

    def previous_session(self, day: date) -> date:
        return self._calendar.date_to_session(day.isoformat(), direction="previous").date()


@lru_cache(maxsize=None)
def exchange_calendar(code: str = "XNYS") -> TradingCalendar:
    """Built once per process (about 3 seconds the first time). Its coverage is fixed at build
    time: twenty years back to one year ahead of the day the process started."""
    return _ExchangeCalendar(code)
