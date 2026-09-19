"""Category resolution: file defaults, then saved overrides, then user categories, then visibility.

The order is normative (spec §1, Category resolution). The two lifecycle rules tested here are
the ones review found missing: an override cannot create a category, and a stale override for
an id that has left the file does nothing.
"""

import json

import pytest

from apps.api.services.events.categories import (
    CategoryRow,
    load_builtin_categories,
    resolve_categories,
)
from apps.api.services.events.validation import EventDataError

FOMC = {"id": "fomc", "label": "Fed rate decisions", "color": "#E54545"}
UNCATEGORIZED = {"id": "uncategorized", "label": "Uncategorized", "color": "#9DA5A2"}


def _write(tmp_path, categories):
    path = tmp_path / "categories.json"
    path.write_text(json.dumps({"categories": categories}), encoding="utf-8")
    return path


def test_builtin_categories_load_in_file_order_as_visible_builtins(tmp_path):
    categories = load_builtin_categories(_write(tmp_path, [FOMC, UNCATEGORIZED]))

    assert list(categories) == ["fomc", "uncategorized"]
    assert categories["fomc"].model_dump() == {
        "id": "fomc", "label": "Fed rate decisions", "color": "#E54545",
        "origin": "builtin", "visible": True, "overridden": False,
    }


def test_a_file_without_uncategorized_is_refused(tmp_path):
    # A user event whose built-in category is removed falls back to `uncategorized`; without it
    # that fallback would itself name a missing category.
    with pytest.raises(EventDataError, match="uncategorized"):
        load_builtin_categories(_write(tmp_path, [FOMC]))


@pytest.mark.parametrize("bad", [
    {"id": "user-mine", "label": "Mine", "color": "#000000"},
    {"id": "Fed Rates", "label": "Fed", "color": "#000000"},
    {"id": "fomc", "label": "", "color": "#000000"},
    {"id": "fomc", "label": "Fed", "color": "red"},
])
def test_a_malformed_builtin_category_is_refused(tmp_path, bad):
    with pytest.raises(EventDataError):
        load_builtin_categories(_write(tmp_path, [bad, UNCATEGORIZED]))


def test_a_duplicate_builtin_id_is_refused(tmp_path):
    with pytest.raises(EventDataError, match="duplicate"):
        load_builtin_categories(_write(tmp_path, [FOMC, FOMC, UNCATEGORIZED]))


def _builtins(tmp_path):
    return load_builtin_categories(_write(tmp_path, [FOMC, UNCATEGORIZED]))


def test_an_override_replaces_label_and_color_and_marks_the_category_overridden(tmp_path):
    rows = [CategoryRow(id="fomc", kind="override", label=None, color="#0000FF")]

    resolved = resolve_categories(_builtins(tmp_path), rows, {})

    assert resolved["fomc"].color == "#0000FF"
    assert resolved["fomc"].label == "Fed rate decisions", "a null override field keeps the file value"
    assert resolved["fomc"].overridden is True
    assert resolved["uncategorized"].overridden is False


def test_an_override_equal_to_the_file_is_not_marked_overridden(tmp_path):
    rows = [CategoryRow(id="fomc", kind="override", label="Fed rate decisions", color="#E54545")]

    assert resolve_categories(_builtins(tmp_path), rows, {})["fomc"].overridden is False


def test_an_override_for_an_id_no_longer_in_the_file_creates_no_category(tmp_path):
    rows = [CategoryRow(id="quad-witching", kind="override", label="Quad", color="#7C5CFF")]

    resolved = resolve_categories(_builtins(tmp_path), rows, {})

    assert "quad-witching" not in resolved


def test_user_categories_follow_the_builtins(tmp_path):
    rows = [CategoryRow(id="user-my-trades", kind="user", label="My trades", color="#4589E5")]

    resolved = resolve_categories(_builtins(tmp_path), rows, {})

    assert list(resolved) == ["fomc", "uncategorized", "user-my-trades"]
    assert resolved["user-my-trades"].origin == "user"
    assert resolved["user-my-trades"].overridden is False


def test_visibility_applies_by_id_and_rows_for_unknown_ids_are_ignored(tmp_path):
    resolved = resolve_categories(_builtins(tmp_path), [], {"fomc": False, "gone": False})

    assert resolved["fomc"].visible is False
    assert resolved["uncategorized"].visible is True, "no row means visible"
    assert "gone" not in resolved


def test_resolution_does_not_mutate_the_builtins_it_was_given(tmp_path):
    builtins = _builtins(tmp_path)
    resolve_categories(builtins, [CategoryRow("fomc", "override", None, "#0000FF")], {"fomc": False})

    assert builtins["fomc"].color == "#E54545"
    assert builtins["fomc"].visible is True
