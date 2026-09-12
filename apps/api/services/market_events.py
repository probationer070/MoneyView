"""Market events drawn as vertical lines on price charts.

**Asserted events only.** Every date here is a claim about the world -- a policy decision, a
military operation -- not something derivable from price bars. A chart marking the wrong day
is worse than a chart marking nothing, because every read taken off it would be wrong and
nothing about the line would look amiss. So `source` is required and non-empty, and an event
without one is refused loudly rather than skipped: a skipped event is a line that silently
does not appear, which reads as "nothing happened then".

**No DB table, and no seeding, on purpose.** The file is committed, so every machine has the
same events after a pull. Mirroring it into SQLite would rebuild the drift class recorded in
ERROR-LOG.md 2026-09-12, where a one-shot bootstrap meant a machine could never pick up a
row added to the seed later.
"""

from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import List, Optional

from apps.api.models.schemas import MarketEvent

logger = logging.getLogger(__name__)

MARKET_EVENTS_JSON = Path(__file__).resolve().parent / "market_events.json"


def load_market_events(json_path: Optional[Path] = None) -> List[MarketEvent]:
    """Read the committed event file, refusing any event that is not properly sourced.

    A missing file yields no events rather than raising: a chart with no events is a normal
    state, and a 500 because a file is absent is not. A file that exists but holds a bad
    event DOES raise -- that is a committed mistake, and the tests are what catch it.
    """
    path = json_path if json_path is not None else MARKET_EVENTS_JSON
    if not path.exists():
        logger.info("no market events file at %s; charts will show no event lines", path)
        return []

    payload = json.loads(path.read_text(encoding="utf-8"))
    events: List[MarketEvent] = []
    for raw in payload.get("events", []):
        event = MarketEvent(**raw)
        _validate(event, path)
        events.append(event)
    return events


def _validate(event: MarketEvent, path: Path) -> None:
    if not event.source.strip():
        raise ValueError(
            f"market event {event.id!r} in {path} has an empty source. Every event here is an "
            f"asserted date, and an unsourced one would draw an authoritative line nobody can "
            f"check. Cite where the date came from, or remove the event."
        )
    _require_iso_date(event.id, "start_date", event.start_date, path)
    if event.end_date is not None:
        _require_iso_date(event.id, "end_date", event.end_date, path)


def _require_iso_date(event_id: str, field: str, value: str, path: Path) -> None:
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError(
            f"market event {event_id!r} in {path} has {field}={value!r}, which is not an "
            f"ISO date (YYYY-MM-DD). A malformed date places the line arbitrarily or not at "
            f"all, and the chart cannot tell that from a quiet day."
        ) from exc
