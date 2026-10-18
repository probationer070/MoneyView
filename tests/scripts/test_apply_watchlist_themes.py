"""Unit tests for the pure `plan_changes` step of the one-off theme apply script.

No DB and no network: `plan_changes` is given rows, a `current` snapshot and the theme list.
Each test's docstring names the mutation it was shown to catch (CLAUDE.md §8).
"""
from __future__ import annotations

import pytest

from apps.api.services.watchlist_themes import load_themes
from scripts.apply_watchlist_themes import NAME_FIXES, plan_changes

THEMES = load_themes()


def _row(ticker: str, label: str) -> dict:
    return {"ticker": ticker, "name": ticker, "proposed_theme": label}


def _cur(name: str = "X", theme: str = "", sector: str = "S", group: str = "custom", weight: float = 0.1) -> dict:
    return {"name": name, "sector": sector, "group_name": group, "weight": weight, "theme": theme}


def _all_names_correct() -> dict[str, dict]:
    return {ticker: _cur(name=name) for ticker, name in NAME_FIXES.items()}


def test_label_maps_to_id():
    """Catches a mutation that writes the Korean label instead of the stable id (global constraint:
    the DB stores the id). Mutation: return `label` rather than `ids_by_label[label]`.
    """
    current = {"ARIS": _cur(theme=""), **_all_names_correct()}
    assert plan_changes([_row("ARIS", "금·은")], current, THEMES) == [("ARIS", "theme", "gold_silver")]


def test_unknown_label_raises():
    """Catches a mutation that skips an unknown label silently instead of failing the whole run.
    Mutation: replace the `raise ValueError` with `continue`.
    """
    with pytest.raises(ValueError, match="없는 라벨"):
        plan_changes([_row("ARIS", "없는 라벨")], {"ARIS": _cur()}, THEMES)


def test_ticker_not_on_watchlist_is_missing_not_created():
    """Review Focus 5: a draft ticker absent from the watchlist is reported as `missing`, never
    created. Catches a mutation that drops the `missing` tuple (the ticker would vanish silently).
    Mutation: remove the `if ticker not in current:` branch's append.
    """
    result = plan_changes([_row("NUAG", "금·은")], {}, THEMES)
    assert ("NUAG", "missing", "") in result
    assert not [change for change in result if change[0] == "NUAG" and change[1] != "missing"]


def test_second_run_is_a_no_op():
    """Review Focus 5: once every target holds its value, a second run plans nothing.
    Catches a mutation that emits a tuple even when the stored value already equals the target
    (the `!=` checks removed).
    """
    rows = [_row("ARIS", "금·은")]
    current = {"ARIS": _cur(theme="gold_silver"), **_all_names_correct()}
    assert plan_changes(rows, current, THEMES) == []


def test_name_fixes_only_when_different():
    """Catches a mutation that rewrites a name that is already correct (it would print `set`
    instead of `unchanged`). Only SCCO has a wrong name here, so only SCCO may be planned.
    Mutation: drop the `now["name"] != NAME_FIXES[ticker]` comparison.
    """
    current = _all_names_correct()
    current["SCCO"] = _cur(name="suddun Copper")
    assert plan_changes([], current, THEMES) == [("SCCO", "name", "Southern Copper")]
