# Market event registry — design

> **Status:** DRAFT 2026-09-15, not implemented.
>
> **Review state:**
> - Sections 1 (data model and sources) and 2 (API and validation) were presented in chat and
>   approved.
> - Sections 3 (frontend) and 4 (testing and delivery) were written straight into this document
>   and **have not been reviewed yet**.
>
> **Builds on:** I-C1 market event lines (PR #34) and I-D theme and policy spreads (PR #35).
> This design **reverses I-D's Ruling H**, under which each chart surface owned its own event
> toggle; see *One filter for every chart*.

## What was asked

Show dated international events, such as the 2026 Iran war, on price charts, and:

1. hover over an event to see what it is;
2. add custom events on any date;
3. group events into categories with their own colors, e.g. Fed rate decisions as a red line
   on each announcement date;
4. filter the displayed events by category (rate decisions, quadruple witching, the Iran war);
5. build it so new events, categories and kinds of event source come from **data or a
   registered function**, not from edits to core code. No hardcoded categories, colors or
   event lists.

## Decisions taken with the user

| Question | Decision |
| --- | --- |
| Must user-added events cite a source? | **Optional**, and marked as the user's own: the tooltip reads *Added by you, no source*. Built-in events still require a source. |
| Where are events and categories edited? | A new **Events page** in the sidebar. Charts only display and filter. |
| How does the filter behave? | **One filter for all charts**, remembered across sessions. |
| How much Fed history ships? | **Every FOMC announcement from 2020 on, with its outcome**, each sourced to federalreserve.gov. |
| Architecture | **Pluggable sources behind one registry** (approach A below). |
| Holiday calendar for rule-based dates | The maintained **`exchange_calendars`** package, calendar `XNYS`. |

## What exists today

- `apps/api/services/market_events.json` is a committed file with one event, the Iran strikes
  of 28 Feb 2026.
  - `load_market_events()` refuses an event with an empty `source` or a non-ISO date.
  - `GET /market/events` returns the list.
  - `MarketEvent.category` exists, but nothing reads it.
- `lib/useMarketEvents.ts` maps events to `EventLineSpec {id, label, date}`.
- `EventLinesPrimitive` paints every line in **one color** (`--state-warning`) and has **no
  hover**.
- `EventsToggle` is a stateless show/hide button, with state held separately by each of three
  surfaces:
  - `MarketOverviewClient`
  - `SpreadsSection`
  - `OHLCVChartCard`, used by `/detail/[ticker]` and `StockDetailModal`
- The repo has no exchange-holiday calendar, and no chart subscribes to crosshair movement.

## Approaches considered

**A. Pluggable sources behind one registry (chosen).** A source is anything that returns events
for a date range. The registry merges every registered source. Built-in sources are configured
by data files, and a new *kind* of source is one class registered with the registry.

**B. Everything in SQLite, seeded from files (rejected).** A seed that runs once means a machine
never receives events added to the files later, the drift class recorded in ERROR-LOG.md
2026-09-12. Built-in data would also leave git review.

**C. Evaluate rules and files in the browser (rejected).** User events need the API anyway, and
the rule logic would sit apart from the Python tests.

---

## 1. Data model and sources

### Event

Extends today's `MarketEvent`. Every change is additive.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | str | Stable. File events keep their committed ids; rule events are `<rule_id>-<YYYY-MM-DD>`; user events are `user-<n>`. |
| `label` | str | Short tooltip header, e.g. `FOMC: cut 25bp to 4.25–4.50%`. |
| `category` | str | A category **id**. Never a color. |
| `start_date` | str | ISO `YYYY-MM-DD`. |
| `end_date` | str \| null | A range draws its line at `start_date`; the tooltip shows the range. |
| `source` | str \| null | Required for file events. Rule events carry their rule's source. Optional for user events. |
| `note` | str | Longer hover text. |
| `origin` | `"builtin"` \| `"rule"` \| `"user"` | **New.** Decides editability and the tooltip's provenance line. |

### Category

| Field | Type | Notes |
| --- | --- | --- |
| `id` | str | Slug, e.g. `fomc`. |
| `label` | str | e.g. `Fed rate decisions`. |
| `color` | str | `#RRGGBB`. |
| `visible` | bool | The global filter (§3). |
| `origin` | `"builtin"` \| `"user"` | Built-ins cannot be deleted. |

- Built-in defaults live in `apps/api/services/events/categories.json`:
  - `fomc`: red
  - `quad-witching`
  - `geopolitical`: the Iran event's existing category
- The user's changes live in an `event_category` SQLite table and **override the file by `id`**:
  a changed color or visibility on a built-in category, or a new category.
- Categories are resolved on every request as file defaults with DB overrides applied. A
  category added to the file later therefore appears on every machine, with no seed step.

### Sources

```python
class EventSource(Protocol):
    name: str
    def events(self, start: date | None, end: date | None) -> list[MarketEvent]: ...
```

| Source | Configured by | Produces |
| --- | --- | --- |
| `FileEventSource(path)` | Each `apps/api/services/events/*.json` except `categories.json` and `rules.json` | The file's events, validated (§2), `origin="builtin"` |
| `RuleEventSource(rule, calendar)` | Each entry of `apps/api/services/events/rules.json` | Generated dates, `origin="rule"` |
| `UserEventSource(db)` | The `user_event` SQLite table | User events, `origin="user"` |

**A rule is data**, not code. For example:

```json
{
  "id": "quad-witching",
  "category": "quad-witching",
  "label": "Quadruple witching",
  "note": "Quarterly expiration of stock index futures, stock index options, stock options and single-stock futures.",
  "source": "https://...",
  "kind": "nth_weekday_of_month",
  "months": [3, 6, 9, 12],
  "weekday": "FRI",
  "nth": 3,
  "if_closed": "previous_trading_day",
  "from": "2020-01-01"
}
```

- `source` is required on every rule, like a file event. For quad witching it must be an
  exchange page that states the third-Friday rule and its holiday shift, fetched and read at
  implementation.
- Monthly options expiration would be another entry with `months` 1–12, not new code.
- A rule `kind` the generator does not know fails loudly when the registry is built.
- The calendar is **injected**: tests pass a fake, and production passes `XNYS` from
  `exchange_calendars`, built once and reused.
- **The holiday shift is real and in range.** 19 Jun 2026 is June's third Friday and the
  Juneteenth market holiday, so that expiration falls on Thursday 18 Jun 2026.

### Registry

```python
class EventRegistry:
    def __init__(self, sources: Iterable[EventSource]): ...
    def register(self, source: EventSource) -> None: ...
    def events(self, start: date | None = None, end: date | None = None) -> list[MarketEvent]: ...

def default_registry(db) -> EventRegistry: ...  # built from the events/ folder and rules.json
```

- **Extending by data:** drop a new `events/<name>.json` or add a `rules.json` entry. No code
  changes.
- **Extending by code:** write a class that satisfies `EventSource` and call
  `registry.register(...)`, e.g. a future economic-calendar API. The registry, routes and
  charts are unchanged.
- Merged events are sorted by `start_date`, then `id`.
- A duplicate `id` across sources **raises**, naming both sources.

### Data shipped

| File | Contents |
| --- | --- |
| `events/geopolitical.json` | The existing Iran event, moved unchanged from `market_events.json` |
| `events/fomc.json` | Every FOMC rate announcement from 1 Jan 2020 to the most recent one before implementation, including the unscheduled March 2020 announcements, about 55 events. Each `label` states the decision and target range, and each `source` is that announcement's federalreserve.gov press release, **fetched and checked, not recalled**. |
| `events/categories.json` | `fomc` (red), `quad-witching`, `geopolitical` |
| `events/rules.json` | The quadruple witching rule |

`market_events.json` is removed. `MARKET_EVENTS_JSON` becomes the `events/` directory, and
`test_the_committed_file_is_where_the_service_says_it_is` follows it.

---

## 2. API and validation

### Routes

All routes live in `apps/api/routes/market.py`.

| Method and path | Does | Refuses |
| --- | --- | --- |
| `GET /market/events` | Merged events from every source, optionally limited by `start` and `end` (ISO dates). Today's shape plus `origin`, so existing charts keep working. | Nothing; an empty list is normal. |
| `GET /market/event-categories` | File defaults with DB overrides applied | Nothing |
| `POST /market/events` | Creates a user event and returns it | Unknown category, bad dates, empty label: **422** |
| `PUT /market/events/{id}` | Edits a user event | Builtin or rule event: **409** "built-in events are edited in their data file". Unknown id: **404**. |
| `DELETE /market/events/{id}` | Deletes a user event | Builtin or rule event: **409**. Unknown id: **404**. |
| `POST /market/event-categories` | Creates a user category. Its `id` is `user-` plus a slug of the label, e.g. `My trades` → `user-my-trades`, so it can never collide with a built-in id added to the file later. | Duplicate id, bad color: **422** |
| `PATCH /market/event-categories/{id}` | Changes `label`, `color` or `visible`. On a built-in category this writes an override row. | Unknown id: **404**. Bad color: **422**. |
| `DELETE /market/event-categories/{id}` | Deletes a user category | Built-in: **409**. Still used by N events: **409** naming N, so no event is orphaned. |

### Validation

One module is shared by every source and route:

- **Dates:** ISO `YYYY-MM-DD`, and `end_date >= start_date`.
- **Category:** must resolve.
  - In a committed file, an unknown category **raises**, the same treatment unsourced events get
    today. A typo must not make lines silently disappear.
  - Through the API it returns 422.
- **Color:** `#RRGGBB` only. That is what a color input produces, and it is unambiguous to
  validate and to paint on canvas.
- **Source:**
  - Required and non-empty for file events.
  - Optional for user events, but when given it must be an `http(s)://` URL.
  - Rule events carry the rule's `source`.
  - The existing check that a source's URL names no other month or year than its event's
    applies to file events.
- **Lengths:** `label` 1–120 characters, `note` 0–2000.
- **Duplicate ids** across sources raise, naming both sources.
- **Rule range:** from the rule's `from` date to the last date the injected calendar covers
  (for XNYS, about one year ahead). A date past the calendar's end is not generated, because
  it cannot be placed correctly without holiday data.

### Failure behavior

- **Backend:** committed data that fails validation raises, and tests catch it before merge.
- **Frontend:** a failed events or categories request yields no lines, as today. An event
  overlay must never take a price chart down.

### Contract

The Pydantic models in `apps/api/models/schema_parts/market.py` are the source of truth. Shared
TypeScript types are regenerated with `scripts/export_schema.py`, per
`docs/architecture/schema-evolution.md`.

---

## 3. Frontend (not yet reviewed)

### One data hook

`useMarketEvents()` fetches events and categories under two shared React Query keys. It returns
`lines`: events whose category is `visible`, each carrying what the chart paints and shows:

```ts
interface EventLineSpec {
  id: string;
  date: string;          // ISO
  color: string;         // from the category
  label: string;
  note?: string;
  categoryLabel?: string;
  source?: string | null;
  origin?: "builtin" | "rule" | "user";
  endDate?: string | null;
}
```

- **Charts know nothing about categories.** `TVChart` paints and hit-tests whatever
  `EventLineSpec[]` it receives. Any caller can pass its own list, e.g. earnings dates for one
  ticker, without touching `TVChart`, `EventLinesPrimitive` or the hook. That is the "pass
  data" half of the extensibility requirement on the frontend.
- The returned arrays stay memoised on query data. `TVChart` is `React.memo` and compares
  `events` by identity, and a fresh array per render would rebuild work on every parent
  render.

### Per-category color

- `EventLinesPrimitive` paints each line in its own `color`, keeping today's alpha and width.
- The single `eventColor` prop is removed.
- Lines that land on the same x coordinate are painted once per distinct color, offset by one
  bitmap pixel, so two categories on one date stay distinguishable. This happens on monthly
  bars, and when two events share a date.

### Hover tooltip

- `TVChart` subscribes to the chart's crosshair movement. A pure, unit-tested function
  `eventsNearX(x, placedLines, tolerancePx = 6)` returns every event whose line is within
  tolerance of the pointer.
- When the result is non-empty, an absolutely positioned tooltip inside the chart container
  lists each event:
  - color swatch and `label`
  - date, or date range
  - `categoryLabel`
  - `note`
  - the provenance line: `Source` linked for builtin and rule events, `Added by you` for user
    events, or `Added by you, no source`
- The tooltip flips to the left near the right edge, and disappears when the pointer leaves.
- **The subscription must not rebuild the chart.** It is attached in the setup effect and reads
  the latest lines through a ref. The zoom-preservation guarantee from PR #34
  (`detail-chart-stability.spec.ts`) must keep holding.

### One filter for every chart

- `EventsToggle` is replaced by `EventFilter`: a button opening a popover with one checkbox and
  color swatch per category, plus *All* and *None*.
- Toggling a category `PATCH`es its `visible` flag and invalidates the categories query. Every
  chart on every page then updates, and the choice survives reloads and restarts because it
  lives in the database.
- `MarketOverviewClient`, `SpreadsSection` and `OHLCVChartCard` drop their own `showEvents`
  state and render `EventFilter`. This **reverses I-D Ruling H**, deliberately: the user chose
  one global filter.
- **Visible feedback:** an optimistic update applies the new visibility immediately. A failed
  `PATCH` rolls it back and shows an inline error in the popover.

### Events page (`/events`)

- **Sidebar entry:** `Events`.
- **Events table:** date, label, category chip, origin, source link.
  - Filterable by category and origin, sorted by date, newest first.
  - Builtin and rule rows are read-only, with the note "from a data file".
  - User rows have Edit and Delete.
- **Add/edit form:** date, optional end date, label, category (select), note, optional source.
  - Server validation messages are shown against their fields.
  - A new event appears on charts without a reload, via query invalidation.
- **Categories panel:** each category shows its label, a color input (`<input type="color">`,
  which yields `#RRGGBB`) and a visible checkbox. User categories have Delete, which is
  disabled with the event count shown while events still use the category. An *Add category*
  row sits at the end.

---

## 4. Testing and delivery (not yet reviewed)

Every new test must be shown to fail against a named broken implementation before it is
trusted (CLAUDE.md §8, `guideline/sop/test-verification.md`).

### Backend (pytest)

- **Registry:**
  - merges all sources
  - sorts by date, then id
  - a duplicate id raises naming both sources
  - `register()` adds a source without other changes
- **File source:** the existing unsourced, bad-date and missing-file behaviors; an unknown
  category raises; `end_date < start_date` raises.
- **Rule source:**
  - With a fake calendar: nth weekday, and the shift to the previous trading day.
  - With the real XNYS: quad witching in 2026 is exactly 20 Mar, 18 Jun, 18 Sep and 18 Dec.
    - 20 Mar, 18 Sep and 18 Dec are plain third Fridays.
    - 18 Jun is the shifted one: 19 Jun is Juneteenth.
  - An unknown `kind` raises.
- **User events and categories through the routes:**
  - create, edit and delete a user event
  - 409 on builtin and rule events
  - 422 cases
  - a built-in category override persists, and a later file default still appears
  - category delete is refused while in use
- **Committed data:**
  - every FOMC event has a federalreserve.gov `https` source, a unique date and a known
    category
  - the existing source month/year check applies to every file

### Frontend

- **Pure unit specs:** `eventsNearX` tolerance and multiple hits; the same-x color offset.
- **Playwright:**
  - Hovering a line shows its label, category and provenance. A user event without a source
    says so.
  - Lines of two categories are painted in their two colors, sampled from the canvas.
  - Unchecking a category removes its lines from **two different charts**, and it stays
    unchecked after a reload.
  - Adding an event on `/events` makes it appear on a chart. A built-in row has no Edit.
  - The existing zoom-preservation, monthly-placement and event-line specs keep passing.

### Delivery order

Each step is its own PR, and each leaves `renewal` working:

1. **Registry, sources, categories, data files.** `GET /market/events` gains `origin`, and
   `GET /market/event-categories` is added. Charts are unchanged.
2. **Write routes and SQLite tables.**
3. **Charts:** per-category color, tooltip, global `EventFilter`.
4. **The `/events` page and sidebar entry.**

`exchange_calendars` is added to `pyproject.toml` in step 1.

## Out of scope

- Drawing ranges as shaded bands (a range is a start line plus a tooltip range).
- Per-chart filters, or overriding the global filter on one chart.
- Adding an event by clicking a chart.
- Importing or exporting events.
- An economic-calendar API source. The registry is designed for one, but none is built.
- **Syncing user events or category changes between machines.** They live in each machine's
  local database, while built-in events travel with git.
