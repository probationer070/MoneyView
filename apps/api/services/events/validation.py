"""Validation shared by every event source and every write route.

A committed data file and a submitted form go through the same checks, so they cannot disagree
about what a valid event is. Every failure is an EventDataError whose message names what it is
about (`what`): for committed data that is the event and the file, which is what makes a failing
test point at the line to fix.
"""

from __future__ import annotations

import re
from datetime import date
from urllib.parse import urlparse

LABEL_MAX = 120
NOTE_MAX = 2000

_ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_HEX_COLOR = re.compile(r"#[0-9A-Fa-f]{6}")


class EventDataError(ValueError):
    """Event or category data that must not be stored or served."""


def parse_iso_date(value: str, *, what: str) -> date:
    # The regex comes first: date.fromisoformat also accepts "20260228", and a compact date
    # would break every consumer that slices "YYYY-MM" off the string.
    if not isinstance(value, str) or not _ISO_DATE.fullmatch(value):
        raise EventDataError(f"{what}={value!r} is not an ISO date (YYYY-MM-DD)")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise EventDataError(f"{what}={value!r} is not a real calendar date") from exc


def check_date_range(start: str, end: str | None, *, what: str) -> None:
    start_day = parse_iso_date(start, what=f"{what} start_date")
    if end is None:
        return
    end_day = parse_iso_date(end, what=f"{what} end_date")
    if end_day < start_day:
        raise EventDataError(f"{what} ends ({end}) before it starts ({start})")


def check_color(value: str, *, what: str) -> None:
    if not isinstance(value, str) or not _HEX_COLOR.fullmatch(value):
        raise EventDataError(f"{what} color={value!r} must be #RRGGBB")


def check_label(value: str, *, what: str) -> None:
    stripped = (value or "").strip()
    if not stripped:
        raise EventDataError(f"{what} has an empty label")
    if len(stripped) > LABEL_MAX:
        raise EventDataError(f"{what} label is {len(stripped)} characters; the limit is {LABEL_MAX}")


def check_note(value: str, *, what: str) -> None:
    if len(value or "") > NOTE_MAX:
        raise EventDataError(f"{what} note is {len(value)} characters; the limit is {NOTE_MAX}")


def check_source(value: str | None, *, required: bool, what: str) -> None:
    if value is None or not value.strip():
        if required:
            raise EventDataError(
                f"{what} has no source. Every built-in event is an asserted date, and an "
                f"unsourced one would draw an authoritative line nobody can check. Cite where "
                f"the date came from, or remove the event."
            )
        return
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise EventDataError(f"{what} source={value!r} must be an http(s) URL with a host")
