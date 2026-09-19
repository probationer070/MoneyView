"""Event categories: built-in defaults from a committed file, resolved against saved rows.

Resolution order (spec §1, normative):
  1. load and validate the file; it must define `uncategorized`
  2. apply each override row to the file category with the same id -- an override for an id
     that is not in the file is ignored, never creating a category, and kept so it applies again
     if the id returns
  3. add user categories
  4. apply visibility by id; rows for unknown ids are ignored

Built-ins come from the file on every call rather than being seeded into SQLite, so a category
added to the file later reaches every machine (the seed-drift class in ERROR-LOG.md 2026-09-12).
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Literal, Mapping

from apps.api.models.schemas import EventCategory
from apps.api.services.events.validation import EventDataError, check_color, check_label

logger = logging.getLogger(__name__)

REQUIRED_CATEGORY = "uncategorized"
USER_PREFIX = "user-"
_SLUG = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


@dataclass(frozen=True)
class CategoryRow:
    """One saved row: an override of a built-in, or a user category."""

    id: str
    kind: Literal["override", "user"]
    label: str | None
    color: str | None


def load_builtin_categories(path: Path) -> dict[str, EventCategory]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    categories: dict[str, EventCategory] = {}
    for raw in payload.get("categories", []):
        category_id = raw.get("id", "")
        what = f"category {category_id!r} in {path}"
        if not isinstance(category_id, str) or not _SLUG.fullmatch(category_id):
            raise EventDataError(f"{what}: id must be a lowercase slug such as 'fomc'")
        if category_id.startswith(USER_PREFIX):
            raise EventDataError(f"{what}: built-in ids must not start with {USER_PREFIX!r}")
        if category_id in categories:
            raise EventDataError(f"{what}: duplicate id")
        check_label(raw.get("label", ""), what=what)
        check_color(raw.get("color", ""), what=what)
        categories[category_id] = EventCategory(
            id=category_id, label=raw["label"].strip(), color=raw["color"], origin="builtin"
        )
    if REQUIRED_CATEGORY not in categories:
        raise EventDataError(
            f"{path} must define the {REQUIRED_CATEGORY!r} category: a user event whose "
            f"built-in category is removed falls back to it"
        )
    return categories


def resolve_categories(
    builtins: Mapping[str, EventCategory],
    rows: Iterable[CategoryRow],
    visibility: Mapping[str, bool],
) -> dict[str, EventCategory]:
    resolved = {category_id: category.model_copy() for category_id, category in builtins.items()}
    user_rows: list[CategoryRow] = []

    for row in rows:
        if row.kind == "user":
            user_rows.append(row)
            continue
        default = builtins.get(row.id)
        if default is None:
            logger.info("ignoring the saved override for %r: no built-in category has that id", row.id)
            continue
        label = row.label if row.label is not None else default.label
        color = row.color if row.color is not None else default.color
        resolved[row.id] = default.model_copy(
            update={
                "label": label,
                "color": color,
                "overridden": (label, color.upper()) != (default.label, default.color.upper()),
            }
        )

    for row in user_rows:
        if row.id in resolved:
            logger.warning("ignoring the saved user category %r: the id is already taken", row.id)
            continue
        resolved[row.id] = EventCategory(id=row.id, label=row.label or row.id, color=row.color or "#9DA5A2", origin="user")

    for category_id, visible in visibility.items():
        if category_id in resolved:
            resolved[category_id] = resolved[category_id].model_copy(update={"visible": bool(visible)})

    return resolved
