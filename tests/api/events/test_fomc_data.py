"""The committed FOMC decisions: dated by statement, sourced to that statement, and internally
consistent -- each label's change must match the move from the previous event's range, which
catches a transcription slip in either a date's order or a range."""

import re
from decimal import Decimal

from apps.api.services.events.registry import EVENTS_DIR
from apps.api.services.events.sources import FileEventSource

_URL = re.compile(r"^https://www\.federalreserve\.gov/newsevents/pressreleases/monetary(\d{4})(\d{2})(\d{2})a\.htm$")
_LABEL = re.compile(r"^FOMC: (?:(hold) at|(cut|hike) (\d+)bp to) (\d+\.\d{2})–(\d+\.\d{2})%$")


def _events():
    return FileEventSource(EVENTS_DIR / "fomc.json").events(None, None)


def test_fomc_events_start_with_the_first_2020_statement_and_are_unique_and_ordered():
    events = _events()
    dates = [event.start_date for event in events]

    assert dates[0] == "2020-01-29"
    assert dates == sorted(set(dates)), "dates must be unique and in order"
    assert "2020-03-03" in dates and "2020-03-15" in dates, "the two unscheduled March 2020 cuts"
    assert not {"2020-03-16", "2020-03-19", "2020-03-23", "2020-03-31", "2020-08-27"} & set(dates), (
        "an effective date or a notation vote that did not set the range"
    )


def test_each_fomc_event_is_dated_and_sourced_by_its_own_statement():
    for event in _events():
        match = _URL.fullmatch(event.source or "")
        assert match, f"{event.id}: source is not a federalreserve.gov statement URL: {event.source}"
        assert "-".join(match.groups()) == event.start_date, f"{event.id}: the URL's date is not the event's date"
        assert event.id == f"fomc-{event.start_date}"
        assert event.category == "fomc"


def test_each_fomc_label_follows_from_the_previous_target_range():
    previous_upper = None
    for event in _events():
        match = _LABEL.fullmatch(event.label)
        assert match, f"{event.id}: label {event.label!r} does not follow 'FOMC: hold at|cut Nbp to|hike Nbp to L–U%'"
        hold, direction, size, lower, upper = match.groups()
        assert Decimal(upper) - Decimal(lower) == Decimal("0.25"), f"{event.id}: the range is not 25bp wide"
        if previous_upper is not None:
            moved_bp = int((Decimal(upper) - previous_upper) * 100)
            expected_bp = 0 if hold else (int(size) if direction == "hike" else -int(size))
            assert moved_bp == expected_bp, f"{event.id}: label says {expected_bp:+}bp but the range moved {moved_bp:+}bp"
        previous_upper = Decimal(upper)
