"""Validation shared by every event source and every write route.

One module, so a committed file and a submitted form cannot disagree about what a valid event
is. Each check raises EventDataError with `what` in its message, which is how a failure names
the event or field it is about.
"""

import pytest

from apps.api.services.events.validation import (
    LABEL_MAX,
    NOTE_MAX,
    EventDataError,
    check_color,
    check_date_range,
    check_label,
    check_note,
    check_source,
    parse_iso_date,
)


def test_an_iso_date_parses():
    assert parse_iso_date("2026-02-28", what="x").isoformat() == "2026-02-28"


@pytest.mark.parametrize("value", ["28-02-2026", "20260228", "2026-02-30", "2026-2-28", ""])
def test_a_non_iso_or_impossible_date_is_refused_naming_the_field(value):
    # "20260228" matters: Python 3.13's date.fromisoformat accepts it, so without the regex a
    # compact date would be stored and every consumer that slices "YYYY-MM" would misread it.
    with pytest.raises(EventDataError, match="start_date"):
        parse_iso_date(value, what="start_date")


def test_an_end_before_the_start_is_refused():
    with pytest.raises(EventDataError, match="before it starts"):
        check_date_range("2026-03-02", "2026-03-01", what="event")


def test_a_one_day_range_and_an_open_end_are_accepted():
    check_date_range("2026-03-02", "2026-03-02", what="event")
    check_date_range("2026-03-02", None, what="event")


@pytest.mark.parametrize("value", ["#E54545", "#e54545"])
def test_a_six_digit_hex_color_is_accepted(value):
    check_color(value, what="category")


@pytest.mark.parametrize("value", ["E54545", "#E545", "red", "var(--delta-up)", "#E54545FF", ""])
def test_anything_but_six_digit_hex_is_refused(value):
    with pytest.raises(EventDataError, match="#RRGGBB"):
        check_color(value, what="category")


@pytest.mark.parametrize("value", ["", "   "])
def test_an_empty_label_is_refused(value):
    with pytest.raises(EventDataError, match="empty label"):
        check_label(value, what="event")


def test_label_length_is_capped_after_stripping():
    check_label("  " + "a" * LABEL_MAX + "  ", what="event")
    with pytest.raises(EventDataError, match=str(LABEL_MAX)):
        check_label("a" * (LABEL_MAX + 1), what="event")


def test_note_length_is_capped():
    check_note("n" * NOTE_MAX, what="event")
    with pytest.raises(EventDataError, match=str(NOTE_MAX)):
        check_note("n" * (NOTE_MAX + 1), what="event")


def test_a_required_source_must_be_present():
    with pytest.raises(EventDataError, match="no source"):
        check_source(None, required=True, what="market event 'x'")
    with pytest.raises(EventDataError, match="no source"):
        check_source("   ", required=True, what="market event 'x'")


def test_an_optional_source_may_be_absent():
    check_source(None, required=False, what="event")
    check_source("", required=False, what="event")


@pytest.mark.parametrize("value", ["ftp://example.com/a", "https://", "example.com/a", "javascript:alert(1)"])
def test_a_given_source_must_be_an_http_url_with_a_host(value):
    with pytest.raises(EventDataError, match="http"):
        check_source(value, required=False, what="event")


def test_an_http_or_https_source_is_accepted():
    check_source("http://example.com/a", required=True, what="event")
    check_source("https://www.federalreserve.gov/x.htm", required=True, what="event")
