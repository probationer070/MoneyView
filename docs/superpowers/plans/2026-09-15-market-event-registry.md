# Market Event Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dated events on every price chart, from pluggable sources (committed files, data-driven
rules, the user's own events), grouped into colored categories with one global filter, a hover
tooltip per line, and an `/events` page to manage them.

**Architecture:**
- **Backend:** an `EventRegistry` merges `EventSource` objects and resolves every event's
  category.
  - Built-in events come from JSON files.
  - Rule events (quadruple witching) come from `rules.json` entries whose `kind` selects a
    registered generator. Holidays come from an injected trading calendar (`exchange_calendars`
    XNYS in production).
  - User events, category overrides and visibility live in SQLite.
- **Frontend:** charts receive a plain `EventLineSpec[]` and know nothing about categories.
  - One hook turns events and categories into colored lines.
  - `EventFilter` replaces the three per-surface toggles.
  - The `/events` page edits user events and categories.

**Tech Stack:** Python 3.13, FastAPI, Pydantic v2, SQLite, `exchange_calendars` 4.13;
Next.js 16, React 19, TypeScript, TanStack Query v5, lightweight-charts 5.1; pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-15-market-event-registry-design.md` (read it first; this
plan implements it and records where it deviates).

## Global Constraints

- **Delivery is four PRs against `renewal`, in order:** Part A → PR 1, B → PR 2, C → PR 3,
  D → PR 4. Each leaves `renewal` working. Branch each part from an up-to-date `origin/renewal`
  once the previous PR has merged. Merge; never rebase or force-push.
- **Every new test must be shown to fail against a named broken implementation before it is
  reported as verified** (CLAUDE.md §8, `guideline/sop/test-verification.md`). Each task has a
  *Mutation check* step. Break the source as described, run the named test, confirm it fails
  for the stated reason, restore, then confirm `git diff --exit-code` on the file.
- **Repo text files use CRLF line endings.** After creating a file, convert it:
  `python -c "p='<path>'; b=open(p,'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'); open(p,'wb').write(b)"`.
- **Colors are `#RRGGBB`** everywhere: data files, API and DB. No CSS variables in category
  colors.
- **`uncategorized` must exist** in `apps/api/services/events/categories.json`.
- **User category ids start with `user-`.** Built-in ids never do.
- **User event ids are `user-<n>`,** from `INTEGER PRIMARY KEY AUTOINCREMENT` (never reused).
- **Rule event ids are `<rule_id>-<YYYY-MM-DD>`.** File event ids are the committed ids.
- **Source rules:**
  - Required and non-empty for file events and rules.
  - Optional for user events, but an `http(s)://` URL with a host when given.
- **Lengths:** label 1–120 characters after stripping; note 0–2000.
- **Dates are ISO `YYYY-MM-DD`,** matched by regex first. Python 3.13's `date.fromisoformat`
  also accepts `20260228`. `end_date >= start_date`.
- **pytest makes no network calls** (`tests/conftest.py::_forbid_network`). `exchange_calendars`
  is offline.
- **Only one Playwright run at a time** (fixed ports 8110/3101). Never change the branch of a
  checkout while a run is going (`docs/git-worktrees.md` §4).
- **An event overlay must never take a price chart down.** Failures show `Events unavailable`;
  they never throw into the chart.
- **Never pass a fresh `[]` literal as an array prop to `TVChart`.** Use stable module-level
  empties (`NO_LINE_SERIES`, `NO_EVENTS`); its setup effect depends on identity, and a rebuild
  discards zoom.
- **Run Python with the `moneyview` env,** from the worktree root:
  `C:\Users\eajwa\anaconda3\envs\moneyview\python.exe -m pytest ...`. In a worktree, set
  `$env:PYTHONPATH` to the worktree root first (`docs/git-worktrees.md` §4).

## Deviations from the spec, decided while planning

| Spec says | Plan does | Why |
| --- | --- | --- |
| Shared TS types "regenerated with `scripts/export_schema.py`" | Hand-edit `packages/shared-types/market.ts` | Market contracts were never in `export_schema.py`; `market.ts` is a hand-maintained mirror (see its header). |
| Same-x lines "offset by one bitmap pixel" | Each extra color is drawn immediately right of the previous stripe, offset by one line width | A 1px offset under a 2px-wide line hides most of the second color. |
| Tooltip "Source linked" | The tooltip shows the source's host as text; the Events page links it | The tooltip follows the pointer and disappears when the pointer moves toward it, so a link in it is unreachable. |
| "Server validation messages are shown against their fields" | The server's `detail` is shown in one form-level alert | Every server message already names its field (e.g. `event ends (…) before it starts`); per-field mapping would parse prose. |

## File map

**Part A — registry, sources, categories, data, read routes (PR 1)**
- Modify `pyproject.toml` (add `exchange_calendars>=4.13`)
- Modify `apps/api/models/schema_parts/market.py`, `apps/api/models/schemas.py`
- Modify `packages/shared-types/market.ts`
- Create `apps/api/services/events/__init__.py`: public exports
- Create `apps/api/services/events/validation.py`: `EventDataError` and field checks
- Create `apps/api/services/events/categories.py`: load built-ins; resolve with rows and visibility
- Create `apps/api/services/events/rules.py`: calendar protocol, rule-kind registry,
  `nth_weekday_of_month`, `RuleEventSource`, XNYS adapter
- Create `apps/api/services/events/sources.py`: `EventSource` protocol, `FileEventSource`,
  `event_overlaps`
- Create `apps/api/services/events/registry.py`: `EventRegistry`, `builtin_sources`,
  `resolved_categories`, `default_registry`
- Create `apps/api/services/events/categories.json`, `rules.json`, `geopolitical.json`, `fomc.json`
- Delete `apps/api/services/market_events.py`, `apps/api/services/market_events.json`
- Modify `apps/api/routes/market.py`
- Tests: create `tests/api/events/__init__.py`, `test_validation.py`, `test_categories.py`,
  `test_rules.py`, `test_registry.py`; rewrite `tests/api/test_market_events.py`

**Part B — write routes and SQLite (PR 2)**
- Modify `apps/api/services/db.py` (three tables)
- Create `apps/api/services/events/store.py`: SQL only
- Create `apps/api/services/events/user_source.py`: `UserEventSource`
- Create `apps/api/services/events/service.py`: write semantics and errors
- Modify `apps/api/services/events/registry.py` (DB rows, user source)
- Modify `apps/api/routes/market.py`, `apps/api/models/schema_parts/market.py`,
  `apps/api/models/schemas.py`, `packages/shared-types/market.ts`
- Tests: create `tests/api/events/test_store.py`, `tests/api/test_market_event_routes.py`
- Docs: `docs/architecture/storage-model.md` §3.3

**Part C — charts (PR 3)**
- Modify `apps/web/components/charts/primitives/EventLinesPrimitive.ts`
- Create `apps/web/lib/eventLines.ts`: `buildEventLines`
- Create `apps/web/lib/marketEventsApi.ts`: mutations that keep the server's `detail`
- Rewrite `apps/web/lib/useMarketEvents.ts`
- Create `apps/web/lib/useEventMutations.ts`
- Create `apps/web/components/charts/EventTooltip.tsx`,
  `apps/web/components/charts/EventFilter.tsx`
- Delete `apps/web/components/charts/EventsToggle.tsx`
- Modify `apps/web/components/charts/TVChart.tsx`, `OHLCVChartCard.tsx`,
  `apps/web/components/market/MarketOverviewClient.tsx`, `SpreadsSection.tsx`
- Tests:
  - create `apps/web/tests/e2e/helpers/eventsApiMock.ts`, `helpers/lineColor.ts`
  - create `apps/web/tests/e2e/event-lines-model.spec.ts`, `event-tooltip.spec.ts`,
    `event-filter.spec.ts`
  - modify `market-event-lines.spec.ts`, `detail-chart-stability.spec.ts`,
    `market-spreads.spec.ts`, `helpers/marketPageMock.ts`

**Part D — the Events page (PR 4)**
- Create `apps/web/app/events/page.tsx`, `apps/web/app/events/components/EventsTable.tsx`,
  `EventForm.tsx`, `CategoriesPanel.tsx`
- Modify `apps/web/components/ui/Sidebar.tsx`
- Tests: create `apps/web/tests/e2e/events-page.spec.ts`
- Docs: create `docs/tabs/events-tab.txt`; modify `docs/tabs/index.txt`,
  `guideline/sop/todo.md`

---

# Part A — PR 1: registry, sources, categories, data files, read routes

Start: `git fetch origin && git worktree add .claude/worktrees/events-a -b event-registry origin/renewal`,
then work from that folder with `$env:PYTHONPATH` set to it. Install the dependency into the
env once:
`C:\Users\eajwa\anaconda3\envs\moneyview\python.exe -m pip install "exchange_calendars>=4.13"`.

### Task A1: Contract models and shared validation

**Files:**
- Modify: `pyproject.toml` (the `dependencies` list)
- Modify: `apps/api/models/schema_parts/market.py` (`MarketEvent`, near line 186)
- Modify: `apps/api/models/schemas.py:66` (import) and `__all__` (near line 155)
- Modify: `packages/shared-types/market.ts` (`MarketEvent`)
- Create: `apps/api/services/events/__init__.py` (empty for now), `apps/api/services/events/validation.py`
- Test: `tests/api/events/__init__.py` (empty), `tests/api/events/test_validation.py`

**Interfaces:**
- Produces (Python):
  - `MarketEvent(id, label, category, start_date, end_date=None, source=None, note="", origin="builtin", missing_category=None)`
  - `EventCategory(id, label, color, origin, visible=True, overridden=False)`
  - `EventDataError(ValueError)`
  - `LABEL_MAX = 120`, `NOTE_MAX = 2000`
  - `parse_iso_date(value: str, *, what: str) -> date`
  - `check_date_range(start: str, end: str | None, *, what: str) -> None`
  - `check_color(value: str, *, what: str) -> None`
  - `check_label(value: str, *, what: str) -> None`
  - `check_note(value: str, *, what: str) -> None`
  - `check_source(value: str | None, *, required: bool, what: str) -> None`
- Produces (TS): `EventOrigin`, `MarketEvent` (with `source: string | null`, `origin`, `missing_category`), `EventCategory`

- [ ] **Step 1: Write the failing tests**

`tests/api/events/test_validation.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/events/test_validation.py -q`
Expected: collection error, `ModuleNotFoundError: No module named 'apps.api.services.events'` (or `...validation`).

- [ ] **Step 3: Add the dependency, models, TS mirror and validation module**

`pyproject.toml`: add `"exchange_calendars>=4.13",` after `"cachetools>=5.3.3",` in `dependencies`.

`apps/api/models/schema_parts/market.py`: replace the `MarketEvent` class with the block below.
Add `Literal` to the file's `typing` import if it is not already there.

```python
EventOrigin = Literal["builtin", "rule", "user"]


class MarketEvent(BaseModel):
    """A dated event drawn as a vertical line on price charts.

    Built-in and rule events are asserted facts and carry a source; a user's own event may not,
    and `origin` is what lets the chart say so rather than presenting it as checked. See
    `apps.api.services.events`.

    `missing_category` is set only on a user event whose category was removed from the
    built-in file: the event is then served as `uncategorized` and keeps the old id here, so
    the Events page can ask for a new one instead of the event silently changing meaning.
    """

    id: str
    label: str
    category: str
    start_date: str
    end_date: Optional[str] = None
    source: Optional[str] = None
    note: str = ""
    origin: EventOrigin = "builtin"
    missing_category: Optional[str] = None


class EventCategory(BaseModel):
    """A category after resolution: file defaults, then saved overrides, then visibility.

    `visible` is a per-machine display preference (the global chart filter), not part of the
    category's definition. `overridden` is true only when a saved override makes a built-in's
    label or colour differ from its file default.
    """

    id: str
    label: str
    color: str
    origin: Literal["builtin", "user"]
    visible: bool = True
    overridden: bool = False
```

`apps/api/models/schemas.py`: add `EventCategory` to the `from .schema_parts.market import ...`
line (line 66), and `"EventCategory",` to `__all__` next to `"MarketEvent",`.

`packages/shared-types/market.ts`: replace the `MarketEvent` doc comment and interface with:

```ts
/** Where an event came from. Decides whether it can be edited and what the tooltip says. */
export type EventOrigin = "builtin" | "rule" | "user";

/**
 * A dated event drawn as a vertical line on price charts.
 *
 * Mirrors `MarketEvent` in `apps/api/models/schema_parts/market.py`.
 *
 * `source` is non-null for `builtin` and `rule` events -- the backend refuses them without one --
 * and may be null only for a user's own event, which the tooltip then labels as unsourced.
 * `missing_category` is set only on a user event whose category no longer exists; `category`
 * is then `uncategorized`.
 */
export interface MarketEvent {
  id: string;
  label: string;
  category: string;
  start_date: string;
  end_date: string | null;
  source: string | null;
  note: string;
  origin: EventOrigin;
  missing_category: string | null;
}

/** A resolved event category. Mirrors `EventCategory`. `visible` is the global chart filter. */
export interface EventCategory {
  id: string;
  label: string;
  /** `#RRGGBB`. */
  color: string;
  origin: "builtin" | "user";
  visible: boolean;
  overridden: boolean;
}
```

`apps/api/services/events/validation.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/events/test_validation.py -q`
Expected: all pass.

Then run the existing suite for the files the model touched:
`python -m pytest tests/api/test_market_events.py -q`. Expected: all pass. The loader still
exists at this point and `source` being optional does not affect it.

- [ ] **Step 5: Mutation check**

1. In `parse_iso_date`, delete the `_ISO_DATE.fullmatch` condition, leaving only the
   `isinstance` check. Run `python -m pytest tests/api/events/test_validation.py -q -k non_iso`.
   Expected: FAIL for `20260228`. Restore.
2. In `check_source`, add `"ftp"` to `{"http", "https"}`. Run `-k http_url_with_a_host`.
   Expected: FAIL for `ftp://example.com/a`. (`javascript:alert(1)` would not prove the scheme
   check: it has no host, so the host rule rejects it anyway.) Restore.
3. `git diff --exit-code apps/api/services/events/validation.py`.

- [ ] **Step 6: Convert line endings and commit**

```bash
git add pyproject.toml apps/api/models/schema_parts/market.py apps/api/models/schemas.py packages/shared-types/market.ts apps/api/services/events/__init__.py apps/api/services/events/validation.py tests/api/events/__init__.py tests/api/events/test_validation.py
git commit -m "feat(events): event contract models and shared validation"
```

### Task A2: Category loading and resolution

**Files:**
- Create: `apps/api/services/events/categories.py`
- Test: `tests/api/events/test_categories.py`

**Interfaces:**
- Consumes: `EventCategory`, `EventDataError`, `check_color`, `check_label` (A1)
- Produces:
  - `REQUIRED_CATEGORY = "uncategorized"`, `USER_PREFIX = "user-"`
  - `CategoryRow(id: str, kind: Literal["override", "user"], label: str | None, color: str | None)` (frozen dataclass)
  - `load_builtin_categories(path: Path) -> dict[str, EventCategory]` (file order)
  - `resolve_categories(builtins: Mapping[str, EventCategory], rows: Iterable[CategoryRow], visibility: Mapping[str, bool]) -> dict[str, EventCategory]`

- [ ] **Step 1: Write the failing tests**

`tests/api/events/test_categories.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/events/test_categories.py -q`
Expected: `ModuleNotFoundError: No module named 'apps.api.services.events.categories'`.

- [ ] **Step 3: Implement**

`apps/api/services/events/categories.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/events/test_categories.py -q`
Expected: all pass.

- [ ] **Step 5: Mutation check**

1. Replace `if default is None: ... continue` with
   `default = default or EventCategory(id=row.id, label=row.label or row.id, color=row.color or "#000000", origin="builtin")`,
   so an override creates a category. Run `-k no_longer_in_the_file`. Expected: FAIL. Restore.
2. Change `"overridden": (label, color.upper()) != (...)` to `"overridden": True`. Run
   `-k equal_to_the_file`. Expected: FAIL. Restore.
3. Change `if category_id in resolved:` in the visibility loop to always assign by building an
   `EventCategory` for unknown ids. Run `-k unknown_ids`. Expected: FAIL. Restore.
4. `git diff --exit-code apps/api/services/events/categories.py`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/events/categories.py tests/api/events/test_categories.py
git commit -m "feat(events): category defaults and normative resolution"
```

### Task A3: Rule events and the trading calendar

**Files:**
- Create: `apps/api/services/events/rules.py`
- Test: `tests/api/events/test_rules.py`

**Interfaces:**
- Consumes: `MarketEvent`, `EventDataError`, `parse_iso_date`, `check_label`, `check_note`, `check_source` (A1)
- Produces:
  - `TradingCalendar` protocol: `first_session() -> date`, `last_session() -> date`,
    `is_session(day: date) -> bool`, `previous_session(day: date) -> date`
  - `RuleGenerator = Callable[[Mapping[str, Any], TradingCalendar, date, date], list[date]]`
  - `register_rule_kind(name: str, generator: RuleGenerator) -> None`
  - `nth_weekday_of_month` (registered as `"nth_weekday_of_month"`)
  - `RuleEventSource(rule: Mapping[str, Any], calendar: TradingCalendar, *, where: str)` with
    `.name: str` and `.events(start: date | None, end: date | None) -> list[MarketEvent]`
  - `exchange_calendar(code: str = "XNYS") -> TradingCalendar` (cached)

- [ ] **Step 1: Write the failing tests**

`tests/api/events/test_rules.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/events/test_rules.py -q`
Expected: `ModuleNotFoundError: ... events.rules`.

- [ ] **Step 3: Implement**

`apps/api/services/events/rules.py`:

```python
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
            if not start <= day <= end:
                continue
            if not calendar.is_session(day):
                day = calendar.previous_session(day)
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/events/test_rules.py -q`
Expected: all pass. The XNYS test takes a few seconds.

- [ ] **Step 5: Mutation check**

1. In `nth_weekday_of_month`, delete the two lines
   `if not calendar.is_session(day): day = calendar.previous_session(day)`.
   Run `-k "closed_friday or juneteenth"`. Expected: both FAIL (`2026-06-19` instead of
   `2026-06-18`). Restore.
2. In `RuleEventSource.events`, drop `self._calendar.last_session()` from the `min(...)`.
   Run `-k past_calendar_coverage`. Expected: FAIL (dates past 1 Jul 2026 appear). Restore.
3. Delete `self._from` from the `max(...)`. Run `-k before_the_rule_from`. Expected: FAIL.
   Restore.
4. `git diff --exit-code apps/api/services/events/rules.py`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/events/rules.py tests/api/events/test_rules.py
git commit -m "feat(events): data-driven rule events with an injected trading calendar"
```

### Task A4: File source, registry, and event-category resolution

**Files:**
- Create: `apps/api/services/events/sources.py`, `apps/api/services/events/registry.py`
- Modify: `apps/api/services/events/__init__.py`
- Test: `tests/api/events/test_registry.py`

**Interfaces:**
- Consumes: A1–A3
- Produces:
  - `EventSource` protocol (`name: str`, `events(start: date | None, end: date | None) -> list[MarketEvent]`)
  - `event_overlaps(event: MarketEvent, start: date | None, end: date | None) -> bool`
  - `FileEventSource(path: Path)`
  - `EVENTS_DIR: Path`, `CATEGORIES_FILE = "categories.json"`, `RULES_FILE = "rules.json"`
  - `EventRegistry(sources: Iterable[EventSource], categories: Callable[[], Mapping[str, EventCategory]])`
    with `.register(source)` and `.events(start=None, end=None) -> list[MarketEvent]`
  - `builtin_sources(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> list[EventSource]`
  - `resolved_categories(events_dir: Path | None = None) -> dict[str, EventCategory]`
  - `default_registry(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> EventRegistry`
  - `apps.api.services.events` re-exports `EventDataError`, `EventRegistry`, `EventSource`,
    `default_registry`, `resolved_categories`, `register_rule_kind`

- [ ] **Step 1: Write the failing tests**

`tests/api/events/test_registry.py`:

```python
"""The registry merges sources and resolves every event's category (spec §1 steps 5-6)."""

import json
from datetime import date

import pytest

from apps.api.models.schemas import EventCategory, MarketEvent
from apps.api.services.events.registry import EventRegistry, default_registry
from apps.api.services.events.sources import FileEventSource
from apps.api.services.events.validation import EventDataError
from tests.api.events.test_rules import QUAD, FakeCalendar

CATEGORIES = {
    "geopolitical": EventCategory(id="geopolitical", label="Geopolitical", color="#E8A028", origin="builtin"),
    "uncategorized": EventCategory(id="uncategorized", label="Uncategorized", color="#9DA5A2", origin="builtin"),
    "user-mine": EventCategory(id="user-mine", label="Mine", color="#4589E5", origin="user"),
}


def _event(**overrides):
    base = {
        "id": "test-event", "label": "Test event", "category": "geopolitical",
        "start_date": "2026-02-28", "end_date": None, "source": "https://example.com/timeline", "note": "",
    }
    base.update(overrides)
    return base


def _file(tmp_path, events, name="events.json"):
    path = tmp_path / name
    path.write_text(json.dumps({"events": events}), encoding="utf-8")
    return path


class StubSource:
    def __init__(self, name, events):
        self.name = name
        self._events = [MarketEvent(**event) for event in events]

    def events(self, start, end):
        return list(self._events)


def _registry(*sources):
    return EventRegistry(sources, lambda: CATEGORIES)


# --- file source ---------------------------------------------------------------------------

def test_a_file_event_is_served_as_builtin_even_if_the_file_claims_otherwise(tmp_path):
    [event] = FileEventSource(_file(tmp_path, [_event(origin="user")])).events(None, None)

    assert event.origin == "builtin"


def test_an_unsourced_file_event_is_refused_naming_the_event(tmp_path):
    with pytest.raises(EventDataError) as excinfo:
        FileEventSource(_file(tmp_path, [_event(source="")])).events(None, None)

    assert "source" in str(excinfo.value)
    assert "test-event" in str(excinfo.value)


@pytest.mark.parametrize("override", [{"start_date": "28-02-2026"}, {"end_date": "2026-02-01"}, {"label": " "}])
def test_a_malformed_file_event_is_refused(tmp_path, override):
    with pytest.raises(EventDataError, match="test-event"):
        FileEventSource(_file(tmp_path, [_event(**override)])).events(None, None)


def test_the_range_keeps_events_that_overlap_it(tmp_path):
    source = FileEventSource(_file(tmp_path, [
        _event(id="before", start_date="2026-01-10"),
        _event(id="spanning", start_date="2026-01-20", end_date="2026-02-05"),
        _event(id="inside", start_date="2026-02-10"),
        _event(id="after", start_date="2026-03-10"),
    ]))

    assert [e.id for e in source.events(date(2026, 2, 1), date(2026, 2, 28))] == ["spanning", "inside"]


# --- registry ------------------------------------------------------------------------------

def test_the_registry_merges_sources_sorted_by_date_then_id():
    registry = _registry(
        StubSource("a", [_event(id="b-late", start_date="2026-03-02"), _event(id="z-early", start_date="2026-01-02")]),
        StubSource("b", [_event(id="a-late", start_date="2026-03-02")]),
    )

    assert [e.id for e in registry.events()] == ["z-early", "a-late", "b-late"]


def test_a_duplicate_id_across_sources_is_refused_naming_both():
    registry = _registry(StubSource("first", [_event()]), StubSource("second", [_event()]))

    with pytest.raises(EventDataError) as excinfo:
        registry.events()

    assert "first" in str(excinfo.value) and "second" in str(excinfo.value)


def test_register_adds_a_source_without_other_changes():
    registry = _registry(StubSource("a", [_event(id="one")]))
    registry.register(StubSource("b", [_event(id="two", start_date="2026-03-01")]))

    assert [e.id for e in registry.events()] == ["one", "two"]


@pytest.mark.parametrize("category", ["no-such-category", "user-mine"])
def test_a_builtin_event_naming_an_unresolved_or_user_category_is_refused(category):
    registry = _registry(StubSource("file x", [_event(category=category)]))

    with pytest.raises(EventDataError, match=category):
        registry.events()


def test_a_rule_event_naming_an_unknown_category_is_refused():
    registry = _registry(StubSource("rule x", [_event(origin="rule", category="quad-witching")]))

    with pytest.raises(EventDataError, match="quad-witching"):
        registry.events()


def test_a_user_event_whose_category_is_gone_falls_back_to_uncategorized():
    registry = _registry(StubSource("user", [_event(id="user-1", origin="user", category="quad-witching", source=None)]))

    [event] = registry.events()

    assert event.category == "uncategorized"
    assert event.missing_category == "quad-witching"


def test_a_user_event_in_an_existing_category_is_unchanged():
    registry = _registry(StubSource("user", [_event(id="user-1", origin="user", category="user-mine", source=None)]))

    [event] = registry.events()

    assert (event.category, event.missing_category) == ("user-mine", None)


# --- default registry over a folder --------------------------------------------------------

def _events_dir(tmp_path, *, rules=None, categories=None):
    (tmp_path / "categories.json").write_text(json.dumps({"categories": categories or [
        {"id": "geopolitical", "label": "Geopolitical", "color": "#E8A028"},
        {"id": "quad-witching", "label": "Quadruple witching", "color": "#7C5CFF"},
        {"id": "uncategorized", "label": "Uncategorized", "color": "#9DA5A2"},
    ]}), encoding="utf-8")
    if rules is not None:
        (tmp_path / "rules.json").write_text(json.dumps({"rules": rules}), encoding="utf-8")
    return tmp_path


def test_every_event_file_and_rule_in_the_folder_is_a_source(tmp_path):
    folder = _events_dir(tmp_path, rules=[QUAD])
    _file(folder, [_event(id="iran")], name="geopolitical.json")

    events = default_registry(folder, FakeCalendar()).events(date(2026, 1, 1), date(2026, 3, 31))

    assert [e.id for e in events] == ["iran", "quad-witching-2026-03-20"]


def test_a_folder_with_no_event_files_yields_no_events(tmp_path):
    assert default_registry(_events_dir(tmp_path), FakeCalendar()).events() == []
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/events/test_registry.py -q`
Expected: `ModuleNotFoundError: ... events.registry` (or `.sources`).

- [ ] **Step 3: Implement**

`apps/api/services/events/sources.py`:

```python
"""Event sources: anything that returns events for a date range.

A new kind of source (an economic-calendar API, say) is a class with `name` and `events`,
registered with `EventRegistry.register`. Nothing else changes.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Protocol

from apps.api.models.schemas import MarketEvent
from apps.api.services.events.validation import check_date_range, check_label, check_note, check_source


class EventSource(Protocol):
    name: str

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]: ...


def event_overlaps(event: MarketEvent, start: date | None, end: date | None) -> bool:
    first = event.start_date
    last = event.end_date or event.start_date
    if start is not None and last < start.isoformat():
        return False
    if end is not None and first > end.isoformat():
        return False
    return True


class FileEventSource:
    """One committed JSON file of asserted events. Every event must cite a source."""

    def __init__(self, path: Path):
        self.path = path
        self.name = f"file {path.name}"

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]:
        payload = json.loads(self.path.read_text(encoding="utf-8"))
        events: list[MarketEvent] = []
        for raw in payload.get("events", []):
            # A committed file cannot claim to be a user's event or carry a resolution result.
            event = MarketEvent(**{**raw, "origin": "builtin", "missing_category": None})
            what = f"market event {event.id!r} in {self.path}"
            check_label(event.label, what=what)
            check_note(event.note, what=what)
            check_source(event.source, required=True, what=what)
            check_date_range(event.start_date, event.end_date, what=what)
            if event_overlaps(event, start, end):
                events.append(event)
        return events
```

`apps/api/services/events/registry.py`:

```python
"""The event registry: merges every source and resolves each event's category.

Extending by data (no code): add an events/<name>.json file, a rules.json entry using an
existing kind, or a category in categories.json. Extending by code (no edits to existing code):
`EventRegistry.register(source)` or `register_rule_kind(name, generator)`.

Category resolution for events (spec §1, steps 5-6):
  - a built-in or rule event must name a built-in category, or this raises -- a committed
    mistake that tests catch before merge
  - a user event whose category no longer exists is served as `uncategorized` with
    `missing_category` set, because the user cannot fix a data file and a `git pull` must not
    break their events
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Callable, Iterable, Mapping

from apps.api.models.schemas import EventCategory, MarketEvent
from apps.api.services.events.categories import REQUIRED_CATEGORY, load_builtin_categories, resolve_categories
from apps.api.services.events.rules import RuleEventSource, TradingCalendar, exchange_calendar
from apps.api.services.events.sources import EventSource, FileEventSource
from apps.api.services.events.validation import EventDataError

EVENTS_DIR = Path(__file__).resolve().parent
CATEGORIES_FILE = "categories.json"
RULES_FILE = "rules.json"


def _events_dir(events_dir: Path | None) -> Path:
    # Read the module attribute at call time, so tests can point it at a temporary folder.
    return events_dir if events_dir is not None else EVENTS_DIR


class EventRegistry:
    def __init__(self, sources: Iterable[EventSource], categories: Callable[[], Mapping[str, EventCategory]]):
        self._sources = list(sources)
        self._categories = categories

    def register(self, source: EventSource) -> None:
        self._sources.append(source)

    def events(self, start: date | None = None, end: date | None = None) -> list[MarketEvent]:
        categories = self._categories()
        produced_by: dict[str, str] = {}
        merged: list[MarketEvent] = []
        for source in self._sources:
            for event in source.events(start, end):
                if event.id in produced_by:
                    raise EventDataError(
                        f"event id {event.id!r} is produced by both {produced_by[event.id]} and {source.name}"
                    )
                produced_by[event.id] = source.name
                merged.append(_resolve_category(event, categories, source.name))
        merged.sort(key=lambda event: (event.start_date, event.id))
        return merged


def _resolve_category(event: MarketEvent, categories: Mapping[str, EventCategory], source_name: str) -> MarketEvent:
    category = categories.get(event.category)
    if event.origin == "user":
        if category is not None:
            return event
        return event.model_copy(update={"category": REQUIRED_CATEGORY, "missing_category": event.category})
    if category is None or category.origin != "builtin":
        raise EventDataError(
            f"{event.origin} event {event.id!r} from {source_name} names category {event.category!r}, "
            f"which is not a built-in category in {CATEGORIES_FILE}"
        )
    return event


def builtin_sources(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> list[EventSource]:
    folder = _events_dir(events_dir)
    sources: list[EventSource] = [
        FileEventSource(path)
        for path in sorted(folder.glob("*.json"))
        if path.name not in {CATEGORIES_FILE, RULES_FILE}
    ]
    rules_path = folder / RULES_FILE
    if rules_path.exists():
        rules = json.loads(rules_path.read_text(encoding="utf-8")).get("rules", [])
        if rules:
            active_calendar = calendar if calendar is not None else exchange_calendar()
            sources.extend(RuleEventSource(rule, active_calendar, where=str(rules_path)) for rule in rules)
    return sources


def resolved_categories(events_dir: Path | None = None) -> dict[str, EventCategory]:
    builtins = load_builtin_categories(_events_dir(events_dir) / CATEGORIES_FILE)
    return resolve_categories(builtins, [], {})


def default_registry(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> EventRegistry:
    return EventRegistry(
        builtin_sources(events_dir, calendar),
        lambda: resolved_categories(events_dir),
    )
```

`apps/api/services/events/__init__.py`:

```python
"""Dated events for price charts: pluggable sources, resolved categories. See registry.py."""

from apps.api.services.events.registry import EventRegistry, default_registry, resolved_categories
from apps.api.services.events.rules import register_rule_kind
from apps.api.services.events.sources import EventSource
from apps.api.services.events.validation import EventDataError

__all__ = [
    "EventDataError",
    "EventRegistry",
    "EventSource",
    "default_registry",
    "register_rule_kind",
    "resolved_categories",
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/events -q`
Expected: all pass.

- [ ] **Step 5: Mutation check**

1. In `_resolve_category`, delete `or category.origin != "builtin"`. Run
   `-k unresolved_or_user_category`. Expected: FAIL for `user-mine`. Restore.
2. In the user branch, replace the fallback with
   `raise EventDataError(f"missing {event.category}")`. Run `-k falls_back_to_uncategorized`.
   Expected: FAIL. Restore.
3. Delete the `if event.id in produced_by:` block. Run `-k duplicate_id`. Expected: FAIL.
   Restore.
4. In `event_overlaps`, change `last < start.isoformat()` to `first < start.isoformat()`.
   Run `-k overlap`. Expected: FAIL (`spanning` is dropped). Restore.
5. `git diff --exit-code apps/api/services/events/`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/events/__init__.py apps/api/services/events/sources.py apps/api/services/events/registry.py tests/api/events/test_registry.py
git commit -m "feat(events): event registry with file sources and category resolution"
```

### Task A5: Built-in data files, read routes, and the old loader's removal

**Files:**
- Create: `apps/api/services/events/categories.json`, `rules.json`, `geopolitical.json`
- Delete: `apps/api/services/market_events.py`, `apps/api/services/market_events.json`
- Modify: `apps/api/routes/market.py:1-44`
- Rewrite: `tests/api/test_market_events.py`
- Modify: `apps/api/models/schema_parts/market.py` (the `MarketEvent` docstring reference to
  `apps.api.services.market_events`, if any remains)

**Interfaces:**
- Consumes: A1–A4
- Produces:
  - `GET /api/v1/market/events?start=&end=` → `MarketEvent[]`; a bad `start` or `end` → 422
  - `GET /api/v1/market/event-categories` → `EventCategory[]`

- [ ] **Step 1: Source the quadruple witching rule**

The rule's `source` must be a page that states both the third-Friday expiration and the
previous-business-day shift for holidays. **Fetch and read it; do not recall it.** In order:

1. CME Group E-mini S&P 500 futures contract specifications, "Termination of Trading", on
   cmegroup.com.
2. The CME Rulebook chapter for E-mini S&P 500 futures (chapter 358), termination-of-trading
   rule.
3. Cboe's SPX options product specifications. Its specifications page does **not** state the
   holiday rule (checked 2026-09-15), so use Cboe only if another Cboe page does.

Record the exact URL and a one-sentence quote in the commit message. If no page states the
holiday shift, stop and report it; do not ship the rule without a source.

- [ ] **Step 2: Write the failing tests**

Replace `tests/api/test_market_events.py` entirely:

```python
"""The committed events and categories, and the read routes that serve them.

Events are asserted facts, so the loader's job is to refuse unsourced or inconsistent ones.
These tests read the COMMITTED files through the real registry: a mistake in a data file fails
here before it merges.
"""

import re
from datetime import date
from urllib.parse import unquote, urlparse

from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.events.registry import (
    CATEGORIES_FILE,
    EVENTS_DIR,
    builtin_sources,
    default_registry,
    resolved_categories,
)
from apps.api.services.events.sources import FileEventSource

client = TestClient(app)

_MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)


def _file_events():
    return [
        event
        for source in builtin_sources()
        if isinstance(source, FileEventSource)
        for event in source.events(None, None)
    ]


def test_the_committed_data_resolves_without_error():
    """Every committed event and rule names a built-in category, ids are unique, and every file
    validates -- the registry raises on any of those, so a clean call is the assertion."""
    assert default_registry().events(), "no committed events at all"


def test_the_committed_file_carries_the_iran_operation_start():
    """A chart marking the wrong day is worse than a chart marking nothing."""
    iran = [event for event in default_registry().events() if "iran" in event.id.lower()]

    assert [event.start_date for event in iran] == ["2026-02-28"]
    assert iran[0].source, "an asserted date with no source is exactly what this forbids"
    assert iran[0].category == "geopolitical"


def test_the_committed_categories_include_the_required_ones_with_hex_colors():
    categories = resolved_categories()

    assert {"fomc", "quad-witching", "geopolitical", "uncategorized"} <= set(categories)
    assert categories["fomc"].color.upper() == "#E54545", "rate decisions were asked for in red"


def test_quad_witching_in_2026_comes_from_the_rule_and_skips_juneteenth():
    events = default_registry().events(date(2026, 1, 1), date(2026, 12, 31))
    quad = [event for event in events if event.category == "quad-witching"]

    assert [event.start_date for event in quad] == ["2026-03-20", "2026-06-18", "2026-09-18", "2026-12-18"]
    assert all(event.origin == "rule" and event.source.startswith("https://") for event in quad)


def test_no_committed_file_source_names_a_different_month_or_year_than_its_event():
    """A source must at least not contradict its own event's date (ERROR-LOG.md 2026-09-13).

    Months are whole words of the URL path, so `mayor` is not May; years are standalone 19xx/20xx.
    Rule events are excluded: their source states a rule, not a date.
    """
    events = _file_events()
    assert events, "no committed file events, so no source was checked"

    for event in events:
        url = urlparse(event.source)
        assert url.scheme == "https", f"{event.id}: source is not an https URL: {event.source!r}"

        dates = [date.fromisoformat(event.start_date)]
        if event.end_date is not None:
            dates.append(date.fromisoformat(event.end_date))
        allowed_months = {_MONTHS[d.month - 1] for d in dates}
        allowed_years = {str(d.year) for d in dates}

        path = unquote(url.path).lower()
        named_months = set(re.split(r"[^a-z]+", path)) & set(_MONTHS)
        named_years = set(re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", path))

        assert named_months <= allowed_months, f"{event.id}: source names {sorted(named_months)}: {event.source}"
        assert named_years <= allowed_years, f"{event.id}: source names {sorted(named_years)}: {event.source}"


def test_the_registry_reads_the_folder_the_categories_file_is_in():
    """If the loader's folder and the committed files drift apart, every test above passes
    against files nothing reads."""
    assert (EVENTS_DIR / CATEGORIES_FILE).exists()


def test_the_events_route_serves_the_committed_events_with_origin():
    response = client.get("/api/v1/market/events")

    assert response.status_code == 200, response.text
    payload = response.json()
    iran = [event for event in payload if event["start_date"] == "2026-02-28"]
    assert iran and iran[0]["origin"] == "builtin"
    assert all(event["source"] for event in payload if event["origin"] != "user")


def test_the_events_route_limits_to_the_requested_range():
    response = client.get("/api/v1/market/events", params={"start": "2026-02-01", "end": "2026-02-28"})

    assert response.status_code == 200, response.text
    assert {event["start_date"][:7] for event in response.json()} == {"2026-02"}


def test_a_malformed_range_is_a_422_naming_the_parameter():
    response = client.get("/api/v1/market/events", params={"start": "20260201"})

    assert response.status_code == 422
    assert "start" in response.text


def test_the_categories_route_serves_resolved_categories():
    response = client.get("/api/v1/market/event-categories")

    assert response.status_code == 200, response.text
    by_id = {category["id"]: category for category in response.json()}
    assert by_id["fomc"] == {
        "id": "fomc", "label": "Fed rate decisions", "color": "#E54545",
        "origin": "builtin", "visible": True, "overridden": False,
    }
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_market_events.py -q`
Expected: failures. `categories.json` does not exist, and `/market/event-categories` is 404.

- [ ] **Step 4: Write the data files**

`apps/api/services/events/categories.json`:

```json
{
  "categories": [
    { "id": "fomc", "label": "Fed rate decisions", "color": "#E54545" },
    { "id": "quad-witching", "label": "Quadruple witching", "color": "#7C5CFF" },
    { "id": "geopolitical", "label": "Geopolitical", "color": "#E8A028" },
    { "id": "uncategorized", "label": "Uncategorized", "color": "#9DA5A2" }
  ]
}
```

`#E8A028` is today's event-line fallback color, so the existing Iran line keeps its look.
`#E54545` is the app's own `--delta-up` red.

`apps/api/services/events/rules.json`, with `<URL from Step 1>` replaced by the verified URL:

```json
{
  "rules": [
    {
      "id": "quad-witching",
      "category": "quad-witching",
      "label": "Quadruple witching",
      "note": "Quarterly expiration of stock index futures, stock index options, stock options and single-stock futures: the third Friday of March, June, September and December, or the previous trading day when that Friday is an exchange holiday.",
      "source": "<URL from Step 1>",
      "kind": "nth_weekday_of_month",
      "months": [3, 6, 9, 12],
      "weekday": "FRI",
      "nth": 3,
      "if_closed": "previous_trading_day",
      "from": "2020-01-01"
    }
  ]
}
```

`apps/api/services/events/geopolitical.json`: `git mv apps/api/services/market_events.json apps/api/services/events/geopolitical.json`.
The content is unchanged.

Then `git rm apps/api/services/market_events.py`.

- [ ] **Step 5: Rewire the routes**

In `apps/api/routes/market.py`:
- Replace `from apps.api.services.market_events import load_market_events` with the imports below.
- Replace `get_market_events` with the two routes below.
- Update the module docstring's route list to add
  `GET /api/market/event-categories  → resolved event categories (colour, visibility)`.

```python
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from apps.api.models.schemas import EventCategory, IndexQuote, MarketEvent, MarketIndexDetail, MarketSpread, StockOHLCV
from apps.api.services.events import EventDataError, default_registry, resolved_categories
from apps.api.services.events.validation import parse_iso_date
```

```python
@router.get("/events", response_model=List[MarketEvent])
def get_market_events(
    start: Optional[str] = Query(default=None, description="ISO date; events ending before it are left out"),
    end: Optional[str] = Query(default=None, description="ISO date; events starting after it are left out"),
):
    """Events from every registered source, with categories resolved.

    Built-in events are read from committed files on every request, so every machine has the
    same ones after a pull and there is nothing to seed.
    """
    try:
        start_day = parse_iso_date(start, what="start") if start else None
        end_day = parse_iso_date(end, what="end") if end else None
    except EventDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return default_registry().events(start_day, end_day)


@router.get("/event-categories", response_model=List[EventCategory])
def get_event_categories():
    """Categories after resolution: file defaults, saved overrides, user categories, visibility."""
    return list(resolved_categories().values())
```

Remove any now-unused import (`List` is still used). Then grep for leftovers:
`grep -rn "market_events" apps tests packages --include=*.py --include=*.ts`. Expected: nothing
except `schema_parts/market.py` prose. Update that docstring to name
`apps.api.services.events`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_market_events.py tests/api/events -q`
Expected: all pass.

- [ ] **Step 7: Mutation check**

1. In `categories.json`, change `fomc`'s color to `#0000FF`. Run
   `-k required_ones_with_hex`. Expected: FAIL. Restore.
2. In `rules.json`, change `"nth": 3` to `"nth": 2`. Run `-k quad_witching_in_2026`.
   Expected: FAIL. Restore.
3. In `geopolitical.json`, change the event's `category` to `geo`. Run
   `-k committed_data_resolves`. Expected: FAIL naming `geo`. Restore.
4. In `get_market_events`, drop `start_day, end_day` from the `events(...)` call. Run
   `-k requested_range`. Expected: FAIL. Restore.
5. `git diff --exit-code apps/api/services/events apps/api/routes/market.py`.

- [ ] **Step 8: Commit**

```bash
git add -A apps/api/services/events apps/api/services/market_events.py apps/api/services/market_events.json apps/api/routes/market.py apps/api/models/schema_parts/market.py tests/api/test_market_events.py
git commit -m "feat(events): built-in categories and rules, read routes over the registry

Quadruple witching source: <URL> -- \"<one-sentence quote>\""
```

### Task A6: FOMC rate decisions, 2020 onward

**Files:**
- Create: `apps/api/services/events/fomc.json`
- Test: `tests/api/events/test_fomc_data.py`

**Interfaces:**
- Consumes: `FileEventSource`, `EVENTS_DIR` (A4)
- Produces: events with id `fomc-YYYY-MM-DD`, category `fomc`, origin `builtin`

**What counts as an event:** every FOMC statement that announced the federal funds target range:
- every scheduled meeting's statement, including decisions to hold;
- the two unscheduled meetings of March 2020 that changed the range (statements dated
  3 Mar 2020 and 15 Mar 2020).

**Not included:** the 2020 notation votes and releases that did not decide the range: 19 Mar
(swap lines), 23 Mar and 31 Mar (facilities), and 27 Aug (the framework statement).

**The date is the statement's release date,** which is the date in its URL
(`monetaryYYYYMMDDa.htm`). **Never use `openmarket.htm`'s table.** It lists **effective** dates,
which fall after the announcement: for example, "March 16" for the cut announced Sunday 15 Mar
2020.

- [ ] **Step 1: Collect the statements (fetch; do not recall)**

1. 2020: `https://www.federalreserve.gov/monetarypolicy/fomchistorical2020.htm`. Checked on
   2026-09-15, it lists statements `monetary20200129a`, `20200303a`, `20200315a`, `20200429a`,
   `20200610a`, `20200729a`, `20200916a`, `20201105a`, `20201216a`, plus the notation votes
   excluded above.
2. 2021 to the latest announcement before today:
   `https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm`. Each meeting's
   "Statement" link is `/newsevents/pressreleases/monetaryYYYYMMDDa.htm`.
3. For **each** statement, fetch the press release and copy the sentence setting the target
   range ("...decided to maintain / lower / raise the target range for the federal funds rate
   to X to Y percent"). Record the range and whether it was maintained, lowered or raised.
4. Cross-check the changes only, not the dates, against the "Federal Funds Rate" table on
   `https://www.federalreserve.gov/monetarypolicy/openmarket.htm`. Every raise or cut must
   appear there with the same size and new level.

- [ ] **Step 2: Write the failing tests**

`tests/api/events/test_fomc_data.py`:

```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `python -m pytest tests/api/events/test_fomc_data.py -q`
Expected: `FileNotFoundError` for `fomc.json`.

- [ ] **Step 4: Write `fomc.json` from Step 1's records**

Use one entry per statement in date order. The first two entries are shown as the exact format
for every entry. Their facts come from the 2020 statements; re-check them in Step 1 like the
rest.

```json
{
  "events": [
    {
      "id": "fomc-2020-01-29",
      "label": "FOMC: hold at 1.50–1.75%",
      "category": "fomc",
      "start_date": "2020-01-29",
      "end_date": null,
      "source": "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200129a.htm",
      "note": "Scheduled meeting, 28–29 January 2020."
    },
    {
      "id": "fomc-2020-03-03",
      "label": "FOMC: cut 50bp to 1.00–1.25%",
      "category": "fomc",
      "start_date": "2020-03-03",
      "end_date": null,
      "source": "https://www.federalreserve.gov/newsevents/pressreleases/monetary20200303a.htm",
      "note": "Unscheduled meeting, 2 March 2020; announced 3 March."
    }
  ]
}
```

Rules for the rest:
- `label` uses an en dash `–` between the bounds, and two decimals on both bounds (`0.00–0.25%`).
- `note` is `Scheduled meeting, <dates>.` or `Unscheduled meeting, <date>.`
- If a statement's URL does not end in `a.htm`, stop. Widen `_URL` in the test deliberately,
  with a comment naming that statement; do not change the URL.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest tests/api/events/test_fomc_data.py tests/api/test_market_events.py -q`
Expected: all pass. The month/year source check also passes: `monetary20200129a` contains no
standalone year.

- [ ] **Step 6: Mutation check**

1. Change `fomc-2020-03-03`'s `start_date` and `id` to `2020-03-04`, keeping the URL. Run
   `-k dated_and_sourced`. Expected: FAIL (the URL date differs). Restore.
2. Change the second entry's label to `FOMC: cut 25bp to 1.00–1.25%`. Run
   `-k follows_from_the_previous`. Expected: FAIL (`label says -25bp but the range moved -50bp`).
   Restore.
3. Add `2020-03-16` as an extra event. Run `-k start_with_the_first`. Expected: FAIL. Restore.
4. `git diff --exit-code apps/api/services/events/fomc.json`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/services/events/fomc.json tests/api/events/test_fomc_data.py
git commit -m "feat(events): FOMC target-range decisions from 2020, sourced to each statement"
```

### Task A7: PR 1 gates

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest -q -p no:cacheprovider`
Expected: every test passes. The count is `renewal`'s count plus this part's new tests, minus the
tests replaced in `test_market_events.py`. Report both numbers in the PR.

- [ ] **Step 2: Frontend type check and full Playwright**

Run in `apps/web`: `npx tsc --noEmit`. Expected: exit 0.

`source: string | null` must not break callers. If it does, fix the caller to handle `null`;
do not revert the type.

Run in `apps/web`: `npx playwright test --reporter=line`. Expected: all pass. Charts are
unchanged in this part, and the real API now serves `origin` on events.

- [ ] **Step 3: Push and open PR 1**

`git push -u origin event-registry`, then open a PR to `renewal`. The body lists:
- the design sections implemented (spec §1, §2 read routes)
- the mutation checks run per task
- the quadruple witching source with its quote
- how the FOMC data was collected and cross-checked
- the gate results

End the body with the attribution lines.

---

# Part B — PR 2: write routes and SQLite

Start once PR 1 has merged:
`git fetch origin && git worktree add .claude/worktrees/events-b -b event-writes origin/renewal`.

### Task B1: Tables and the store

**Files:**
- Modify: `apps/api/services/db.py` (append to `_CREATE_SCHEMA_SQL` before its closing `"""`)
- Create: `apps/api/services/events/store.py`
- Test: `tests/api/events/test_store.py`

**Interfaces:**
- Consumes: `MarketEvent`, `CategoryRow` (A1, A2)
- Produces:
  - `MarketEventInput` and `EventCategoryInput` / `EventCategoryPatch` (Pydantic, `extra="forbid"`; defined in this task's Step 3)
  - `list_user_events(conn) -> list[MarketEvent]`
  - `get_user_event(conn, number: int) -> MarketEvent | None`
  - `insert_user_event(conn, payload: MarketEventInput) -> MarketEvent`
  - `update_user_event(conn, number: int, payload: MarketEventInput) -> MarketEvent | None`
  - `delete_user_event(conn, number: int) -> bool`
  - `count_user_events_in_category(conn, category_id: str) -> int`
  - `list_category_rows(conn) -> list[CategoryRow]`
  - `list_visibility(conn) -> dict[str, bool]`
  - `upsert_category_override(conn, category_id: str, *, label: str | None, color: str | None) -> None`
  - `delete_category_override(conn, category_id: str) -> None`
  - `insert_user_category(conn, category_id: str, label: str, color: str) -> None`
  - `update_user_category(conn, category_id: str, *, label: str | None, color: str | None) -> None`
  - `delete_user_category(conn, category_id: str) -> None` (also removes its visibility row)
  - `set_visibility(conn, category_id: str, visible: bool) -> None`

- [ ] **Step 1: Write the failing tests**

`tests/api/events/test_store.py`:

```python
"""SQL for user events, category rows and visibility. `_isolated_db` gives each test its own file."""

from apps.api.models.schemas import MarketEventInput
from apps.api.services.db import get_db
from apps.api.services.events import store
from apps.api.services.events.categories import CategoryRow


def _input(**overrides):
    return MarketEventInput(**{"label": "Bought AAPL", "category": "geopolitical", "start_date": "2026-03-02", **overrides})


def test_a_user_event_round_trips_with_user_origin_and_prefixed_id():
    with get_db() as conn:
        created = store.insert_user_event(conn, _input(source="", note="first lot"))
        listed = store.list_user_events(conn)

    assert created.id.startswith("user-") and created.origin == "user"
    assert created.source is None, "a blank source is stored as absent, not as an empty citation"
    assert listed == [created]


def test_a_deleted_user_event_id_is_never_reused():
    # AUTOINCREMENT: without it SQLite reuses the largest rowid after that row is deleted, so a
    # new event could take the id of one the page still shows as deleted.
    with get_db() as conn:
        first = store.insert_user_event(conn, _input())
        assert store.delete_user_event(conn, int(first.id.removeprefix("user-")))
        second = store.insert_user_event(conn, _input())

    assert second.id != first.id


def test_update_and_delete_report_a_missing_row():
    with get_db() as conn:
        assert store.update_user_event(conn, 999, _input()) is None
        assert store.delete_user_event(conn, 999) is False


def test_an_override_upsert_keeps_the_field_it_was_not_given():
    with get_db() as conn:
        store.upsert_category_override(conn, "fomc", label=None, color="#0000FF")
        store.upsert_category_override(conn, "fomc", label="Rates", color=None)
        rows = store.list_category_rows(conn)

    assert rows == [CategoryRow(id="fomc", kind="override", label="Rates", color="#0000FF")]


def test_deleting_a_user_category_removes_its_visibility_row():
    with get_db() as conn:
        store.insert_user_category(conn, "user-mine", "Mine", "#4589E5")
        store.set_visibility(conn, "user-mine", False)
        store.delete_user_category(conn, "user-mine")

        assert store.list_category_rows(conn) == []
        assert store.list_visibility(conn) == {}


def test_visibility_is_an_upsert():
    with get_db() as conn:
        store.set_visibility(conn, "fomc", False)
        store.set_visibility(conn, "fomc", True)

        assert store.list_visibility(conn) == {"fomc": True}


def test_events_in_a_category_are_counted():
    with get_db() as conn:
        store.insert_user_event(conn, _input(category="user-mine"))
        store.insert_user_event(conn, _input(category="user-mine"))
        store.insert_user_event(conn, _input(category="geopolitical"))

        assert store.count_user_events_in_category(conn, "user-mine") == 2
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/events/test_store.py -q`
Expected: `ImportError` for `MarketEventInput` or `store`.

- [ ] **Step 3: Implement the tables, input models and store**

Append to `_CREATE_SCHEMA_SQL` in `apps/api/services/db.py`. New tables need no compatibility
migration, because `init_db` runs the whole script on every start.

```sql
-- ============================================================
-- Market events: the user's own events, category overrides and user categories, and the
-- global chart filter. Built-in events and categories are NOT here -- they are read from
-- committed files on every request (apps/api/services/events).
-- ============================================================
CREATE TABLE IF NOT EXISTS user_event (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,  -- AUTOINCREMENT: a deleted id is never reused
    label       TEXT NOT NULL,
    category    TEXT NOT NULL,
    start_date  TEXT NOT NULL,
    end_date    TEXT,
    source      TEXT,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS event_category (
    id          TEXT PRIMARY KEY,
    kind        TEXT NOT NULL CHECK (kind IN ('override', 'user')),
    label       TEXT,
    color       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS event_category_visibility (
    category_id TEXT PRIMARY KEY,
    visible     INTEGER NOT NULL CHECK (visible IN (0, 1))
);
```

In `apps/api/models/schema_parts/market.py`, after `EventCategory`, add these. Add `ConfigDict`
to the pydantic import.

```python
class MarketEventInput(BaseModel):
    """A user event as submitted. `origin` and `id` are the server's, so they are forbidden here."""

    model_config = ConfigDict(extra="forbid")

    label: str
    category: str
    start_date: str
    end_date: Optional[str] = None
    source: Optional[str] = None
    note: str = ""


class EventCategoryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    color: str


class EventCategoryPatch(BaseModel):
    """Only the fields present in the request change; absent ones are left as they are."""

    model_config = ConfigDict(extra="forbid")

    label: Optional[str] = None
    color: Optional[str] = None
    visible: Optional[bool] = None
```

Export all three from `apps/api/models/schemas.py`, in the import line and `__all__`.

`apps/api/services/events/store.py`:

```python
"""SQL for user events, category rows and visibility. No validation here: service.py does it."""

from __future__ import annotations

import sqlite3

from apps.api.models.schemas import MarketEvent, MarketEventInput
from apps.api.services.events.categories import CategoryRow

USER_EVENT_PREFIX = "user-"


def _blank_to_none(value: str | None) -> str | None:
    return value.strip() if value and value.strip() else None


def _to_event(row: sqlite3.Row) -> MarketEvent:
    return MarketEvent(
        id=f"{USER_EVENT_PREFIX}{row['id']}",
        label=row["label"],
        category=row["category"],
        start_date=row["start_date"],
        end_date=row["end_date"],
        source=row["source"],
        note=row["note"],
        origin="user",
    )


def list_user_events(conn: sqlite3.Connection) -> list[MarketEvent]:
    return [_to_event(row) for row in conn.execute("SELECT * FROM user_event ORDER BY start_date, id").fetchall()]


def get_user_event(conn: sqlite3.Connection, number: int) -> MarketEvent | None:
    row = conn.execute("SELECT * FROM user_event WHERE id = ?", (number,)).fetchone()
    return _to_event(row) if row else None


def _values(payload: MarketEventInput) -> tuple:
    return (
        payload.label.strip(),
        payload.category,
        payload.start_date,
        payload.end_date,
        _blank_to_none(payload.source),
        payload.note.strip(),
    )


def insert_user_event(conn: sqlite3.Connection, payload: MarketEventInput) -> MarketEvent:
    cursor = conn.execute(
        "INSERT INTO user_event (label, category, start_date, end_date, source, note) VALUES (?, ?, ?, ?, ?, ?)",
        _values(payload),
    )
    return get_user_event(conn, cursor.lastrowid)


def update_user_event(conn: sqlite3.Connection, number: int, payload: MarketEventInput) -> MarketEvent | None:
    cursor = conn.execute(
        "UPDATE user_event SET label = ?, category = ?, start_date = ?, end_date = ?, source = ?, note = ? WHERE id = ?",
        (*_values(payload), number),
    )
    return get_user_event(conn, number) if cursor.rowcount else None


def delete_user_event(conn: sqlite3.Connection, number: int) -> bool:
    return conn.execute("DELETE FROM user_event WHERE id = ?", (number,)).rowcount > 0


def count_user_events_in_category(conn: sqlite3.Connection, category_id: str) -> int:
    return conn.execute("SELECT COUNT(*) FROM user_event WHERE category = ?", (category_id,)).fetchone()[0]


def list_category_rows(conn: sqlite3.Connection) -> list[CategoryRow]:
    rows = conn.execute("SELECT id, kind, label, color FROM event_category ORDER BY created_at, id").fetchall()
    return [CategoryRow(id=row["id"], kind=row["kind"], label=row["label"], color=row["color"]) for row in rows]


def list_visibility(conn: sqlite3.Connection) -> dict[str, bool]:
    rows = conn.execute("SELECT category_id, visible FROM event_category_visibility").fetchall()
    return {row["category_id"]: bool(row["visible"]) for row in rows}


def upsert_category_override(conn: sqlite3.Connection, category_id: str, *, label: str | None, color: str | None) -> None:
    conn.execute(
        """INSERT INTO event_category (id, kind, label, color) VALUES (?, 'override', ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             label = COALESCE(excluded.label, event_category.label),
             color = COALESCE(excluded.color, event_category.color)""",
        (category_id, label, color),
    )


def delete_category_override(conn: sqlite3.Connection, category_id: str) -> None:
    conn.execute("DELETE FROM event_category WHERE id = ? AND kind = 'override'", (category_id,))


def insert_user_category(conn: sqlite3.Connection, category_id: str, label: str, color: str) -> None:
    conn.execute("INSERT INTO event_category (id, kind, label, color) VALUES (?, 'user', ?, ?)", (category_id, label, color))


def update_user_category(conn: sqlite3.Connection, category_id: str, *, label: str | None, color: str | None) -> None:
    conn.execute(
        "UPDATE event_category SET label = COALESCE(?, label), color = COALESCE(?, color) WHERE id = ? AND kind = 'user'",
        (label, color, category_id),
    )


def delete_user_category(conn: sqlite3.Connection, category_id: str) -> None:
    conn.execute("DELETE FROM event_category WHERE id = ? AND kind = 'user'", (category_id,))
    conn.execute("DELETE FROM event_category_visibility WHERE category_id = ?", (category_id,))


def set_visibility(conn: sqlite3.Connection, category_id: str, visible: bool) -> None:
    conn.execute(
        """INSERT INTO event_category_visibility (category_id, visible) VALUES (?, ?)
           ON CONFLICT(category_id) DO UPDATE SET visible = excluded.visible""",
        (category_id, int(visible)),
    )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/events/test_store.py tests/api/test_sqlite_schema_validation.py -q`
Expected: all pass.

- [ ] **Step 5: Mutation check**

1. Remove `AUTOINCREMENT` from `user_event.id`. Because `CREATE TABLE IF NOT EXISTS` applies
   only to new files, and each test gets a new file, run `-k never_reused`. Expected: FAIL
   (the same id comes back). Restore.
2. Replace `COALESCE(excluded.color, event_category.color)` with `excluded.color`. Run
   `-k keeps_the_field`. Expected: FAIL. The second, label-only upsert sets color to `None`.
   Restore.
3. Delete the visibility `DELETE` from `delete_user_category`. Run `-k removes_its_visibility`.
   Expected: FAIL. Restore.
4. `git diff --exit-code apps/api/services/db.py apps/api/services/events/store.py`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/db.py apps/api/services/events/store.py apps/api/models/schema_parts/market.py apps/api/models/schemas.py tests/api/events/test_store.py
git commit -m "feat(events): SQLite tables and store for user events, category rows, visibility"
```

### Task B2: User events and saved rows in the registry, and the write service

**Files:**
- Create: `apps/api/services/events/user_source.py`, `apps/api/services/events/service.py`
- Modify: `apps/api/services/events/registry.py` (`resolved_categories`, `default_registry`)

**Interfaces:**
- Consumes: B1 store; A4 registry
- Produces:
  - `UserEventSource()` (`name = "user events"`)
  - `resolved_categories()` now applies DB rows and visibility
  - `default_registry()` now includes `UserEventSource` last
  - `service.EventNotFound(LookupError)`, `service.EventConflict(RuntimeError)`
  - `service.create_user_event(payload: MarketEventInput) -> MarketEvent`
  - `service.update_user_event(event_id: str, payload: MarketEventInput) -> MarketEvent`
  - `service.delete_user_event(event_id: str) -> None`
  - `service.create_user_category(payload: EventCategoryInput) -> EventCategory`
  - `service.patch_category(category_id: str, patch: EventCategoryPatch) -> EventCategory`
  - `service.reset_category(category_id: str) -> None`
  - `service.delete_user_category(category_id: str) -> None`

Tests for this task are the route tests in B3, which exercise the service through HTTP. This
task has no test cycle of its own, so do B2 and B3 together and commit once at the end of B3.

- [ ] **Step 1: Implement the user source**

`apps/api/services/events/user_source.py`:

```python
"""The user's own events, from SQLite. Their category is resolved by the registry (step 6)."""

from __future__ import annotations

from datetime import date

from apps.api.models.schemas import MarketEvent
from apps.api.services.db import get_db
from apps.api.services.events import store
from apps.api.services.events.sources import event_overlaps


class UserEventSource:
    name = "user events"

    def events(self, start: date | None, end: date | None) -> list[MarketEvent]:
        with get_db() as conn:
            events = store.list_user_events(conn)
        return [event for event in events if event_overlaps(event, start, end)]
```

- [ ] **Step 2: Read saved rows in the registry**

In `apps/api/services/events/registry.py`, add
`from apps.api.services.db import get_db` and `from apps.api.services.events import store`.
Add `from apps.api.services.events.user_source import UserEventSource`, then replace the two
functions:

```python
def resolved_categories(events_dir: Path | None = None) -> dict[str, EventCategory]:
    builtins = load_builtin_categories(_events_dir(events_dir) / CATEGORIES_FILE)
    with get_db() as conn:
        rows = store.list_category_rows(conn)
        visibility = store.list_visibility(conn)
    return resolve_categories(builtins, rows, visibility)


def default_registry(events_dir: Path | None = None, calendar: TradingCalendar | None = None) -> EventRegistry:
    return EventRegistry(
        [*builtin_sources(events_dir, calendar), UserEventSource()],
        lambda: resolved_categories(events_dir),
    )
```

`tests/api/events/test_registry.py::test_a_folder_with_no_event_files_yields_no_events` still
passes: the isolated test DB has no user events.

- [ ] **Step 3: Implement the service**

`apps/api/services/events/service.py`:

```python
"""Write semantics for user events and categories. Routes map the three errors to 404/409/422."""

from __future__ import annotations

import re

from apps.api.models.schemas import EventCategory, EventCategoryInput, EventCategoryPatch, MarketEvent, MarketEventInput
from apps.api.services.db import get_db
from apps.api.services.events import registry, store
from apps.api.services.events.categories import USER_PREFIX, load_builtin_categories
from apps.api.services.events.validation import (
    EventDataError,
    check_color,
    check_date_range,
    check_label,
    check_note,
    check_source,
)


class EventNotFound(LookupError):
    pass


class EventConflict(RuntimeError):
    pass


_USER_EVENT_ID = re.compile(r"user-(\d+)")
_NON_SLUG = re.compile(r"[^a-z0-9]+")


def _validate_event(payload: MarketEventInput) -> None:
    what = "event"
    check_label(payload.label, what=what)
    check_note(payload.note, what=what)
    check_source(payload.source, required=False, what=what)
    check_date_range(payload.start_date, payload.end_date, what=what)
    if payload.category not in registry.resolved_categories():
        raise EventDataError(f"event category {payload.category!r} does not exist")


def _user_event_number(event_id: str) -> int:
    match = _USER_EVENT_ID.fullmatch(event_id)
    if match:
        return int(match.group(1))
    if any(event.id == event_id for event in registry.default_registry().events()):
        raise EventConflict(f"built-in events are edited in their data file; {event_id!r} is not a user event")
    raise EventNotFound(f"no event with id {event_id!r}")


def create_user_event(payload: MarketEventInput) -> MarketEvent:
    _validate_event(payload)
    with get_db() as conn:
        return store.insert_user_event(conn, payload)


def update_user_event(event_id: str, payload: MarketEventInput) -> MarketEvent:
    number = _user_event_number(event_id)
    _validate_event(payload)
    with get_db() as conn:
        updated = store.update_user_event(conn, number, payload)
    if updated is None:
        raise EventNotFound(f"no event with id {event_id!r}")
    return updated


def delete_user_event(event_id: str) -> None:
    number = _user_event_number(event_id)
    with get_db() as conn:
        if not store.delete_user_event(conn, number):
            raise EventNotFound(f"no event with id {event_id!r}")


def create_user_category(payload: EventCategoryInput) -> EventCategory:
    what = "category"
    check_label(payload.label, what=what)
    check_color(payload.color, what=what)
    slug = _NON_SLUG.sub("-", payload.label.strip().lower()).strip("-")
    if not slug:
        raise EventDataError("category label must contain a letter or a digit")
    category_id = f"{USER_PREFIX}{slug}"
    if category_id in registry.resolved_categories():
        raise EventDataError(f"a category with id {category_id!r} already exists")
    with get_db() as conn:
        store.insert_user_category(conn, category_id, payload.label.strip(), payload.color)
    return registry.resolved_categories()[category_id]


def patch_category(category_id: str, patch: EventCategoryPatch) -> EventCategory:
    current = registry.resolved_categories().get(category_id)
    if current is None:
        raise EventNotFound(f"no category with id {category_id!r}")
    fields = patch.model_fields_set
    what = f"category {category_id!r}"
    label = color = None
    if "label" in fields:
        check_label(patch.label or "", what=what)
        label = patch.label.strip()
    if "color" in fields:
        check_color(patch.color or "", what=what)
        color = patch.color
    if "visible" in fields and patch.visible is None:
        raise EventDataError(f"{what} visible must be true or false")

    with get_db() as conn:
        if label is not None or color is not None:
            if current.origin == "builtin":
                store.upsert_category_override(conn, category_id, label=label, color=color)
            else:
                store.update_user_category(conn, category_id, label=label, color=color)
        if "visible" in fields:
            store.set_visibility(conn, category_id, patch.visible)
    return registry.resolved_categories()[category_id]


def reset_category(category_id: str) -> None:
    builtins = load_builtin_categories(registry._events_dir(None) / registry.CATEGORIES_FILE)
    if category_id not in builtins:
        if category_id in registry.resolved_categories():
            raise EventConflict(f"{category_id!r} is a user category and has no file default to reset to")
        raise EventNotFound(f"no built-in category with id {category_id!r}")
    with get_db() as conn:
        store.delete_category_override(conn, category_id)


def delete_user_category(category_id: str) -> None:
    current = registry.resolved_categories().get(category_id)
    if current is None:
        raise EventNotFound(f"no category with id {category_id!r}")
    if current.origin == "builtin":
        raise EventConflict(f"{category_id!r} is a built-in category and cannot be deleted")
    with get_db() as conn:
        used = store.count_user_events_in_category(conn, category_id)
        if used:
            raise EventConflict(f"category {category_id!r} is still used by {used} event{'' if used == 1 else 's'}")
        store.delete_user_category(conn, category_id)
```

### Task B3: Write routes

**Files:**
- Modify: `apps/api/routes/market.py`
- Modify: `packages/shared-types/market.ts` (input types)
- Test: `tests/api/test_market_event_routes.py`

**Interfaces:**
- Consumes: B2 service
- Produces:
  - `POST /api/v1/market/events` → 201 `MarketEvent`
  - `PUT /api/v1/market/events/{id}` → 200 `MarketEvent`
  - `DELETE /api/v1/market/events/{id}` → 204
  - `POST /api/v1/market/event-categories` → 201 `EventCategory`
  - `PATCH /api/v1/market/event-categories/{id}` → 200 `EventCategory`
  - `DELETE /api/v1/market/event-categories/{id}/override` → 204
  - `DELETE /api/v1/market/event-categories/{id}` → 204
  - Errors: `404` not found, `409` conflict, `422` invalid, each with `detail` naming the problem
  - TS: `MarketEventInput`, `EventCategoryInput`, `EventCategoryPatch`

- [ ] **Step 1: Write the failing tests**

`tests/api/test_market_event_routes.py`:

```python
"""Write routes for user events and categories, over the committed built-ins.

Each test gets its own SQLite file (`_isolated_db`), and the committed events folder is read
as-is, except in the removed-category test, which points the registry at a copy.
"""

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from apps.api.main import app
from apps.api.services.events import registry

client = TestClient(app)
EVENTS = "/api/v1/market/events"
CATEGORIES = "/api/v1/market/event-categories"


def _create_event(**overrides):
    return client.post(EVENTS, json={"label": "Bought AAPL", "category": "geopolitical", "start_date": "2026-03-02", **overrides})


def _categories():
    return {category["id"]: category for category in client.get(CATEGORIES).json()}


# --- user events ---------------------------------------------------------------------------

def test_a_created_user_event_is_served_with_user_origin_and_no_source():
    response = _create_event()

    assert response.status_code == 201, response.text
    created = response.json()
    assert created["id"].startswith("user-") and created["origin"] == "user" and created["source"] is None
    served = [event for event in client.get(EVENTS).json() if event["id"] == created["id"]]
    assert served == [created]


@pytest.mark.parametrize("overrides, field", [
    ({"category": "no-such-category"}, "category"),
    ({"start_date": "2026-03-02", "end_date": "2026-03-01"}, "before it starts"),
    ({"start_date": "20260302"}, "start_date"),
    ({"label": "   "}, "label"),
    ({"source": "ftp://example.com"}, "http"),
    ({"origin": "builtin"}, "origin"),
])
def test_an_invalid_user_event_is_a_422_naming_the_problem(overrides, field):
    response = _create_event(**overrides)

    assert response.status_code == 422, response.text
    assert field in response.text


def test_a_user_event_can_be_edited_then_deleted():
    event_id = _create_event().json()["id"]

    edited = client.put(f"{EVENTS}/{event_id}", json={"label": "Sold AAPL", "category": "fomc", "start_date": "2026-03-04"})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["label"], edited.json()["category"]) == ("Sold AAPL", "fomc")

    assert client.delete(f"{EVENTS}/{event_id}").status_code == 204
    assert all(event["id"] != event_id for event in client.get(EVENTS).json())


@pytest.mark.parametrize("event_id", ["us-iran-strikes-begin-2026-02-28", "quad-witching-2026-03-20"])
def test_builtin_and_rule_events_cannot_be_edited_or_deleted(event_id):
    body = {"label": "x", "category": "geopolitical", "start_date": "2026-03-02"}

    assert client.put(f"{EVENTS}/{event_id}", json=body).status_code == 409
    response = client.delete(f"{EVENTS}/{event_id}")
    assert response.status_code == 409
    assert "data file" in response.text


def test_an_unknown_event_id_is_a_404():
    assert client.delete(f"{EVENTS}/user-999").status_code == 404
    assert client.delete(f"{EVENTS}/nothing-like-this").status_code == 404


def test_a_deleted_user_event_id_is_not_given_to_the_next_event():
    first = _create_event().json()["id"]
    client.delete(f"{EVENTS}/{first}")

    assert _create_event().json()["id"] != first


# --- categories ----------------------------------------------------------------------------

def test_a_builtin_color_override_marks_the_category_overridden():
    response = client.patch(f"{CATEGORIES}/fomc", json={"color": "#0000FF"})

    assert response.status_code == 200, response.text
    assert (response.json()["color"], response.json()["overridden"]) == ("#0000FF", True)
    assert _categories()["fomc"]["color"] == "#0000FF", "the override persists"


def test_resetting_restores_the_file_color_and_keeps_visibility():
    client.patch(f"{CATEGORIES}/fomc", json={"color": "#0000FF", "visible": False})

    assert client.delete(f"{CATEGORIES}/fomc/override").status_code == 204

    fomc = _categories()["fomc"]
    assert (fomc["color"], fomc["overridden"], fomc["visible"]) == ("#E54545", False, False)


def test_reset_is_idempotent():
    assert client.delete(f"{CATEGORIES}/fomc/override").status_code == 204
    assert client.delete(f"{CATEGORIES}/fomc/override").status_code == 204


def test_reset_is_a_409_for_a_user_category_and_a_404_for_an_unknown_id():
    client.post(CATEGORIES, json={"label": "My trades", "color": "#4589E5"})

    assert client.delete(f"{CATEGORIES}/user-my-trades/override").status_code == 409
    assert client.delete(f"{CATEGORIES}/no-such/override").status_code == 404


def test_a_user_category_gets_a_user_prefixed_id_and_duplicates_are_refused():
    created = client.post(CATEGORIES, json={"label": "My trades!", "color": "#4589E5"})

    assert created.status_code == 201, created.text
    assert created.json() == {
        "id": "user-my-trades", "label": "My trades!", "color": "#4589E5",
        "origin": "user", "visible": True, "overridden": False,
    }
    duplicate = client.post(CATEGORIES, json={"label": "my trades", "color": "#000000"})
    assert duplicate.status_code == 422
    assert "already exists" in duplicate.text


@pytest.mark.parametrize("body", [{"label": "x", "color": "blue"}, {"label": "!!!", "color": "#000000"}])
def test_an_invalid_new_category_is_a_422(body):
    assert client.post(CATEGORIES, json=body).status_code == 422


def test_patching_an_unknown_category_is_a_404():
    assert client.patch(f"{CATEGORIES}/no-such", json={"visible": False}).status_code == 404


def test_a_builtin_category_cannot_be_deleted():
    assert client.delete(f"{CATEGORIES}/fomc").status_code == 409


def test_a_category_in_use_cannot_be_deleted_and_the_message_counts_its_events():
    client.post(CATEGORIES, json={"label": "My trades", "color": "#4589E5"})
    _create_event(category="user-my-trades")
    _create_event(category="user-my-trades")

    response = client.delete(f"{CATEGORIES}/user-my-trades")

    assert response.status_code == 409
    assert "2 events" in response.text


def test_an_unused_user_category_is_deleted():
    client.post(CATEGORIES, json={"label": "My trades", "color": "#4589E5"})

    assert client.delete(f"{CATEGORIES}/user-my-trades").status_code == 204
    assert "user-my-trades" not in _categories()


def test_visibility_persists_across_requests():
    client.patch(f"{CATEGORIES}/geopolitical", json={"visible": False})

    assert _categories()["geopolitical"]["visible"] is False


def test_a_category_removed_from_the_file_is_not_resurrected_and_its_user_events_fall_back(tmp_path, monkeypatch):
    for path in registry.EVENTS_DIR.glob("*.json"):
        shutil.copy(path, tmp_path / path.name)
    monkeypatch.setattr(registry, "EVENTS_DIR", tmp_path)

    client.patch(f"{CATEGORIES}/geopolitical", json={"color": "#0000FF"})
    event_id = _create_event(category="geopolitical").json()["id"]

    # A later commit removes the category, and the file events that used it.
    categories = json.loads((tmp_path / "categories.json").read_text(encoding="utf-8"))
    categories["categories"] = [c for c in categories["categories"] if c["id"] != "geopolitical"]
    (tmp_path / "categories.json").write_text(json.dumps(categories), encoding="utf-8")
    (tmp_path / "geopolitical.json").unlink()

    assert "geopolitical" not in _categories(), "the stale override must not recreate the category"
    response = client.get(EVENTS)
    assert response.status_code == 200, response.text
    [event] = [e for e in response.json() if e["id"] == event_id]
    assert (event["category"], event["missing_category"]) == ("uncategorized", "geopolitical")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_market_event_routes.py -q`
Expected: failures with 405 Method Not Allowed on the write routes.

- [ ] **Step 3: Add the routes**

In `apps/api/routes/market.py`, extend the imports:

```python
from contextlib import contextmanager

from fastapi import APIRouter, Body, HTTPException, Query, Response

from apps.api.models.schemas import (
    EventCategory,
    EventCategoryInput,
    EventCategoryPatch,
    IndexQuote,
    MarketEvent,
    MarketEventInput,
    MarketIndexDetail,
    MarketSpread,
    StockOHLCV,
)
from apps.api.services.events import service as event_service
```

Add after `get_event_categories`:

```python
@contextmanager
def _event_errors():
    try:
        yield
    except event_service.EventNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except event_service.EventConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except EventDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/events", response_model=MarketEvent, status_code=201)
def create_market_event(payload: MarketEventInput = Body(...)):
    with _event_errors():
        return event_service.create_user_event(payload)


@router.put("/events/{event_id}", response_model=MarketEvent)
def update_market_event(event_id: str, payload: MarketEventInput = Body(...)):
    with _event_errors():
        return event_service.update_user_event(event_id, payload)


@router.delete("/events/{event_id}", status_code=204)
def delete_market_event(event_id: str):
    with _event_errors():
        event_service.delete_user_event(event_id)
    return Response(status_code=204)


@router.post("/event-categories", response_model=EventCategory, status_code=201)
def create_event_category(payload: EventCategoryInput = Body(...)):
    with _event_errors():
        return event_service.create_user_category(payload)


@router.patch("/event-categories/{category_id}", response_model=EventCategory)
def patch_event_category(category_id: str, patch: EventCategoryPatch = Body(...)):
    with _event_errors():
        return event_service.patch_category(category_id, patch)


@router.delete("/event-categories/{category_id}/override", status_code=204)
def reset_event_category(category_id: str):
    """Restore a built-in category's file label and colour. Visibility is a preference and stays."""
    with _event_errors():
        event_service.reset_category(category_id)
    return Response(status_code=204)


@router.delete("/event-categories/{category_id}", status_code=204)
def delete_event_category(category_id: str):
    with _event_errors():
        event_service.delete_user_category(category_id)
    return Response(status_code=204)
```

Add the route list lines to the module docstring.

`packages/shared-types/market.ts`, after `EventCategory`:

```ts
/** A user event as submitted. Mirrors `MarketEventInput`; `id` and `origin` are the server's. */
export interface MarketEventInput {
  label: string;
  category: string;
  start_date: string;
  end_date?: string | null;
  source?: string | null;
  note?: string;
}

/** Mirrors `EventCategoryInput`. */
export interface EventCategoryInput {
  label: string;
  /** `#RRGGBB`. */
  color: string;
}

/** Mirrors `EventCategoryPatch`: only the fields present change. */
export interface EventCategoryPatch {
  label?: string;
  color?: string;
  visible?: boolean;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/api/test_market_event_routes.py tests/api/test_market_events.py tests/api/events -q`
Expected: all pass.

- [ ] **Step 5: Mutation check**

1. In `service.reset_category`, change `store.delete_category_override(...)` to `pass`. Run
   `-k resetting_restores`. Expected: FAIL. Restore.
2. In `registry._resolve_category` (from A4), make the user branch raise instead of falling
   back. Run `-k removed_from_the_file`. Expected: FAIL with 500 or an exception. Restore.
3. In `categories.resolve_categories`, create a category for an unknown override id (the A2
   mutation). Run `-k removed_from_the_file`. Expected: FAIL on the "must not recreate"
   assertion. Restore.
4. In `service.delete_user_category`, delete the `if used:` block. Run `-k in_use`. Expected:
   FAIL. Restore.
5. In `service._user_event_number`, remove the `EventConflict` branch. Run
   `-k builtin_and_rule_events`. Expected: FAIL (404 instead of 409). Restore.
6. In `service.patch_category`, drop the `visible` handling. Run `-k visibility_persists`.
   Expected: FAIL. Restore.
7. `git diff --exit-code apps/api`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/services/events/user_source.py apps/api/services/events/service.py apps/api/services/events/registry.py apps/api/routes/market.py packages/shared-types/market.ts tests/api/test_market_event_routes.py
git commit -m "feat(events): write routes for user events and categories, with override reset"
```

### Task B4: Storage docs and PR 2 gates

**Files:**
- Modify: `docs/architecture/storage-model.md` (§3.3, after `dataset_metadata`)

- [ ] **Step 1: Document the tables**

Append to §3.3:

```markdown
**`user_event`**, **`event_category`**, **`event_category_visibility`**
- the user's own chart events, category overrides and user categories, and the global event
  filter (see `apps/api/services/events` and `docs/superpowers/specs/2026-09-15-market-event-registry-design.md`)
- built-in events and categories are **not** stored here: they are read from committed JSON in
  `apps/api/services/events/` on every request, so a new built-in reaches every machine without
  a seed step
- `event_category.kind` is `override` (a built-in's label/colour, reset by deleting the row) or
  `user` (ids prefixed `user-`); an override whose id has left `categories.json` is ignored, not
  resurrected
- `user_event.id` is `AUTOINCREMENT`, so a deleted event's id is never reused
- these rows are per machine and are not synced
```

- [ ] **Step 2: Full gates**

Run in order, without switching branches:
- `python -m pytest -q -p no:cacheprovider`. Expected: all pass.
- `npx tsc --noEmit` in `apps/web`. Expected: exit 0.
- `npx playwright test --reporter=line` in `apps/web`. Expected: all pass.

- [ ] **Step 3: Commit, push, PR 2**

```bash
git add docs/architecture/storage-model.md
git commit -m "docs: storage model for market event tables"
git push -u origin event-writes
```

Open a PR to `renewal` listing the routes, the mutation checks and the gate results, ending with
the attribution lines.

---

# Part C — PR 3: colored lines, tooltip, one global filter

Start once PR 2 has merged:
`git fetch origin && git worktree add .claude/worktrees/events-c -b event-charts origin/renewal`.
In the new worktree, run `npm install` in `apps/web` before any `tsc` or Playwright command.

Run a pure spec (no servers needed, but Playwright still starts them) with
`npx playwright test tests/e2e/<file> --reporter=line` from `apps/web`.

### Task C1: The line model: build, place, hit-test

**Files:**
- Modify: `apps/web/components/charts/primitives/EventLinesPrimitive.ts`
- Create: `apps/web/lib/eventLines.ts`
- Test: `apps/web/tests/e2e/event-lines-model.spec.ts`

**Interfaces:**
- Consumes: `MarketEvent`, `EventCategory` (TS, Part A/B)
- Produces:
  - `EventLineSpec { id; label; date; color; endDate?; note?; categoryLabel?; source?; origin? }`
  - `PlacedEventLine { x: number; events: EventLineSpec[]; colors: string[] }`
  - `EventHit { x: number; width: number; events: EventLineSpec[] }`
  - `placeEventLines(events, barTimes, timeToCoordinate, granularity) -> PlacedEventLine[]`
  - `eventsNearX(x: number, placed: readonly PlacedEventLine[], tolerancePx = 6) -> { x: number; events: EventLineSpec[] } | null`
  - `EventLinesPrimitive#placedLines(): PlacedEventLine[]`
  - `EventLinesOptions` without `color`
  - `buildEventLines(events: readonly MarketEvent[], categories: readonly EventCategory[]) -> EventLineSpec[]`
  - `eventProvenance(event: EventLineSpec) -> string`

- [ ] **Step 1: Write the failing spec**

`apps/web/tests/e2e/event-lines-model.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { eventsNearX, placeEventLines, type EventLineSpec } from "../../components/charts/primitives/EventLinesPrimitive";
import { buildEventLines, eventProvenance } from "../../lib/eventLines";

/** Pure rules for turning events into coloured lines and finding the ones under the pointer. */

const BARS = ["2026-02-26", "2026-02-27", "2026-03-02", "2026-03-03"];
const at = (time: string) => {
  const index = BARS.indexOf(time);
  return index === -1 ? null : index * 10;
};

function line(overrides: Partial<EventLineSpec>): EventLineSpec {
  return { id: "e", label: "Event", date: "2026-02-27", color: "#E54545", ...overrides };
}

const category = (overrides: Record<string, unknown>) => ({
  id: "fomc", label: "Fed rate decisions", color: "#E54545", origin: "builtin" as const, visible: true, overridden: false, ...overrides,
});

const event = (overrides: Record<string, unknown>) => ({
  id: "fomc-2026-02-27", label: "FOMC: hold at 3.50–3.75%", category: "fomc", start_date: "2026-02-27",
  end_date: null, source: "https://www.federalreserve.gov/x.htm", note: "", origin: "builtin" as const, missing_category: null,
  ...overrides,
});

test.describe("buildEventLines", () => {
  test("a visible category's event becomes a line in that category's colour", () => {
    const [built] = buildEventLines([event({})], [category({ color: "#0000FF" })]);
    expect(built).toEqual({
      id: "fomc-2026-02-27", label: "FOMC: hold at 3.50–3.75%", date: "2026-02-27", endDate: null,
      color: "#0000FF", categoryLabel: "Fed rate decisions", note: "", source: "https://www.federalreserve.gov/x.htm", origin: "builtin",
    });
  });

  test("an event in a hidden category is not a line", () => {
    expect(buildEventLines([event({})], [category({ visible: false })])).toEqual([]);
  });

  test("an event whose category is absent from the list is not drawn in an invented colour", () => {
    expect(buildEventLines([event({ category: "gone" })], [category({})])).toEqual([]);
  });
});

test.describe("placeEventLines", () => {
  test("events on the same bar share one line that lists every distinct colour once", () => {
    const placed = placeEventLines(
      [line({ id: "a", color: "#E54545" }), line({ id: "b", color: "#7C5CFF" }), line({ id: "c", color: "#E54545" })],
      BARS, at, "day",
    );
    expect(placed).toHaveLength(1);
    expect(placed[0].x).toBe(10);
    expect(placed[0].events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(placed[0].colors).toEqual(["#E54545", "#7C5CFF"]);
  });

  test("an event outside the loaded bars is not placed", () => {
    expect(placeEventLines([line({ date: "2025-01-15" })], BARS, at, "day")).toEqual([]);
  });

  test("lines come back ordered by x", () => {
    const placed = placeEventLines([line({ id: "late", date: "2026-03-03" }), line({ id: "early", date: "2026-02-26" })], BARS, at, "day");
    expect(placed.map((p) => p.events[0].id)).toEqual(["early", "late"]);
  });
});

test.describe("eventsNearX", () => {
  const placed = placeEventLines([line({ id: "fri", date: "2026-02-27" }), line({ id: "tue", date: "2026-03-03" })], BARS, at, "day");

  test("a pointer within tolerance of a line hits that line's events, anchored at the line", () => {
    expect(eventsNearX(14, placed)).toEqual({ x: 10, events: [expect.objectContaining({ id: "fri" })] });
  });

  test("a pointer beyond tolerance hits nothing", () => {
    expect(eventsNearX(17, placed)).toBeNull();
  });

  test("when two lines are within tolerance, the nearer one anchors and both are listed nearest first", () => {
    const close = placeEventLines([line({ id: "a", date: "2026-02-27" }), line({ id: "b", date: "2026-03-02" })], BARS, (t) => (t === "2026-02-27" ? 10 : t === "2026-03-02" ? 14 : null), "day");
    expect(eventsNearX(13, close)).toEqual({ x: 14, events: [expect.objectContaining({ id: "b" }), expect.objectContaining({ id: "a" })] });
  });
});

test.describe("eventProvenance", () => {
  test("a built-in event names its source's host", () => {
    expect(eventProvenance(line({ origin: "builtin", source: "https://www.federalreserve.gov/a.htm" }))).toBe("Source: www.federalreserve.gov");
  });

  test("a user event without a source says so", () => {
    expect(eventProvenance(line({ origin: "user", source: null }))).toBe("Added by you, no source");
  });

  test("a user event with a source says both", () => {
    expect(eventProvenance(line({ origin: "user", source: "https://example.com/n" }))).toBe("Added by you · Source: example.com");
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx playwright test tests/e2e/event-lines-model.spec.ts --reporter=line`
Expected: FAIL at import. `placeEventLines`, `eventsNearX` and `../../lib/eventLines` do not exist.

- [ ] **Step 3: Implement**

In `EventLinesPrimitive.ts`, keep the imports, `RenderTarget`, `EventGranularity` and
`eventCoordinate` exactly as they are. Replace `EventLineSpec` with:

```ts
export interface EventLineSpec {
  id: string;
  label: string;
  /** ISO `YYYY-MM-DD`: where the line is drawn. */
  date: string;
  /** `#RRGGBB`, from the event's category. */
  color: string;
  endDate?: string | null;
  note?: string;
  categoryLabel?: string;
  source?: string | null;
  origin?: "builtin" | "rule" | "user";
}

/** One drawn x position and every event on it. `colors` holds each distinct colour once, in event order. */
export interface PlacedEventLine {
  x: number;
  events: EventLineSpec[];
  colors: string[];
}

/** What the pointer is over: the anchoring line's x, the chart width for flipping, and the events. */
export interface EventHit {
  x: number;
  width: number;
  events: EventLineSpec[];
}
```

Add after `eventCoordinate`:

```ts
/**
 * Place every event, grouping events that land on the same pixel into one line. Two categories on
 * one date -- or on one monthly candle -- then draw as adjacent stripes instead of one hiding the other.
 */
export function placeEventLines(
  events: readonly EventLineSpec[],
  barTimes: readonly string[],
  timeToCoordinate: (time: string) => number | null,
  granularity: EventGranularity,
): PlacedEventLine[] {
  const byPixel = new Map<number, PlacedEventLine>();
  for (const event of events) {
    const x = eventCoordinate(event.date, barTimes, timeToCoordinate, granularity);
    if (x === null) continue;
    const key = Math.round(x);
    const placed = byPixel.get(key) ?? { x, events: [], colors: [] };
    placed.events.push(event);
    if (!placed.colors.includes(event.color)) placed.colors.push(event.color);
    byPixel.set(key, placed);
  }
  return [...byPixel.values()].sort((a, b) => a.x - b.x);
}

/**
 * The events under the pointer: every line within `tolerancePx`, nearest first, anchored at the
 * nearest line so the tooltip sits on it rather than chasing the pointer.
 */
export function eventsNearX(
  x: number,
  placed: readonly PlacedEventLine[],
  tolerancePx = 6,
): { x: number; events: EventLineSpec[] } | null {
  const hits = placed
    .filter((line) => Math.abs(line.x - x) <= tolerancePx)
    .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
  if (hits.length === 0) return null;
  return { x: hits[0].x, events: hits.flatMap((line) => line.events) };
}
```

Replace `EventLinesRenderer`, `EventLinesOptions` and `EventLinesPrimitive#buildRenderer`,
keeping the rest of the class:

```ts
class EventLinesRenderer implements IPrimitivePaneRenderer {
  public constructor(
    private readonly lines: readonly PlacedEventLine[],
    private readonly alpha: number,
    private readonly lineWidth: number,
  ) {}

  public draw(target: RenderTarget): void {
    if (this.lines.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      const width = Math.max(1, Math.round(this.lineWidth * scope.horizontalPixelRatio));
      for (const line of this.lines) {
        const left = Math.round(line.x * scope.horizontalPixelRatio) - Math.floor(width / 2);
        // Each further colour is a stripe immediately to the right, so every category stays visible.
        line.colors.forEach((color, index) => {
          ctx.fillStyle = color;
          ctx.fillRect(left + index * width, 0, width, scope.bitmapSize.height);
        });
      }
      ctx.restore();
    });
  }
}
```

```ts
export interface EventLinesOptions {
  events: readonly EventLineSpec[];
  barTimes: readonly string[];
  granularity: EventGranularity;
  alpha: number;
  lineWidth: number;
  visible: boolean;
}
```

```ts
  /** The lines as currently placed. Also read by TVChart's hover handler, so both agree on x. */
  public placedLines(): PlacedEventLine[] {
    if (!this.options.visible || !this.chart) return [];
    const timeScale = this.chart.timeScale();
    return placeEventLines(
      this.options.events,
      this.options.barTimes,
      (time) => timeScale.timeToCoordinate(time as Time),
      this.options.granularity,
    );
  }

  public buildRenderer(): IPrimitivePaneRenderer | null {
    const lines = this.placedLines();
    if (lines.length === 0) return null;
    return new EventLinesRenderer(lines, this.options.alpha, this.options.lineWidth);
  }
```

`apps/web/lib/eventLines.ts`:

```ts
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import type { EventCategory, MarketEvent } from "../../../packages/shared-types";

/**
 * Events plus categories become the lines a chart draws: only visible categories, each line in
 * its category's colour. Charts never see categories -- they draw whatever EventLineSpec[] they
 * are handed, so any caller can pass lines of its own.
 */
export function buildEventLines(events: readonly MarketEvent[], categories: readonly EventCategory[]): EventLineSpec[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const lines: EventLineSpec[] = [];
  for (const event of events) {
    const category = byId.get(event.category);
    // The server resolves every event's category, so a miss means the two responses disagree
    // (one is stale). Drawing it in a made-up colour would assert a category it does not have.
    if (!category || !category.visible) continue;
    lines.push({
      id: event.id,
      label: event.label,
      date: event.start_date,
      endDate: event.end_date,
      color: category.color,
      categoryLabel: category.label,
      note: event.note,
      source: event.source,
      origin: event.origin,
    });
  }
  return lines;
}

function sourceHost(source: string | null | undefined): string | null {
  if (!source) return null;
  try {
    return new URL(source).host;
  } catch {
    return null;
  }
}

/** The tooltip's provenance line. A user's own unsourced event must never read as a checked one. */
export function eventProvenance(event: EventLineSpec): string {
  const host = sourceHost(event.source);
  if (event.origin === "user") return host ? `Added by you · Source: ${host}` : "Added by you, no source";
  return host ? `Source: ${host}` : "No source";
}
```

`TVChart.tsx` still passes `color` in the options and does not compile yet. C3 fixes it. Do not
run `tsc` until C3.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx playwright test tests/e2e/event-lines-model.spec.ts tests/e2e/event-coordinate.spec.ts --reporter=line`
Expected: all pass.

- [ ] **Step 5: Mutation check**

1. In `buildEventLines`, delete `|| !category.visible`. Run `-g "hidden category"`. Expected:
   FAIL. Restore.
2. In `placeEventLines`, remove the `includes` guard, so colors repeat. Run
   `-g "same bar share one line"`. Expected: FAIL. Restore.
3. In `eventsNearX`, delete the `.sort(...)`. Run `-g "nearer one anchors"`. Expected: FAIL
   (anchored at 10). Restore.
4. In `eventProvenance`, return `"Source: unknown"` when `host` is null for user events. Run
   `-g "without a source says so"`. Expected: FAIL. Restore.
5. `git diff --exit-code apps/web/lib/eventLines.ts apps/web/components/charts/primitives/EventLinesPrimitive.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/charts/primitives/EventLinesPrimitive.ts apps/web/lib/eventLines.ts apps/web/tests/e2e/event-lines-model.spec.ts
git commit -m "feat(charts): per-category event line model with placement and hit-testing"
```

### Task C2: Data hook, API client, mutations, and the e2e mock

**Files:**
- Create: `apps/web/lib/marketEventsApi.ts`, `apps/web/lib/useEventMutations.ts`
- Rewrite: `apps/web/lib/useMarketEvents.ts`
- Create: `apps/web/tests/e2e/helpers/eventsApiMock.ts`
- Modify: `apps/web/tests/e2e/helpers/marketPageMock.ts:59-61`

**Interfaces:**
- Consumes: C1 `buildEventLines`
- Produces:
  - `MARKET_EVENTS_KEY = ["market-events"]`, `EVENT_CATEGORIES_KEY = ["market-event-categories"]`
  - `useMarketEvents() -> { events: MarketEvent[]; categories: EventCategory[]; lines: EventLineSpec[]; status: "loading" | "ready" | "unavailable"; visibleCount: number; refetch: () => void }`
  - `EventApiError extends Error { status: number; detail: string }`
  - `eventsApi.{createEvent, updateEvent, deleteEvent, createCategory, patchCategory, resetCategory, deleteCategory}`
  - `useSetCategoriesVisible()`: mutation over `Array<{ id: string; visible: boolean }>`, optimistic with rollback
  - `useCreateEvent`, `useUpdateEvent` (args `{ id, input }`), `useDeleteEvent`, `useCreateCategory`,
    `usePatchCategory` (args `{ id, patch }`), `useResetCategory`, `useDeleteCategory`
  - Test helper `mockEventsApi(page, options) -> MockEventsState`, `setAllEventCategories(scope, testId, shown)`,
    constants `GEOPOLITICAL`, `FOMC_CATEGORY`, `UNCATEGORIZED`

This task has no user-visible behavior of its own: the hook's states are exercised through the
components in C4 and C5. It ends with a type check instead of a test run. Commit together with C3.

- [ ] **Step 1: API client**

`apps/web/lib/marketEventsApi.ts`:

```ts
import { buildApiUrl } from "@/lib/api";
import type {
  EventCategory,
  EventCategoryInput,
  EventCategoryPatch,
  MarketEvent,
  MarketEventInput,
} from "../../../packages/shared-types";

/**
 * Writes for events and categories. Not fetchApi: that throws "API error: 422 Unprocessable
 * Entity" and drops the body, and the server's `detail` is the only thing that tells the user
 * which field to fix.
 */
export class EventApiError extends Error {
  public constructor(public readonly status: number, public readonly detail: string) {
    super(detail);
  }
}

function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // FastAPI's own 422: [{loc: ["body", "field"], msg}].
    return detail
      .map((item: { loc?: unknown[]; msg?: string }) => `${(item.loc ?? []).slice(1).join(".")}: ${item.msg ?? "invalid"}`)
      .join("; ");
  }
  return fallback;
}

async function send<T>(endpoint: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(buildApiUrl(endpoint).toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`;
    let detail = fallback;
    try {
      detail = describeDetail((await response.json())?.detail, fallback);
    } catch {
      // Not JSON: keep the status line.
    }
    throw new EventApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const id = (value: string) => encodeURIComponent(value);

export const eventsApi = {
  createEvent: (input: MarketEventInput) => send<MarketEvent>("/market/events", "POST", input),
  updateEvent: (eventId: string, input: MarketEventInput) => send<MarketEvent>(`/market/events/${id(eventId)}`, "PUT", input),
  deleteEvent: (eventId: string) => send<void>(`/market/events/${id(eventId)}`, "DELETE"),
  createCategory: (input: EventCategoryInput) => send<EventCategory>("/market/event-categories", "POST", input),
  patchCategory: (categoryId: string, patch: EventCategoryPatch) =>
    send<EventCategory>(`/market/event-categories/${id(categoryId)}`, "PATCH", patch),
  resetCategory: (categoryId: string) => send<void>(`/market/event-categories/${id(categoryId)}/override`, "DELETE"),
  deleteCategory: (categoryId: string) => send<void>(`/market/event-categories/${id(categoryId)}`, "DELETE"),
};
```

- [ ] **Step 2: The data hook**

Replace `apps/web/lib/useMarketEvents.ts` entirely:

```ts
"use client";

import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { buildEventLines } from "@/lib/eventLines";
import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import type { EventCategory, MarketEvent } from "../../../packages/shared-types";

export type { EventCategory, MarketEvent };

export const MARKET_EVENTS_KEY = ["market-events"] as const;
export const EVENT_CATEGORIES_KEY = ["market-event-categories"] as const;

export type EventsStatus = "loading" | "ready" | "unavailable";

// Stable empties: TVChart is React.memo and compares `events` by identity, so a fresh [] per render
// would re-render every chart on every unrelated parent render.
const NO_EVENTS: MarketEvent[] = [];
const NO_CATEGORIES: EventCategory[] = [];
const NO_LINES: EventLineSpec[] = [];

/**
 * Events, categories, and the lines every chart draws, under two shared query keys so all charts
 * on all pages read one cache and one global filter.
 *
 * A failure draws no lines -- an overlay must never take a price chart down -- but it is reported
 * as `unavailable`, so the filter can say so instead of looking like "no events".
 */
export function useMarketEvents() {
  const eventsQuery = useQuery({
    queryKey: MARKET_EVENTS_KEY,
    queryFn: () => fetchApi<MarketEvent[]>("/market/events"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });
  const categoriesQuery = useQuery({
    queryKey: EVENT_CATEGORIES_KEY,
    queryFn: () => fetchApi<EventCategory[]>("/market/event-categories"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const events = eventsQuery.data ?? NO_EVENTS;
  const categories = categoriesQuery.data ?? NO_CATEGORIES;
  const status: EventsStatus =
    eventsQuery.isError || categoriesQuery.isError
      ? "unavailable"
      : eventsQuery.data === undefined || categoriesQuery.data === undefined
        ? "loading"
        : "ready";

  const lines = useMemo(
    () => (status === "ready" ? buildEventLines(events, categories) : NO_LINES),
    [status, events, categories],
  );
  const visibleCount = useMemo(() => categories.filter((category) => category.visible).length, [categories]);

  const { refetch: refetchEvents } = eventsQuery;
  const { refetch: refetchCategories } = categoriesQuery;
  const refetch = useCallback(() => {
    void refetchEvents();
    void refetchCategories();
  }, [refetchEvents, refetchCategories]);

  return { events, categories, lines, status, visibleCount, refetch };
}
```

- [ ] **Step 3: Mutations**

`apps/web/lib/useEventMutations.ts`:

```ts
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { eventsApi } from "@/lib/marketEventsApi";
import { EVENT_CATEGORIES_KEY, MARKET_EVENTS_KEY } from "@/lib/useMarketEvents";
import type { EventCategory, EventCategoryInput, EventCategoryPatch, MarketEventInput } from "../../../packages/shared-types";

/** Every write can change what either list resolves to (a category rename, a fallback), so both refetch. */
function useEventsWrite<TArgs, TResult>(write: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MARKET_EVENTS_KEY });
      void queryClient.invalidateQueries({ queryKey: EVENT_CATEGORIES_KEY });
    },
  });
}

export const useCreateEvent = () => useEventsWrite((input: MarketEventInput) => eventsApi.createEvent(input));
export const useUpdateEvent = () =>
  useEventsWrite(({ id, input }: { id: string; input: MarketEventInput }) => eventsApi.updateEvent(id, input));
export const useDeleteEvent = () => useEventsWrite((id: string) => eventsApi.deleteEvent(id));
export const useCreateCategory = () => useEventsWrite((input: EventCategoryInput) => eventsApi.createCategory(input));
export const usePatchCategory = () =>
  useEventsWrite(({ id, patch }: { id: string; patch: EventCategoryPatch }) => eventsApi.patchCategory(id, patch));
export const useResetCategory = () => useEventsWrite((id: string) => eventsApi.resetCategory(id));
export const useDeleteCategory = () => useEventsWrite((id: string) => eventsApi.deleteCategory(id));

/**
 * The global filter. Optimistic, so every chart updates on the click; a failed save rolls the
 * cache back to what the server holds, and the caller shows the error.
 */
export function useSetCategoriesVisible() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Array<{ id: string; visible: boolean }>) =>
      Promise.all(changes.map((change) => eventsApi.patchCategory(change.id, { visible: change.visible }))),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: EVENT_CATEGORIES_KEY });
      const previous = queryClient.getQueryData<EventCategory[]>(EVENT_CATEGORIES_KEY);
      const next = new Map(changes.map((change) => [change.id, change.visible]));
      queryClient.setQueryData<EventCategory[]>(EVENT_CATEGORIES_KEY, (current) =>
        current?.map((category) => (next.has(category.id) ? { ...category, visible: next.get(category.id)! } : category)),
      );
      return { previous };
    },
    onError: (_error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(EVENT_CATEGORIES_KEY, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: EVENT_CATEGORIES_KEY });
    },
  });
}
```

- [ ] **Step 4: The e2e mock**

`apps/web/tests/e2e/helpers/eventsApiMock.ts`:

```ts
import { expect, type Locator, type Page, type Route } from "@playwright/test";

/**
 * A stateful stand-in for the events and categories API. State lives in this test's closure, so a
 * filter change survives page.reload() the way the real database does, and never leaks into the
 * next test the way a PATCH against the shared e2e API database would.
 *
 * Register it AFTER any catch-all page mock: Playwright tries the last-registered route first.
 */

export interface MockCategory {
  id: string;
  label: string;
  color: string;
  visible: boolean;
  origin: "builtin" | "user";
  overridden: boolean;
}

export interface MockEvent {
  id: string;
  label: string;
  category: string;
  start_date: string;
  end_date?: string | null;
  source?: string | null;
  note?: string;
  origin?: "builtin" | "rule" | "user";
  missing_category?: string | null;
}

export const GEOPOLITICAL: MockCategory = { id: "geopolitical", label: "Geopolitical", color: "#E8A028", visible: true, origin: "builtin", overridden: false };
export const FOMC_CATEGORY: MockCategory = { id: "fomc", label: "Fed rate decisions", color: "#E54545", visible: true, origin: "builtin", overridden: false };
export const UNCATEGORIZED: MockCategory = { id: "uncategorized", label: "Uncategorized", color: "#9DA5A2", visible: true, origin: "builtin", overridden: false };

export interface MockEventsState {
  events: Required<MockEvent>[];
  categories: MockCategory[];
  patches: Array<{ id: string; body: Record<string, unknown> }>;
}

interface Options {
  events?: MockEvent[];
  categories?: MockCategory[];
  /** Fail GET /market/event-categories with this status. */
  categoriesStatus?: number;
  /** Hold GET /market/events until this settles. */
  holdEvents?: Promise<void>;
}

function normalize(event: MockEvent): Required<MockEvent> {
  return { end_date: null, source: null, note: "", origin: "builtin", missing_category: null, ...event };
}

async function reply(route: Route, status: number, body?: unknown) {
  if (status === 204) return route.fulfill({ status, body: "" });
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function mockEventsApi(page: Page, options: Options = {}): Promise<MockEventsState> {
  const state: MockEventsState = {
    events: (options.events ?? []).map(normalize),
    categories: (options.categories ?? [GEOPOLITICAL]).map((category) => ({ ...category })),
    patches: [],
  };
  const defaults = new Map(state.categories.filter((c) => c.origin === "builtin").map((c) => [c.id, { label: c.label, color: c.color }]));
  let nextUserEvent = 1 + state.events.filter((e) => e.origin === "user").length;

  await page.route("**/api/v1/market/event-categories**", async (route) => {
    const request = route.request();
    const method = request.method();
    const rest = new URL(request.url()).pathname.replace(/^.*\/market\/event-categories/, "");
    if (rest === "" && method === "GET") {
      return options.categoriesStatus ? reply(route, options.categoriesStatus, { detail: "unavailable" }) : reply(route, 200, state.categories);
    }
    if (rest === "" && method === "POST") {
      const body = request.postDataJSON() as { label: string; color: string };
      const category: MockCategory = {
        id: `user-${body.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
        label: body.label, color: body.color, visible: true, origin: "user", overridden: false,
      };
      state.categories.push(category);
      return reply(route, 201, category);
    }
    const match = rest.match(/^\/([^/]+)(\/override)?$/);
    const category = match ? state.categories.find((c) => c.id === decodeURIComponent(match[1])) : undefined;
    if (!match || !category) return reply(route, 404, { detail: "no such category" });
    if (match[2] && method === "DELETE") {
      const original = defaults.get(category.id);
      if (!original) return reply(route, 409, { detail: "a user category has no file default" });
      Object.assign(category, original, { overridden: false });
      return reply(route, 204);
    }
    if (method === "PATCH") {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.patches.push({ id: category.id, body });
      Object.assign(category, body);
      const original = defaults.get(category.id);
      if (original) category.overridden = category.label !== original.label || category.color.toUpperCase() !== original.color.toUpperCase();
      return reply(route, 200, category);
    }
    if (method === "DELETE") {
      if (category.origin === "builtin") return reply(route, 409, { detail: "built-in categories cannot be deleted" });
      const used = state.events.filter((e) => e.origin === "user" && e.category === category.id).length;
      if (used) return reply(route, 409, { detail: `category '${category.id}' is still used by ${used} event${used === 1 ? "" : "s"}` });
      state.categories = state.categories.filter((c) => c !== category);
      return reply(route, 204);
    }
    return route.fallback();
  });

  await page.route("**/api/v1/market/events**", async (route) => {
    const request = route.request();
    const method = request.method();
    const rest = new URL(request.url()).pathname.replace(/^.*\/market\/events/, "");
    if (rest === "" && method === "GET") {
      if (options.holdEvents) await options.holdEvents;
      return reply(route, 200, state.events);
    }
    const body = method === "POST" || method === "PUT" ? (request.postDataJSON() as MockEvent) : null;
    if (body && body.end_date && body.end_date < body.start_date) {
      return reply(route, 422, { detail: `event ends (${body.end_date}) before it starts (${body.start_date})` });
    }
    if (rest === "" && method === "POST" && body) {
      const created = normalize({ ...body, id: `user-${nextUserEvent++}`, origin: "user" });
      state.events.push(created);
      return reply(route, 201, created);
    }
    const eventId = decodeURIComponent(rest.replace(/^\//, ""));
    const existing = state.events.find((e) => e.id === eventId);
    if (!existing) return reply(route, 404, { detail: `no event with id '${eventId}'` });
    if (existing.origin !== "user") return reply(route, 409, { detail: "built-in events are edited in their data file" });
    if (method === "PUT" && body) {
      Object.assign(existing, normalize({ ...body, id: existing.id, origin: "user" }));
      return reply(route, 200, existing);
    }
    if (method === "DELETE") {
      state.events = state.events.filter((e) => e !== existing);
      return reply(route, 204);
    }
    return route.fallback();
  });

  return state;
}

/** Show or hide every category through the filter, then close it. */
export async function setAllEventCategories(scope: Page | Locator, testId: string, shown: boolean) {
  const button = scope.getByTestId(testId);
  await button.click();
  await scope.getByTestId(`${testId}-${shown ? "all" : "none"}`).click();
  await expect(button).toHaveText(shown ? /Events · (\d+) of \1$/ : /Events · 0 of \d+$/);
  await button.click();
  await expect(scope.getByTestId(`${testId}-popover`)).toHaveCount(0);
}
```

In `apps/web/tests/e2e/helpers/marketPageMock.ts`, after the `/market/events` branch (line 59–61), add:

```ts
    if (pathname === `${API_PREFIX}/market/event-categories` && method === "GET") {
      return json(route, []);
    }
```

### Task C3: Colored lines and the hover tooltip in `TVChart`

**Files:**
- Create: `apps/web/components/charts/EventTooltip.tsx`
- Modify: `apps/web/components/charts/TVChart.tsx`
- Test: `apps/web/tests/e2e/event-tooltip.spec.ts`, `apps/web/tests/e2e/helpers/lineColor.ts`

**Interfaces:**
- Consumes: C1 (`eventsNearX`, `EventHit`, `placedLines()`, `eventProvenance`), C2 (`mockEventsApi`)
- Produces: `TVChart` props without `showEvents` and `eventColor`; `data-testid="event-tooltip"`
  and `event-tooltip-item-<id>`; helpers `addedColumns`, `columnRuns`, `pagePointForColumn`,
  `lineColorAt`, `colorDistance`

- [ ] **Step 1: Write the failing spec and its helper**

`apps/web/tests/e2e/helpers/lineColor.ts`:

```ts
import type { Page } from "@playwright/test";

/** Bitmap columns where `withLine` carries more ink than `without`: the event lines and nothing else. */
export function addedColumns(withLine: { ink: number[] }, without: { ink: number[] }): number[] {
  return withLine.ink.flatMap((value, x) => (value > (without.ink[x] ?? 0) ? [x] : []));
}

/** Group sorted columns into runs; a gap wider than 3px starts a new run (a separate line). */
export function columnRuns(columns: number[]): number[][] {
  const runs: number[][] = [];
  for (const column of columns) {
    const last = runs[runs.length - 1];
    if (last && column - last[last.length - 1] <= 3) last.push(column);
    else runs.push([column]);
  }
  return runs;
}

/** The page point at a bitmap column of the widest canvas (the price pane), halfway down it. */
export async function pagePointForColumn(page: Page, selector: string, column: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ sel, col }) => {
    const canvases = Array.from(document.querySelectorAll(`${sel} canvas`)) as HTMLCanvasElement[];
    const pane = canvases.reduce((widest, canvas) => (canvas.width > widest.width ? canvas : widest));
    const rect = pane.getBoundingClientRect();
    return { x: rect.left + col / (pane.width / rect.width), y: rect.top + rect.height / 2 };
  }, { sel: selector, col: column });
}

/**
 * The colour a line paints in one column: the most common RGB among pixels whose alpha is the
 * line's own (drawn at 0.55 over a transparent background, so about 140). Candles are opaque and
 * grid lines far fainter, so neither lands in that band.
 */
export async function lineColorAt(page: Page, selector: string, column: number): Promise<string | null> {
  return page.evaluate(({ sel, col }) => {
    const counts = new Map<string, number>();
    for (const canvas of Array.from(document.querySelectorAll(`${sel} canvas`)) as HTMLCanvasElement[]) {
      if (col >= canvas.width || canvas.height === 0) continue;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const data = context.getImageData(col, 0, 1, canvas.height).data;
      for (let y = 0; y < canvas.height; y += 1) {
        const alpha = data[y * 4 + 3];
        if (alpha < 110 || alpha > 170) continue;
        const key = [data[y * 4], data[y * 4 + 1], data[y * 4 + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    return best ? `#${best.toUpperCase()}` : null;
  }, { sel: selector, col: column });
}

/** Largest per-channel difference between two #RRGGBB colours. */
export function colorDistance(a: string, b: string): number {
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, i) => Math.abs(value - y[i])));
}
```

`apps/web/tests/e2e/event-tooltip.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { stableInkProfile } from "./helpers/chartInk";
import { FOMC_CATEGORY, GEOPOLITICAL, mockEventsApi, setAllEventCategories, type MockEvent } from "./helpers/eventsApiMock";
import { addedColumns, colorDistance, columnRuns, lineColorAt, pagePointForColumn } from "./helpers/lineColor";

const CHART = '[role="dialog"] [data-testid="tv-chart"]';
const FILTER = "chart-events-filter";
const BARS = [
  "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27",
  "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
];

async function openChartWith(page: Page, events: MockEvent[], categories = [GEOPOLITICAL, FOMC_CATEGORY]) {
  await mockPortfolioPageApi(page);
  await page.route("**/api/v1/portfolio/stock/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ticker: "AAPL",
        prices: BARS.map((date, i) => ({ date, open: 100 + i, high: 106 + i, low: 98 + i, close: 102 + i, volume: 1_000_000 })),
        news: [],
      }),
    }),
  );
  await mockEventsApi(page, { events, categories });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("stock-tile-AAPL").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId(FILTER)).toHaveText(new RegExp(`Events · ${categories.length} of ${categories.length}`));
  return dialog;
}

/** Each line's centre column, found by diffing the canvas against every category hidden. */
async function lineCentres(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const withLines = await stableInkProfile(page, CHART);
  await setAllEventCategories(dialog, FILTER, false);
  const without = await stableInkProfile(page, CHART);
  await setAllEventCategories(dialog, FILTER, true);
  await expect.poll(async () => JSON.stringify((await stableInkProfile(page, CHART)).ink)).toBe(JSON.stringify(withLines.ink));
  return columnRuns(addedColumns(withLines, without)).map((run) => ({ first: run[0], centre: run[Math.floor(run.length / 2)] }));
}

test("hovering an event line shows its label, date, category and source", async ({ page }) => {
  const dialog = await openChartWith(page, [
    { id: "iran", label: "U.S. strikes on Iran begin", category: "geopolitical", start_date: "2026-02-28", source: "https://en.wikipedia.org/wiki/Timeline", note: "Operation Epic Fury." },
  ]);
  const [line] = await lineCentres(page, dialog);
  expect(line, "no line was drawn to hover").toBeDefined();

  const tooltip = page.getByTestId("event-tooltip");
  await expect(tooltip, "no tooltip before hovering").toHaveCount(0);
  const point = await pagePointForColumn(page, CHART, line.centre);
  await page.mouse.move(point.x, point.y);

  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("U.S. strikes on Iran begin");
  await expect(tooltip).toContainText("2026-02-28 · Geopolitical");
  await expect(tooltip).toContainText("Operation Epic Fury.");
  await expect(tooltip).toContainText("Source: en.wikipedia.org");

  await page.mouse.move(point.x + 60, point.y);
  await expect(tooltip, "the tooltip leaves with the pointer").toHaveCount(0);
});

test("a user's own unsourced event says so in its tooltip", async ({ page }) => {
  const dialog = await openChartWith(page, [
    { id: "user-1", label: "Bought more", category: "geopolitical", start_date: "2026-03-03", origin: "user", source: null },
  ]);
  const [line] = await lineCentres(page, dialog);
  const point = await pagePointForColumn(page, CHART, line.centre);
  await page.mouse.move(point.x, point.y);

  await expect(page.getByTestId("event-tooltip")).toContainText("Added by you, no source");
});

test("each category's line is painted in that category's colour", async ({ page }) => {
  const dialog = await openChartWith(page, [
    { id: "iran", label: "Iran", category: "geopolitical", start_date: "2026-02-24", source: "https://example.com/a" },
    { id: "fomc-2026-03-04", label: "FOMC", category: "fomc", start_date: "2026-03-04", source: "https://example.com/b" },
  ]);
  const lines = await lineCentres(page, dialog);
  expect(lines, "expected two separate lines").toHaveLength(2);

  const [left, right] = lines;
  const leftColor = await lineColorAt(page, CHART, left.first);
  const rightColor = await lineColorAt(page, CHART, right.first);
  expect(leftColor && colorDistance(leftColor, GEOPOLITICAL.color), `left line is ${leftColor}`).toBeLessThanOrEqual(12);
  expect(rightColor && colorDistance(rightColor, FOMC_CATEGORY.color), `right line is ${rightColor}`).toBeLessThanOrEqual(12);
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx playwright test tests/e2e/event-tooltip.spec.ts --reporter=line`
Expected: FAIL. `chart-events-filter` does not exist yet (the web server may also fail to
compile until Step 3; either failure is expected).

- [ ] **Step 3: Implement the tooltip and wire `TVChart`**

`apps/web/components/charts/EventTooltip.tsx`:

```tsx
"use client";

import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import { eventProvenance } from "@/lib/eventLines";

const TOOLTIP_WIDTH = 256;
const GAP = 12;

/**
 * What the lines under the pointer are. Pointer-transparent, because it follows the pointer; the
 * source is shown as its host, and the Events page is where it can be followed.
 */
export function EventTooltip({ x, width, events }: { x: number; width: number; events: EventLineSpec[] }) {
  // Flip left near the right edge so it never overflows the chart.
  const left = x + GAP + TOOLTIP_WIDTH > width ? Math.max(0, x - GAP - TOOLTIP_WIDTH) : x + GAP;
  return (
    <div
      role="tooltip"
      data-testid="event-tooltip"
      className="pointer-events-none absolute top-2 z-10 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs text-[var(--text-primary)] shadow-lg"
      style={{ width: TOOLTIP_WIDTH, left }}
    >
      {events.map((event) => (
        <div key={event.id} data-testid={`event-tooltip-item-${event.id}`}>
          <div className="flex items-center gap-2 font-bold">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
            {event.label}
          </div>
          <div className="text-[var(--text-secondary)]">
            {event.endDate ? `${event.date} – ${event.endDate}` : event.date}
            {event.categoryLabel ? ` · ${event.categoryLabel}` : ""}
          </div>
          {event.note ? <p className="mt-1">{event.note}</p> : null}
          <p className="mt-1 text-[var(--text-secondary)]">{eventProvenance(event)}</p>
        </div>
      ))}
    </div>
  );
}
```

Edits to `apps/web/components/charts/TVChart.tsx`:

1. Imports:

```tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createChart, IChartApi, ISeriesApi, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries, LineSeries, type MouseEventParams, type Time } from "lightweight-charts";
import { EventLinesPrimitive, eventsNearX, type EventGranularity, type EventHit, type EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import { EventTooltip } from "@/components/charts/EventTooltip";
```

2. Delete `const EVENT_LINE_FALLBACK_COLOR = "#E8A028";`. Delete the `showEvents` and
   `eventColor` props, their doc comments, their defaults, and the `resolvedEvent` memo.

3. Add below the refs:

```tsx
    // What the pointer is over. Set from the crosshair handler inside the setup effect, so hovering
    // never becomes a dependency of that effect and cannot rebuild the chart.
    const [hover, setHover] = useState<EventHit | null>(null);
```

4. In the setup effect, construct the primitive without `color`, then subscribe right after
   `eventLinesRef.current = eventLines;`:

```tsx
            const eventLines = new EventLinesPrimitive({
                events: [],
                barTimes: [],
                granularity: "day",
                alpha: EVENT_LINE_ALPHA,
                lineWidth: EVENT_LINE_WIDTH,
                visible: false,
            });
            chart.panes()[0].attachPrimitive(eventLines);
            eventLinesRef.current = eventLines;

            // Reads the primitive through its ref on every move, so it always hit-tests the lines
            // currently drawn -- never a stale closure over the first render's events.
            const handleCrosshairMove = (param: MouseEventParams<Time>) => {
                const container = chartContainerRef.current;
                const near = param.point && container
                    ? eventsNearX(param.point.x, eventLinesRef.current?.placedLines() ?? [])
                    : null;
                const next = near && container ? { ...near, width: container.clientWidth } : null;
                setHover((previous) => {
                    if (previous === null || next === null) return next;
                    const same = previous.x === next.x
                        && previous.events.length === next.events.length
                        && previous.events.every((event, index) => event.id === next.events[index].id);
                    return same ? previous : next;
                });
            };
            chart.subscribeCrosshairMove(handleCrosshairMove);
```

   and in its cleanup, before `chart.remove();`:

```tsx
                chart.unsubscribeCrosshairMove(handleCrosshairMove);
```

5. Replace the event-lines effect:

```tsx
    // Pushed into the live primitive rather than handled in the init effect, so a filter change
    // repaints without rebuilding the chart (and without losing zoom/pan).
    useEffect(() => {
        eventLinesRef.current?.update({
            events,
            barTimes: data.map((bar) => bar.time),
            granularity: eventGranularity,
            visible: true,
        });
    }, [events, data, eventGranularity]);
```

6. Replace the returned element. The chart keeps its own container, and the tooltip is a React
   sibling inside a positioned wrapper, so React never reconciles children the library appended:

```tsx
    return (
        <div
            data-testid="tv-chart"
            aria-label={`${safeTickerName} price chart`}
            className="w-full relative rounded-lg border border-[var(--border)] bg-[var(--text-primary)]"
        >
            <div ref={chartContainerRef} className="w-full" style={{ minHeight: height }} />
            {hover ? <EventTooltip x={hover.x} width={hover.width} events={hover.events} /> : null}
        </div>
    );
```

7. In the `React.memo` comparator, delete `&& prevProps.showEvents === nextProps.showEvents` and
   the sentence about `showEvents` in its comment; keep `events` and `eventGranularity`.

Callers still pass `showEvents`; C4 removes that. Continue straight to C4 before running `tsc`.

### Task C4: `EventFilter` replaces the three toggles

**Files:**
- Create: `apps/web/components/charts/EventFilter.tsx`
- Delete: `apps/web/components/charts/EventsToggle.tsx`
- Modify: `apps/web/components/charts/OHLCVChartCard.tsx`, `apps/web/components/market/MarketOverviewClient.tsx`,
  `apps/web/components/market/SpreadsSection.tsx`
- Modify tests: `apps/web/tests/e2e/market-event-lines.spec.ts`, `detail-chart-stability.spec.ts`, `market-spreads.spec.ts`
- Test: `apps/web/tests/e2e/event-filter.spec.ts`

**Interfaces:**
- Consumes: C2 `useMarketEvents`, `useSetCategoriesVisible`; C3 `TVChart`
- Produces: `<EventFilter testId />` with test ids `<testId>`, `<testId>-popover`,
  `<testId>-all`, `<testId>-none`, `<testId>-option-<categoryId>`, `<testId>-retry`,
  `<testId>-error`. The button's text is `Events · N of M`, `Events` (loading) or
  `Events unavailable`. Surface test ids: `chart-events-filter`, `market-events-filter`,
  `spreads-events-filter`.

- [ ] **Step 1: Write the failing spec**

`apps/web/tests/e2e/event-filter.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { stableInkProfile } from "./helpers/chartInk";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { FOMC_CATEGORY, mockEventsApi } from "./helpers/eventsApiMock";
import { addedColumns } from "./helpers/lineColor";

/**
 * One filter for every chart, remembered across reloads. Market Overview has several spread
 * charts and an index detail chart, so all three surfaces are exercised on one page.
 */

function spread(id: string, label: string) {
  return {
    id, label, numerator: "BOTZ", denominator: "^GSPC", requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
    basis: `(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15`,
    series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
    latest: 103.4, refused_reason: null,
  };
}

async function openOverview(page: Page, options: Parameters<typeof mockEventsApi>[1]) {
  await mockMarketPageApi(page);
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([spread("ai", "AI"), spread("cloud", "Cloud")]) }),
  );
  const state = await mockEventsApi(page, options);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("spread-chart-ai")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("spread-chart-cloud")).toBeVisible();
  return state;
}

const FOMC_EVENT = {
  id: "fomc-2026-06-15", label: "FOMC: hold at 3.50–3.75%", category: "fomc", start_date: "2026-06-15",
  source: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260615a.htm",
};

test("unchecking a category removes its lines from every chart, and stays unchecked after a reload", async ({ page }) => {
  const state = await openOverview(page, { events: [FOMC_EVENT], categories: [FOMC_CATEGORY] });
  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/);

  const charts = ['[data-testid="spread-chart-ai"]', '[data-testid="spread-chart-cloud"]'];
  const withLines = await Promise.all(charts.map((chart) => stableInkProfile(page, chart)));

  await filter.click();
  await page.getByTestId("spreads-events-filter-option-fomc").uncheck();
  await expect(filter).toHaveText(/Events · 0 of 1/);
  await filter.click();

  for (const [index, chart] of charts.entries()) {
    const without = await stableInkProfile(page, chart);
    expect(addedColumns(withLines[index], without).length, `${chart}: the line is still drawn`).toBeGreaterThan(0);
  }
  expect(state.patches).toEqual([{ id: "fomc", body: { visible: false } }]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("spreads-events-filter")).toHaveText(/Events · 0 of 1/, { timeout: 60_000 });
  const afterReload = await stableInkProfile(page, charts[0]);
  expect(addedColumns(withLines[0], afterReload).length, "after reload the line must still be hidden").toBeGreaterThan(0);

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog").getByTestId("market-events-filter"), "the modal shares the filter").toHaveText(/Events · 0 of 1/);
});

test("a failed categories request says Events unavailable while the charts still render", async ({ page }) => {
  await openOverview(page, { events: [FOMC_EVENT], categories: [FOMC_CATEGORY], categoriesStatus: 500 });

  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toHaveText("Events unavailable", { timeout: 15_000 });
  await expect.poll(() => page.locator('[data-testid="spread-chart-ai"] canvas').count()).toBeGreaterThan(0);

  await filter.click();
  await expect(page.getByTestId("spreads-events-filter-retry")).toBeVisible();
});

test("a failed filter save is undone and says so", async ({ page }) => {
  await openOverview(page, { events: [FOMC_EVENT], categories: [FOMC_CATEGORY] });
  await page.route("**/api/v1/market/event-categories/fomc", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "" }) : route.fallback(),
  );

  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/);
  await filter.click();
  await page.getByTestId("spreads-events-filter-option-fomc").uncheck();

  await expect(page.getByTestId("spreads-events-filter-error")).toBeVisible();
  await expect(filter).toHaveText(/Events · 1 of 1/);
  await expect(page.getByTestId("spreads-events-filter-option-fomc")).toBeChecked();
});
```

- [ ] **Step 2: Implement `EventFilter`**

`apps/web/components/charts/EventFilter.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { useSetCategoriesVisible } from "@/lib/useEventMutations";

/**
 * The one event filter every chart surface renders. Its state is each category's `visible` flag in
 * the database, so choosing on any chart changes every chart and survives a restart.
 *
 * The button always renders, including while loading and after a failure: a failed request draws
 * no lines, and without the button saying "Events unavailable" that would read as "no events".
 */
export function EventFilter({ testId }: { testId: string }) {
  const { categories, status, visibleCount, refetch } = useMarketEvents();
  const setVisible = useSetCategoriesVisible();
  const [open, setOpen] = useState(false);

  const change = (changes: Array<{ id: string; visible: boolean }>) => {
    if (changes.length > 0) setVisible.mutate(changes);
  };
  const label =
    status === "unavailable" ? "Events unavailable" : status === "loading" ? "Events" : `Events · ${visibleCount} of ${categories.length}`;

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={testId}
        data-status={status}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((isOpen) => !isOpen)}
        className={`rounded-[var(--radius-sm)] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] ${
          status === "unavailable"
            ? "border-[var(--state-warning)] text-[var(--state-warning)]"
            : "border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
        }`}
      >
        {status === "loading" ? <span aria-hidden className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" /> : null}
        {label}
      </button>

      {open ? (
        // Not role="dialog": this often sits inside a modal, and a second dialog would make
        // getByRole("dialog") ambiguous for assistive tech as much as for tests.
        <div
          role="group"
          aria-label="Event categories"
          data-testid={`${testId}-popover`}
          className="absolute right-0 z-20 mt-1 w-64 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-primary)] shadow-lg"
        >
          {status === "unavailable" ? (
            <div className="flex flex-col gap-2">
              <p>Event lines could not be loaded, so none are drawn. The price chart is unaffected.</p>
              <button type="button" data-testid={`${testId}-retry`} onClick={refetch} className="self-start rounded border border-[var(--border)] px-2 py-1 font-semibold">
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button type="button" data-testid={`${testId}-all`} className="rounded border border-[var(--border)] px-2 py-1 font-semibold"
                  onClick={() => change(categories.filter((c) => !c.visible).map((c) => ({ id: c.id, visible: true })))}>
                  All
                </button>
                <button type="button" data-testid={`${testId}-none`} className="rounded border border-[var(--border)] px-2 py-1 font-semibold"
                  onClick={() => change(categories.filter((c) => c.visible).map((c) => ({ id: c.id, visible: false })))}>
                  None
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {categories.map((category) => (
                  <li key={category.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        data-testid={`${testId}-option-${category.id}`}
                        checked={category.visible}
                        onChange={(event) => change([{ id: category.id, visible: event.target.checked }])}
                      />
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      {category.label}
                    </label>
                  </li>
                ))}
              </ul>
              {setVisible.isError ? (
                <p role="alert" data-testid={`${testId}-error`} className="text-[var(--state-warning)]">
                  That change could not be saved, so it was undone.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Replace the toggles on the three surfaces**

`OHLCVChartCard.tsx`:
- Remove `useState` from the React import if nothing else uses it (keep `type ReactNode`).
- Add `import { EventFilter } from "@/components/charts/EventFilter";`.
- Delete the `showEvents` state and its comment, and change the hook line to
  `const { lines } = useMarketEvents();`.
- Replace the whole `{lines.length > 0 ? (<button ... data-testid="chart-events-toggle" ...>) : null}`
  block with `<EventFilter testId="chart-events-filter" />`.
- Replace the legend block with:

```tsx
      {/* Canvas lines are invisible to assistive tech and unlabelled to a sighted reader; this list
          is their legend and the only textual record of what is drawn. */}
      {lines.length > 0 ? (
        <div data-testid="chart-events-legend" className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
          {lines.map((line) => (
            <span
              key={line.id}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--border)] px-2 py-1"
              title={line.note || undefined}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: line.color }} />
              {line.label} · {line.date}
            </span>
          ))}
        </div>
      ) : null}
```

- On `<TVChart>`, delete `showEvents={showEvents}`.

`MarketOverviewClient.tsx`, in `MarketDetailModal`:
- Delete `const [showEvents, setShowEvents] = useState(true);`.
- Replace `import { EventsToggle } from "@/components/charts/EventsToggle";` with
  `import { EventFilter } from "@/components/charts/EventFilter";`.
- Replace the `{eventLines.length > 0 ? (<EventsToggle ... testId="market-events-toggle" />) : null}`
  block with `<EventFilter testId="market-events-filter" />`.
- On `<TVChart>`, delete `showEvents={showEvents}`.

`SpreadsSection.tsx`:
- Remove `useState` from the import (keep `useMemo`).
- Replace the `EventsToggle` import with `EventFilter`.
- In `SpreadCard`, delete the `showEvents` prop from the signature, the props type, and the
  `<TVChart>` element.
- In `SpreadsSection`, delete the `showEvents` state.
- Replace the `{lines.length > 0 ? (<EventsToggle .../>) : null}` block with
  `<EventFilter testId="spreads-events-filter" />`.
- Render cards as `<SpreadCard key={spread.id} spread={spread} events={lines} />`.

`git rm apps/web/components/charts/EventsToggle.tsx`, then run:

```bash
grep -rn "showEvents\|eventColor\|EventsToggle\|events-toggle" apps/web --include=*.ts --include=*.tsx
```

Expected: matches only in the three spec files updated in Step 4.

- [ ] **Step 4: Update the existing specs to drive the filter**

`market-event-lines.spec.ts`:
- Add `import { GEOPOLITICAL, mockEventsApi, setAllEventCategories } from "./helpers/eventsApiMock";`.
- In `mockChartAndEvents`, replace the `page.route("**/api/v1/market/events**", ...)` block with:

```ts
  await mockEventsApi(page, {
    categories: [GEOPOLITICAL],
    events: events.map((event, index) => ({
      id: `event-${index}`,
      label: event.label ?? "U.S. strikes on Iran begin",
      category: "geopolitical",
      start_date: event.date,
      source: "https://example.com/timeline",
    })),
  });
```

- Replace `lineColumns`'s toggle lines with:

```ts
  const filter = dialog.getByTestId("chart-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/);
  const withLine = await stableInkProfile(page, CHART_SELECTOR);

  await setAllEventCategories(dialog, "chart-events-filter", false);
  const withoutLine = await stableInkProfile(page, CHART_SELECTOR);
```

- Rename `"the toggle removes the line and the legend together"` to
  `"hiding every category removes the line and the legend together"`, and replace its
  `await dialog.getByTestId("chart-events-toggle").click();` with
  `await setAllEventCategories(dialog, "chart-events-filter", false);`.

`detail-chart-stability.spec.ts`, in `"the detail chart is not rebuilt when event lines arrive or are toggled"`:
- Rename the test to `"the detail chart is not rebuilt when event lines arrive or the filter changes"`.
- Replace its `page.route("**/api/v1/market/events**", ...)` block with:

```ts
  await mockEventsApi(page, {
    categories: [GEOPOLITICAL],
    holdEvents: eventsHeld,
    events: [{
      id: "us-iran-strikes-begin-2026-02-28",
      label: "U.S. strikes on Iran begin",
      category: "geopolitical",
      start_date: "2026-02-28",
      source: "https://example.com/timeline",
    }],
  });
```

- Replace step 1's `const toggle = ...; await expect(toggle).toBeVisible(...)` with:

```ts
  const filter = page.getByTestId("chart-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/, { timeout: 30_000 });
```

- Replace step 2 (`await toggle.click(); await expect(toggle).toHaveAttribute(...)`) with:

```ts
  // 2. The filter hides every category. Same requirement.
  await setAllEventCategories(page, "chart-events-filter", false);
```

- Rename `afterToggle` to `afterFilter` and its message to `rebuilt when the filter changed`.
- Add the import `import { GEOPOLITICAL, mockEventsApi, setAllEventCategories } from "./helpers/eventsApiMock";`.

`market-spreads.spec.ts`:
- Add `import { GEOPOLITICAL, mockEventsApi, setAllEventCategories, type MockEvent } from "./helpers/eventsApiMock";`.
- Replace `mockEvents` with:

```ts
async function mockEvents(page: Page, events: unknown[] = IRAN_EVENT) {
  await mockEventsApi(page, { events: events as MockEvent[], categories: [GEOPOLITICAL] });
}
```

- In the four toggle tests, apply these replacements:
  - `page.getByTestId("spreads-events-toggle")` → `page.getByTestId("spreads-events-filter")`
  - `dialog.getByTestId("market-events-toggle")` → `dialog.getByTestId("market-events-filter")`
  - `await expect(toggle).toHaveAttribute("aria-pressed", "true");` → `await expect(toggle).toHaveText(/Events · 1 of 1/);`
    (keep any `{ timeout: 60_000 }` that was on the preceding `toBeVisible`)
  - `await toggle.click(); await expect(toggle).toHaveAttribute("aria-pressed", "false");` →
    `await setAllEventCategories(<page or dialog>, "<the same test id>", false);`
- Rename the variable `toggle` to `filter` in those tests.
- Rename the tests:
  - `"the spreads section has its own event toggle that changes what is painted"` →
    `"the spreads section's event filter changes what is painted"`
  - `"a spread chart is not rebuilt when its event toggle is clicked"` →
    `"a spread chart is not rebuilt when the event filter changes"`
  - `"the index detail chart has its own event toggle that changes what is painted"` →
    `"the index detail chart's event filter changes what is painted"`
- Update the comments that say "toggle" to say "filter".

- [ ] **Step 5: Type check, then run the new and updated specs**

Run: `npx tsc --noEmit` in `apps/web`. Expected: exit 0.

Run: `npx playwright test tests/e2e/event-lines-model.spec.ts tests/e2e/event-tooltip.spec.ts tests/e2e/event-filter.spec.ts tests/e2e/market-event-lines.spec.ts tests/e2e/detail-chart-stability.spec.ts tests/e2e/market-spreads.spec.ts --reporter=line`
Expected: all pass. `detail-chart-stability`'s rebuild test needs AAPL history in the local
database, as before.

- [ ] **Step 6: Mutation check**

Run only the named test after each change, then restore:
1. `TVChart`: move the `subscribeCrosshairMove` wiring into a separate `useEffect` that depends
   on `events`. Run `-g "not rebuilt when event lines arrive"`. Expected: FAIL (rebuilt).
2. `TVChart`: in `handleCrosshairMove`, replace `eventLinesRef.current?.placedLines() ?? []`
   with `[]`. Run `-g "hovering an event line"`. Expected: FAIL (no tooltip).
3. `buildEventLines`: replace `color: category.color` with `color: "#E8A028"`. Run
   `-g "painted in that category's colour"`. Expected: FAIL on the right (FOMC) line's color.
4. `useSetCategoriesVisible`: delete both `onError` and `onSettled`. Run
   `-g "failed filter save"`. Expected: FAIL (the box stays unchecked). Deleting `onError` alone
   is masked, because `onSettled`'s refetch also restores the server's value. The test checks
   that the change is undone, which either mechanism satisfies.
5. `useMarketEvents`: make `status` ignore `categoriesQuery.isError`. Run
   `-g "Events unavailable"`. Expected: FAIL.
6. `EventFilter`: make `change` call `setVisible.mutate` on a copy with `visible: true` always.
   Run `-g "unchecking a category"`. Expected: FAIL.
7. `git diff --exit-code apps/web`.

- [ ] **Step 7: Commit C2–C4**

```bash
git add -A apps/web/lib apps/web/components/charts apps/web/components/market apps/web/tests/e2e
git commit -m "feat(charts): coloured event lines, hover tooltip, and one global event filter"
```

### Task C5: PR 3 gates

- [ ] **Step 1:** `npx tsc --noEmit`, then ESLint on this PR's files only (existing code has
  warnings of its own), in `apps/web`:
  `npx eslint $(git diff --name-only origin/renewal -- . | grep -E '\.(ts|tsx)$' | sed 's#^apps/web/##')`.
  Expected: exit 0 for both.
- [ ] **Step 2:** `python -m pytest -q -p no:cacheprovider` at the root. Expected: all pass (no backend change, but run it).
- [ ] **Step 3:** `npx playwright test --reporter=line` in `apps/web`. Expected: all pass.
- [ ] **Step 4:** Push `event-charts` and open PR 3 to `renewal`. List:
  - that I-D Ruling H is reversed, and why;
  - the mutation checks;
  - the gates.

  End with the attribution lines.

---

# Part D — PR 4: the Events page

Start once PR 3 has merged:
`git fetch origin && git worktree add .claude/worktrees/events-d -b events-page origin/renewal`, then `npm install` in `apps/web`.

### Task D1: Page, table, form, categories panel, sidebar entry

**Files:**
- Create: `apps/web/app/events/page.tsx`
- Create: `apps/web/app/events/components/EventsTable.tsx`, `EventForm.tsx`, `CategoriesPanel.tsx`
- Modify: `apps/web/components/ui/Sidebar.tsx` (imports and `navItems`)
- Test: `apps/web/tests/e2e/events-page.spec.ts`

**Interfaces:**
- Consumes: C2 hooks and `EventApiError`, the C2 mock
- Produces: route `/events`. Test ids:
  - `events-table`, `event-row-<id>`, `event-edit-<id>`, `event-delete-<id>`,
    `event-delete-confirm-<id>`, `event-missing-category-<id>`
  - `event-form` (controls labelled `Date`, `End date`, `Label`, `Category`, `Note`, `Source URL`),
    `event-form-error`
  - `categories-panel`, `category-row-<id>`, `category-color-<id>`, `category-save-<id>`,
    `category-reset-<id>`, `category-delete-<id>`, `category-add-label`, `category-add-color`,
    `category-add`

- [ ] **Step 1: Write the failing spec**

`apps/web/tests/e2e/events-page.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { stableInkProfile } from "./helpers/chartInk";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { FOMC_CATEGORY, UNCATEGORIZED, mockEventsApi, setAllEventCategories, type MockCategory, type MockEvent } from "./helpers/eventsApiMock";
import { addedColumns } from "./helpers/lineColor";

const MINE: MockCategory = { id: "user-my-trades", label: "My trades", color: "#4589E5", visible: true, origin: "user", overridden: false };
const EMPTY: MockCategory = { id: "user-empty", label: "Empty", color: "#123456", visible: true, origin: "user", overridden: false };

const FOMC_EVENT: MockEvent = {
  id: "fomc-2026-06-17", label: "FOMC: hold at 3.50–3.75%", category: "fomc", start_date: "2026-06-17",
  source: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260617a.htm",
};
const MY_EVENT: MockEvent = { id: "user-1", label: "Bought AI basket", category: "user-my-trades", start_date: "2026-06-15", origin: "user" };

async function openEventsPage(page: Page, events: MockEvent[], categories: MockCategory[]) {
  await mockMarketPageApi(page);
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify([{
        id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC", requested_window_days: 90,
        actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
        basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
        series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }], latest: 103.4, refused_reason: null,
      }]),
    }),
  );
  const state = await mockEventsApi(page, { events, categories });
  await page.goto("/events", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("events-table")).toBeVisible({ timeout: 60_000 });
  return state;
}

test("the sidebar links to the events page", async ({ page }) => {
  await openEventsPage(page, [], [UNCATEGORIZED]);
  await expect(page.locator("#app-sidebar").getByRole("link", { name: "Events" })).toHaveAttribute("href", "/events");
});

test("built-in rows are read-only, and a user's own event can be edited and deleted", async ({ page }) => {
  await openEventsPage(page, [FOMC_EVENT, MY_EVENT], [FOMC_CATEGORY, MINE, UNCATEGORIZED]);

  const builtin = page.getByTestId("event-row-fomc-2026-06-17");
  await expect(builtin).toContainText("from a data file");
  await expect(builtin.getByRole("button")).toHaveCount(0);
  await expect(builtin.getByRole("link", { name: "www.federalreserve.gov" })).toHaveAttribute("href", FOMC_EVENT.source!);

  await page.getByTestId("event-edit-user-1").click();
  await page.getByTestId("event-form").getByLabel("Label").fill("Sold AI basket");
  await page.getByTestId("event-form").getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("event-row-user-1")).toContainText("Sold AI basket");

  await page.getByTestId("event-delete-user-1").click();
  await page.getByTestId("event-delete-confirm-user-1").click();
  await expect(page.getByTestId("event-row-user-1")).toHaveCount(0);
});

test("an added event is listed and then drawn on a chart", async ({ page }) => {
  await openEventsPage(page, [], [MINE, UNCATEGORIZED]);

  const form = page.getByTestId("event-form");
  await form.getByLabel("Date", { exact: true }).fill("2026-06-15");
  await form.getByLabel("Label").fill("Bought AI basket");
  await form.getByLabel("Category").selectOption("user-my-trades");
  await form.getByRole("button", { name: "Add event" }).click();
  await expect(page.getByTestId("events-table")).toContainText("Bought AI basket");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const chart = '[data-testid="spread-chart-ai"]';
  await expect(page.locator(chart)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("spreads-events-filter")).toHaveText(/Events · 2 of 2/);
  const withLine = await stableInkProfile(page, chart);
  await setAllEventCategories(page, "spreads-events-filter", false);
  const without = await stableInkProfile(page, chart);
  expect(addedColumns(withLine, without).length, "the added event draws no line").toBeGreaterThan(0);
});

test("a refusal from the server is shown on the form", async ({ page }) => {
  await openEventsPage(page, [], [MINE, UNCATEGORIZED]);

  const form = page.getByTestId("event-form");
  await form.getByLabel("Date", { exact: true }).fill("2026-06-15");
  await form.getByLabel("End date").fill("2026-06-01");
  await form.getByLabel("Label").fill("Backwards");
  await form.getByRole("button", { name: "Add event" }).click();

  await expect(page.getByTestId("event-form-error")).toContainText("before it starts");
});

test("a built-in category offers Reset only once changed, and Reset restores its colour", async ({ page }) => {
  await openEventsPage(page, [], [FOMC_CATEGORY, UNCATEGORIZED]);

  await expect(page.getByTestId("category-reset-fomc")).toHaveCount(0);
  await page.getByTestId("category-color-fomc").fill("#0000ff");
  await page.getByTestId("category-save-fomc").click();
  await expect(page.getByTestId("category-reset-fomc")).toBeVisible();

  await page.getByTestId("category-reset-fomc").click();
  await expect(page.getByTestId("category-color-fomc")).toHaveValue("#e54545");
  await expect(page.getByTestId("category-reset-fomc")).toHaveCount(0);
});

test("a user category in use cannot be deleted, and an unused one can", async ({ page }) => {
  await openEventsPage(page, [MY_EVENT], [FOMC_CATEGORY, MINE, EMPTY, UNCATEGORIZED]);

  await expect(page.getByTestId("category-row-fomc")).toBeVisible();
  await expect(page.getByTestId("category-delete-user-my-trades")).toBeDisabled();
  await expect(page.getByTestId("category-delete-user-my-trades")).toContainText("used by 1");
  await expect(page.getByTestId("category-delete-fomc"), "built-ins have no delete").toHaveCount(0);

  await page.getByTestId("category-delete-user-empty").click();
  await expect(page.getByTestId("category-row-user-empty")).toHaveCount(0);
});

test("a new category can be added and used", async ({ page }) => {
  await openEventsPage(page, [], [UNCATEGORIZED]);

  await page.getByTestId("category-add-label").fill("Earnings");
  await page.getByTestId("category-add-color").fill("#00aa55");
  await page.getByTestId("category-add").click();

  await expect(page.getByTestId("category-row-user-earnings")).toBeVisible();
  await expect(page.getByTestId("event-form").getByLabel("Category").locator("option", { hasText: "Earnings" })).toHaveCount(1);
});

test("a user event whose category was removed is flagged for a new one", async ({ page }) => {
  await openEventsPage(page, [{ ...MY_EVENT, category: "uncategorized", missing_category: "quad-witching" }], [UNCATEGORIZED]);

  await expect(page.getByTestId("event-missing-category-user-1")).toContainText("category removed");
  await page.getByLabel("Filter by origin").selectOption("needs-category");
  await expect(page.getByTestId("event-row-user-1")).toBeVisible();
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npx playwright test tests/e2e/events-page.spec.ts --reporter=line`
Expected: FAIL. `/events` is a 404, so `events-table` never appears.

- [ ] **Step 3: Implement**

`apps/web/app/events/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { useMarketEvents, type MarketEvent } from "@/lib/useMarketEvents";
import { CategoriesPanel } from "./components/CategoriesPanel";
import { EventForm } from "./components/EventForm";
import { EventsTable } from "./components/EventsTable";

export default function EventsPage() {
  useDevMonitorPageLoad({ component: "events_page" });
  const { events, categories, status, refetch } = useMarketEvents();
  const [editing, setEditing] = useState<MarketEvent | null>(null);

  return (
    <div className="p-6">
      <PageHeader
        title="Events"
        subtitle="Dated events drawn on every price chart. Built-in events come from sourced data files; the ones you add stay on this machine."
      />
      {status === "loading" ? <p className="text-sm text-[var(--text-muted)]">Loading events…</p> : null}
      {status === "unavailable" ? (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--state-warning)] p-4 text-sm">
          Events could not be loaded.{" "}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : null}
      {status === "ready" ? (
        <div className="flex flex-col gap-6">
          {/* Keyed by the event being edited, so switching events resets the form's fields. */}
          <EventForm key={editing?.id ?? "new"} categories={categories} editing={editing} onDone={() => setEditing(null)} />
          <CategoriesPanel categories={categories} events={events} />
          <EventsTable events={events} categories={categories} onEdit={setEditing} />
        </div>
      ) : null}
    </div>
  );
}
```

`apps/web/app/events/components/EventForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import { EventApiError } from "@/lib/marketEventsApi";
import { useCreateEvent, useUpdateEvent } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";
import type { MarketEventInput } from "../../../../../packages/shared-types";

const inputClass = "rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]";

export function EventForm({ categories, editing, onDone }: { categories: EventCategory[]; editing: MarketEvent | null; onDone: () => void }) {
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const [startDate, setStartDate] = useState(editing?.start_date ?? "");
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [category, setCategory] = useState(editing?.category ?? categories[0]?.id ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [source, setSource] = useState(editing?.source ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    // Mirrors the server's own rules so the common mistakes need no round trip; everything else
    // is the server's call, and its message is shown as-is.
    if (!startDate) return setError("A date is required.");
    if (!label.trim()) return setError("A label is required.");
    const input: MarketEventInput = {
      label: label.trim(),
      category,
      start_date: startDate,
      end_date: endDate || null,
      source: source.trim() || null,
      note: note.trim(),
    };
    const onError = (err: unknown) => setError(err instanceof EventApiError ? err.detail : "Could not save the event.");
    if (editing) {
      update.mutate({ id: editing.id, input }, { onError, onSuccess: () => { setError(null); onDone(); } });
    } else {
      create.mutate(input, {
        onError,
        onSuccess: () => {
          setError(null);
          setStartDate(""); setEndDate(""); setLabel(""); setNote(""); setSource("");
        },
      });
    }
  };

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">{editing ? `Edit “${editing.label}”` : "Add an event"}</h2>
      <form data-testid="event-form" onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Date
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          End date
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Label
          <input type="text" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] sm:col-span-2">
          Note
          <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} rows={2} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] sm:col-span-2">
          Source URL
          <input type="url" placeholder="Optional" value={source} onChange={(e) => setSource(e.target.value)} className={inputClass} />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={create.isPending || update.isPending}
            className="rounded-[var(--radius-sm)] bg-[var(--surface)] px-3 py-1 text-sm font-bold text-black disabled:opacity-50">
            {editing ? "Save changes" : "Add event"}
          </button>
          {editing ? (
            <button type="button" onClick={onDone} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1 text-sm">
              Cancel
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" data-testid="event-form-error" className="text-sm text-[var(--state-warning)] sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
```

`getByLabel("Date", { exact: true })` in the spec distinguishes `Date` from `End date`.

`apps/web/app/events/components/EventsTable.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { EventApiError } from "@/lib/marketEventsApi";
import { useDeleteEvent } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";

type OriginFilter = "all" | "builtin" | "rule" | "user" | "needs-category";

const ORIGIN_LABEL: Record<MarketEvent["origin"], string> = { builtin: "Built-in", rule: "Rule", user: "Added by you" };

function host(source: string): string {
  try {
    return new URL(source).host;
  } catch {
    return source;
  }
}

export function EventsTable({ events, categories, onEdit }: { events: MarketEvent[]; categories: EventCategory[]; onEdit: (event: MarketEvent) => void }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [confirming, setConfirming] = useState<string | null>(null);
  const deleteEvent = useDeleteEvent();
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const rows = useMemo(
    () =>
      events
        .filter((e) => categoryFilter === "all" || e.category === categoryFilter)
        .filter((e) => (originFilter === "all" ? true : originFilter === "needs-category" ? e.missing_category !== null : e.origin === originFilter))
        .sort((a, b) => b.start_date.localeCompare(a.start_date) || a.id.localeCompare(b.id)),
    [events, categoryFilter, originFilter],
  );

  return (
    <section data-testid="events-table" className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-sm font-bold text-[var(--text-primary)]">All events</h2>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Filter by category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded border border-[var(--border-default)] px-2 py-1">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Filter by origin
          <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} className="rounded border border-[var(--border-default)] px-2 py-1">
            <option value="all">All origins</option>
            <option value="builtin">Built-in</option>
            <option value="rule">Rule</option>
            <option value="user">Added by you</option>
            <option value="needs-category">Needs category</option>
          </select>
        </label>
      </div>
      {deleteEvent.isError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--state-warning)]">
          {deleteEvent.error instanceof EventApiError ? deleteEvent.error.detail : "Could not delete the event."}
        </p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--text-secondary)]">
            <tr><th className="py-1 pr-3">Date</th><th className="pr-3">Event</th><th className="pr-3">Category</th><th className="pr-3">Origin</th><th className="pr-3">Source</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              const category = byId.get(event.category);
              return (
                <tr key={event.id} data-testid={`event-row-${event.id}`} className="border-t border-[var(--border)] align-top">
                  <td className="py-2 pr-3 tabular-nums">{event.end_date ? `${event.start_date} – ${event.end_date}` : event.start_date}</td>
                  <td className="pr-3">
                    <span className="font-semibold text-[var(--text-primary)]">{event.label}</span>
                    {event.note ? <span className="block text-xs text-[var(--text-secondary)]">{event.note}</span> : null}
                  </td>
                  <td className="pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category?.color }} />
                      {category?.label ?? event.category}
                    </span>
                    {event.missing_category ? (
                      <span data-testid={`event-missing-category-${event.id}`} className="block text-xs text-[var(--state-warning)]">
                        category removed ({event.missing_category}), choose a new one
                      </span>
                    ) : null}
                  </td>
                  <td className="pr-3">{ORIGIN_LABEL[event.origin]}</td>
                  <td className="pr-3">
                    {event.source ? <a href={event.source} target="_blank" rel="noreferrer" className="underline">{host(event.source)}</a> : "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    {event.origin === "user" ? (
                      <span className="flex gap-2">
                        <button type="button" data-testid={`event-edit-${event.id}`} onClick={() => onEdit(event)} className="underline">Edit</button>
                        {confirming === event.id ? (
                          <button type="button" data-testid={`event-delete-confirm-${event.id}`} className="font-semibold text-[var(--state-warning)] underline"
                            onClick={() => deleteEvent.mutate(event.id, { onSettled: () => setConfirming(null) })}>
                            Confirm delete
                          </button>
                        ) : (
                          <button type="button" data-testid={`event-delete-${event.id}`} onClick={() => setConfirming(event.id)} className="underline">Delete</button>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">from a data file</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

`apps/web/app/events/components/CategoriesPanel.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { EventApiError } from "@/lib/marketEventsApi";
import { useCreateCategory, useDeleteCategory, usePatchCategory, useResetCategory, useSetCategoriesVisible } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";

const describe = (err: unknown, fallback: string) => (err instanceof EventApiError ? err.detail : fallback);

function CategoryRow({ category, usedBy }: { category: EventCategory; usedBy: number }) {
  const [label, setLabel] = useState(category.label);
  const [color, setColor] = useState(category.color.toLowerCase());
  const [error, setError] = useState<string | null>(null);
  const patch = usePatchCategory();
  const reset = useResetCategory();
  const remove = useDeleteCategory();
  const setVisible = useSetCategoriesVisible();
  const dirty = label.trim() !== category.label || color.toLowerCase() !== category.color.toLowerCase();

  return (
    <li data-testid={`category-row-${category.id}`} className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2 text-sm">
      <input type="checkbox" aria-label={`Show ${category.label} on charts`} checked={category.visible}
        onChange={(e) => setVisible.mutate([{ id: category.id, visible: e.target.checked }])} />
      {/* A native colour input yields #rrggbb, the one colour form the server accepts. */}
      <input type="color" aria-label={`${category.label} colour`} data-testid={`category-color-${category.id}`} value={color} onChange={(e) => setColor(e.target.value)} />
      <input type="text" aria-label={`${category.label} name`} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1" />
      <button type="button" data-testid={`category-save-${category.id}`} disabled={!dirty || patch.isPending}
        onClick={() => patch.mutate({ id: category.id, patch: { label: label.trim(), color } }, { onError: (err) => setError(describe(err, "Could not save.")), onSuccess: () => setError(null) })}
        className="rounded border border-[var(--border)] px-2 py-1 font-semibold disabled:opacity-40">
        Save
      </button>
      {category.origin === "builtin" && category.overridden ? (
        <button type="button" data-testid={`category-reset-${category.id}`} onClick={() => reset.mutate(category.id, { onError: (err) => setError(describe(err, "Could not reset.")) })}
          className="rounded border border-[var(--border)] px-2 py-1">
          Reset to default
        </button>
      ) : null}
      {category.origin === "user" ? (
        <button type="button" data-testid={`category-delete-${category.id}`} disabled={usedBy > 0}
          onClick={() => remove.mutate(category.id, { onError: (err) => setError(describe(err, "Could not delete.")) })}
          className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-40">
          {usedBy > 0 ? `Delete (used by ${usedBy})` : "Delete"}
        </button>
      ) : (
        <span className="text-xs text-[var(--text-muted)]">built-in</span>
      )}
      {error ? <p role="alert" className="w-full text-xs text-[var(--state-warning)]">{error}</p> : null}
    </li>
  );
}

function AddCategoryRow() {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#4589e5");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCategory();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 text-sm">
      <input type="color" aria-label="New category colour" data-testid="category-add-color" value={color} onChange={(e) => setColor(e.target.value)} />
      <input type="text" aria-label="New category name" data-testid="category-add-label" placeholder="New category" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1" />
      <button type="button" data-testid="category-add" disabled={!label.trim() || create.isPending}
        onClick={() => create.mutate({ label: label.trim(), color }, { onError: (err) => setError(describe(err, "Could not add the category.")), onSuccess: () => { setLabel(""); setError(null); } })}
        className="rounded border border-[var(--border)] px-2 py-1 font-semibold disabled:opacity-40">
        Add category
      </button>
      {error ? <p role="alert" className="w-full text-xs text-[var(--state-warning)]">{error}</p> : null}
    </div>
  );
}

export function CategoriesPanel({ categories, events }: { categories: EventCategory[]; events: MarketEvent[] }) {
  // Only the user's own events block a delete: file and rule events can only name built-ins.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) if (event.origin === "user") counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
    return counts;
  }, [events]);

  return (
    <section data-testid="categories-panel" className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">Categories</h2>
      <ul className="mt-2">
        {categories.map((category) => (
          // Keyed on the saved values too, so a successful save or reset resets the row's local fields.
          <CategoryRow key={`${category.id}:${category.label}:${category.color}`} category={category} usedBy={usage.get(category.id) ?? 0} />
        ))}
      </ul>
      <AddCategoryRow />
    </section>
  );
}
```

`apps/web/components/ui/Sidebar.tsx`: add `CalendarDays` to the `lucide-react` import, and
append `{ href: "/events", label: "Events", icon: CalendarDays },` after the `/valuation` entry.

- [ ] **Step 4: Run the spec to verify it passes**

Run: `npx tsc --noEmit`, then `npx playwright test tests/e2e/events-page.spec.ts --reporter=line`.
Expected: exit 0, then all pass.

- [ ] **Step 5: Mutation check**

Run only the named test after each change, then restore:
1. `EventsTable`: render the Edit and Delete buttons for every origin. Run
   `-g "built-in rows are read-only"`. Expected: FAIL.
2. `CategoriesPanel`: show Reset for every built-in. Run `-g "offers Reset only once changed"`.
   Expected: FAIL.
3. `CategoriesPanel`: drop `disabled={usedBy > 0}`. Run `-g "in use cannot be deleted"`.
   Expected: FAIL.
4. `EventForm`: replace `err.detail` with `"Could not save the event."`. Run
   `-g "refusal from the server"`. Expected: FAIL.
5. `EventsTable`: treat `needs-category` as `all`, and remove the missing-category span. Run
   `-g "flagged for a new one"`. Expected: FAIL.
6. `git diff --exit-code apps/web`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/events apps/web/components/ui/Sidebar.tsx apps/web/tests/e2e/events-page.spec.ts
git commit -m "feat(events): the Events page for user events and categories"
```

### Task D2: Docs, tracking, PR 4 gates

**Files:**
- Create: `docs/tabs/events-tab.txt`
- Modify: `docs/tabs/index.txt`, `guideline/sop/todo.md`

- [ ] **Step 1: Tab reference**

`docs/tabs/events-tab.txt`:

```text
MoneyView Tab Reference: Events

Tab
- Events

Route
- `/events`

Primary Goal
- Manage the dated events drawn as vertical lines on every price chart.
- Add, edit and delete the user's own events; recolour, rename, hide, reset and add categories.

Design Intent
- Charts only display and filter events; every edit happens here, in one place.
- Built-in events are asserted facts from sourced data files, so they are read-only here and say so.
- A user's own event may have no source; charts label it "Added by you, no source".

Layout Structure

1. Page Header
- Title: `Events`

2. Add / Edit Event Form
- Date, optional end date, label, category, note, optional source URL.
- Server refusals are shown verbatim in one alert (each names its field).

3. Categories Panel
- Per category: show-on-charts checkbox (the same global filter as every chart), colour, name, Save.
- Built-ins with a saved change offer Reset to default (label and colour; visibility is kept).
- User categories can be deleted only while no event uses them.

4. All Events Table
- Newest first; filter by category and by origin, including "Needs category".
- Built-in and rule rows read "from a data file"; user rows have Edit and Delete (with confirm).

Important Behavior
- Visibility is one global, per-machine filter stored in SQLite; it is not synced.
- A user event whose built-in category was removed shows as Uncategorized and is flagged.

Primary Data Sources
- `GET/POST/PUT/DELETE /api/v1/market/events`
- `GET/POST/PATCH/DELETE /api/v1/market/event-categories` and `DELETE .../{id}/override`
- Built-ins: `apps/api/services/events/*.json`; user data: SQLite `user_event`, `event_category`,
  `event_category_visibility`
```

In `docs/tabs/index.txt`, add `` - `events-tab.txt` `` to Files and `- Events` to "Top-Level
Sidebar Tabs Covered".

- [ ] **Step 2: Track the work**

Add to `guideline/sop/todo.md`, before `## Archived`:

```markdown
## Track J - Market event registry  [2026-09-15]

Spec: `docs/superpowers/specs/2026-09-15-market-event-registry-design.md`.
Plan: `docs/superpowers/plans/2026-09-15-market-event-registry.md`.

- [x] **J-A. Registry, sources, categories, FOMC and quad-witching data, read routes** (PR 1)
- [x] **J-B. Write routes and SQLite for user events, overrides, visibility** (PR 2)
- [x] **J-C. Coloured lines, hover tooltip, one global filter** (PR 3; reverses I-D Ruling H)
- [x] **J-D. The Events page** (PR 4)

Known limits, accepted deliberately: user events and category edits are per machine and not
synced; the tooltip shows a source's host, not a link; the XNYS calendar's coverage is fixed
when the API process starts (one year ahead), so a server left running for a year stops
generating quad-witching dates past that point until restarted.
```

Mark each item `[x]` only when its PR has merged. Commit this with whichever PR merges last.

- [ ] **Step 3: Gates**

- `npx tsc --noEmit` in `apps/web`, then ESLint on this PR's files only:
  `npx eslint $(git diff --name-only origin/renewal -- . | grep -E '\.(ts|tsx)$' | sed 's#^apps/web/##')`
- `python -m pytest -q -p no:cacheprovider` at the root
- `npx playwright test --reporter=line` in `apps/web`

Expected: all pass.

- [ ] **Step 4: Push and open PR 4**

```bash
git add docs/tabs/events-tab.txt docs/tabs/index.txt guideline/sop/todo.md
git commit -m "docs: Events tab reference and Track J"
git push -u origin events-page
```

Open PR 4 to `renewal` with the mutation checks and gate results, ending with the attribution
lines.

---

## Plan self-review (2026-09-15)

**Spec coverage.** Each spec requirement and the task that delivers it:

| Spec requirement | Task |
| --- | --- |
| §1 event and category models, `origin`, `missing_category`, `overridden` | A1 |
| §1 category storage and the normative resolution steps 1–4 | A2 (pure), B1–B2 (rows) |
| §1 resolution steps 5–6 | A4, B3 (removed-category route test) |
| §1 rule instance as data, registered kinds, injected calendar, Juneteenth shift | A3 |
| §1 registry, `register`, duplicate ids, extension by data and by code | A4 |
| §1 data shipped: geopolitical, categories, rules, FOMC from 2020 | A5, A6 |
| §2 read routes with `start`/`end` | A5 |
| §2 write routes, 404/409/422, reset, delete guard | B3 |
| §2 validation (dates, category, color, source, lengths, rule range) | A1, A3, A4, B2 |
| §2 contract mirror | A1, B3 (hand-mirrored, see Deviations) |
| §3 hook, per-category color, same-x stripes | C1, C2 |
| §3 hover tooltip without rebuilding the chart | C3, C4 mutation 1 |
| §3 one filter, optimistic with rollback, four button states | C4 |
| §3 Events page: table, form, categories panel, Reset, missing-category flag | D1 |
| §4 backend and frontend tests, mutation checks, delivery order | every task; A7, B4, C5, D2 |

**Placeholder scan.** The one intentional unknown is the quadruple witching source URL
(`<URL from Step 1>` in A5). A5 Step 1 fetches and verifies it before the file is written, with
acceptance criteria and an instruction to stop if no page qualifies. FOMC entries after the first
two come from A6 Step 1's fetched statements; the format and the internal-consistency tests are
fixed here.

**Type consistency, checked across tasks:**
- `EventLineSpec.color` (C1) is read by `buildEventLines` (C1), `EventTooltip` (C3) and the
  legend (C4).
- `eventsNearX` returns `{ x, events }` (C1); `TVChart` adds `width` to form `EventHit` (C3).
- `useUpdateEvent` / `usePatchCategory` take `{ id, input }` / `{ id, patch }` (C2), as the
  Events page calls them (D1).
- `setAllEventCategories(scope, testId, shown)` (C2) is used unchanged in C3, C4 and D1.
- The Python service names match the routes (B2 ↔ B3).
