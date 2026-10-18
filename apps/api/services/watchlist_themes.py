"""Checked-in watchlist theme list (`watchlist_themes.yaml`), validated on load."""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

from apps.api.models.schema_parts.watchlist import WatchlistTheme

THEMES_PATH = Path(__file__).with_name("watchlist_themes.yaml")
_ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")


def _parse(path: Path) -> list[WatchlistTheme]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    themes: list[WatchlistTheme] = []
    seen: set[str] = set()
    for row in data.get("themes") or []:
        theme = WatchlistTheme(**row)
        if not _ID_PATTERN.match(theme.id):
            raise ValueError(f"watchlist theme id must match {_ID_PATTERN.pattern}: {theme.id!r}")
        if theme.id in seen:
            raise ValueError(f"duplicate watchlist theme id: {theme.id}")
        seen.add(theme.id)
        themes.append(theme)
    return themes


@lru_cache(maxsize=1)
def _default_themes() -> tuple[WatchlistTheme, ...]:
    return tuple(_parse(THEMES_PATH))


def load_themes(path: Path | None = None) -> list[WatchlistTheme]:
    """Themes in YAML order. Only the default path is cached; a passed path is read every call."""
    if path is None:
        return list(_default_themes())
    return _parse(path)


def theme_ids() -> frozenset[str]:
    return frozenset(theme.id for theme in _default_themes())
