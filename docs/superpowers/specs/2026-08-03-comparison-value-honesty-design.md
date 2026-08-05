# Comparison Value Honesty — Design

Date: 2026-08-03
Follows: `docs/superpowers/specs/2026-08-03-dcf-data-completeness-design.md`
Branch: `feat-statements-acquisition`

Two findings from that spec's final whole-branch review, deferred deliberately because both
needed frontend work outside its scope. They share one root cause, so they share one spec.

## Design principle

`dcf_value` is no longer a single quantity. Making it honest is a presentation problem, not a
valuation one: the backend already computes and persists everything needed to tell the two
apart. This spec adds one backend field that is already stored but never selected, and focuses
the remaining work on frontend presentation.

No formula changes. No new acquisition. No migration.

## Invariant

> **Every value displayed in the DCF column, used for DCF sorting, or plotted against current
> price must be an intrinsic value per share. An enterprise value is never presented as a
> per-share value.**

Every decision below follows from this one rule, and it is the rule to evaluate them against.

## `bridge_quality` semantics

Defined once here; later sections reference this table rather than restating it.

| `bridge_quality` | What `dcf_value` holds | Meaning | Shown in the DCF column |
|---|---|---|---|
| `ok` | intrinsic value per share | Every bridge input resolved from its preferred source | **yes** |
| `estimated` | intrinsic value per share | At least one input came from a documented fallback — Yahoo's reported `Net Debt` line, or `sharesOutstanding` in place of the diluted average | **yes** |
| `missing` | enterprise value, in billions | The bridge did not resolve; no per-share value could be produced | **no** — suppressed |
| absent | intrinsic value per share, or enterprise value | A legacy snapshot, or a payload from a backend predating the field | **yes** — see [Compatibility](#compatibility) |

`estimated` is displayed because it *is* a per-share value. The fallback affects how much to
trust the figure, not what quantity it is, so the invariant does not exclude it.

## Problem

### The comparison table renders two quantities in one column

`corporate_comparison.py:399-403` sets `estimated_value` to the intrinsic per-share value when
the bridge resolves, and to enterprise value otherwise. Both land in `dcf_value`.

These are **different financial quantities**, not one quantity at two scales. Enterprise value
is what the whole firm's operations are worth; intrinsic value per share is that figure bridged
to equity and divided by the share count. Comparing them, ranking them against each other, or
plotting them on one axis is meaningless no matter how close the numbers happen to fall. With
the current fixtures the gap is wide enough to notice — ≈ $158 against ≈ 2438 — but a company
with few shares outstanding would produce two similar numbers that are still not comparable,
and that case is the dangerous one because nothing looks wrong.

Three consumers treat them as one:

| Site | What it does |
|---|---|
| `CorporateComparisonTable.tsx:90` | `formatMoney(row.dcf_value)` — an enterprise value printed as `$2,438.00` |
| `corporateDerivedViews.ts:33-37` | `Number(left[sortKey]) - Number(right[sortKey])` — unbridged rows sort to the top on "DCF value" |
| `corporateDerivedViews.ts:81, 92` | scatter `dcf_value` against `current_price` — one point 15× off the others |

`bridge_quality` is persisted and returned on every row, and `apps/web/app/corporate/components/graphs/shared.ts:73`
already declares it as `bridge_quality?: string`. The three table row types do not, so nothing
in the table can distinguish the cases. The previous spec's stated mitigation — "the flag beside
them says the value is not meaningful" — was never wired.

### The history chart draws a definition change as a valuation move

Snapshots taken before the bridge landed averaged enterprise values; those taken after average
per-share values. `corporate_comparison_snapshots_v3` already stores `metric_schema_version`
per row (`0` for rows predating the column, `1` before this work, `2` after), but
`load_corporate_comparison_history` never selects it and `CorporateComparisonHistoryPoint`
never declares it. So `SnapshotHistoryModal` shows a ~15× step with nothing to say it is not
a market event.

## Decisions

| Question | Decision |
|---|---|
| Unbridged `dcf_value` in the table | **Suppressed.** Render `—`, exclude from sort and from the scatter. An enterprise value in a `$`/share column is the defect the preceding work existed to remove; a footnote beside it would still let it sort and plot against real per-share values. |
| `estimated` rows | **Keep their number** — per the semantics table, they are per-share values. Only `missing` is suppressed. |
| Where the rule lives | One exported helper, `bridgedDcfValue`. Every consumer calls it; none re-implements the `missing` check. |
| Sort placement of suppressed rows | **Last in both directions.** Not `Number(null) → 0`, which would bury them mid-table among genuinely small values. |
| History discontinuity | **Expose `metric_schema_version` and mark the boundary.** All history stays readable; a divider says the step is a definition change. |
| Which version a history point reports | `MAX(s.metric_schema_version)` over the snapshot's rows. |

### Why suppression rather than a marker

An install where statement acquisition has never run will show `—` down the whole DCF column.
That is the correct outcome, not a regression: the column currently shows a plausible dollar
figure for every such row, and not one of those figures is the quantity the column claims to
hold. A suppressed value that prompts the user to acquire statements is better than a displayed
one that misinforms.

### Why `MAX` for the history version

Every row of a snapshot is written in one transaction by `save_corporate_comparison_snapshot`,
so they necessarily share a `metric_schema_version` and `MIN` and `MAX` agree. `MAX` is chosen
so that if that invariant is ever broken the newer definition surfaces, rather than a stale one
masking a mixed snapshot.

## Backend

Small, and entirely about exposing what is already stored.

**`apps/api/models/schema_parts/corporate.py`** — `CorporateComparisonHistoryPoint` gains:

```python
    # 0 for snapshots taken before the column existed. The metric definition behind
    # average_dcf_value changed at version 2 -- rows before it averaged enterprise values,
    # rows from it average intrinsic per-share values -- so a reader comparing two points
    # across that boundary is comparing two different quantities.
    metric_schema_version: int = 0
```

**`apps/api/services/corporate_comparison.py`** — the history query's aggregate block
(`:659-661`) gains `MAX(s.metric_schema_version) AS metric_schema_version`, and the
`CorporateComparisonHistoryPoint` construction below it (`:692-694`) passes it through. The
column is already written on every insert (`:185`).

Nothing else changes. No aggregate filter moves; `average_roic_minus_wacc` stays unfiltered as
before.

## Frontend

### The helper

Declared once, in `apps/web/app/corporate/corporateDerivedViews.ts` beside the functions that
consume it:

```ts
/**
 * The row's DCF value when it is an intrinsic value per share, and null when it is not.
 *
 * When the equity bridge does not resolve, dcf_value falls back to enterprise value -- a
 * different financial quantity, not a smaller one. It cannot go in a $/share cell, be ranked
 * against per-share values, or share an axis with current_price, however close the numbers
 * happen to fall. `estimated` is a real per-share value and is returned as one.
 */
export function bridgedDcfValue(
  row: { dcf_value: number; bridge_quality?: string },
): number | null {
  return row.bridge_quality === "missing" ? null : row.dcf_value;
}
```

**This helper is the only place that decides whether a DCF value may be presented.** No
component may branch on `bridge_quality` to make that decision itself — if a fourth quality
tier is ever added, one edit here must cover every consumer. Reading `bridge_quality` to
*display the quality itself* as a labelled datum is a different thing and remains fine;
`CalculationDetailModal.tsx:478` does exactly that on the DCF report surface and is untouched
by this spec.

A row whose `bridge_quality` is absent returns its value unchanged — see below.

### Compatibility

`bridge_quality` and `metric_schema_version` are both optional additions, which makes every
deployment order safe:

| Backend | Frontend | Result |
|---|---|---|
| old | new | `bridge_quality` absent on every row; `bridgedDcfValue` returns the value; today's behaviour exactly |
| new | old | the extra fields are ignored; today's behaviour exactly |
| new | new | suppression and the history divider are active |

The absent case is deliberately permissive. Suppressing on absence would blank the DCF column
for every snapshot saved before this field existed, which distorts more history than the
mislabelling being fixed.

### Type declarations

`bridge_quality?: string` is added to the three row types that lack it, matching how
`graphs/shared.ts:73` already declares it:

- `apps/web/app/corporate/corporateTypes.ts` (the `CorporateComparisonRowApi` shape, near `:135`)
- `apps/web/app/corporate/components/CorporateComparisonTable.tsx` (near `:12`)
- `apps/web/app/corporate/components/TargetStockComparisonSection.tsx` (near `:25` and `:59`)

Optional, not required, so no existing construction site or fixture breaks.

### Consumers

| Site | Change |
|---|---|
| `CorporateComparisonTable.tsx:83-92` | `bridgedDcfValue(row)` — render `—` with a `title` when null, `formatMoney` otherwise. **Keep the button enabled.** ⚠️ **The justification originally given here was wrong — see the correction below.** |
| `corporateDerivedViews.ts:28-37` | `sortComparisonRows` — see the ordering contract below; other sort keys unaffected |
| `corporateDerivedViews.ts:75-85` | `buildSimilarComparisonScatterPeers` — drop null-DCF rows |
| `corporateDerivedViews.ts:87-96` | `buildSimilarComparisonScatterSelected` — return `[]` when the selected row's value is null |
| `TargetStockComparisonSection.tsx:426` | the chart's `dcf_value` dataKey feeds from the filtered builders above; verify no separate path bypasses them |

### The DCF sort ordering contract

Applies only when `sortKey === "dcf_value"`. The other two sort keys are untouched.

```
both values present   ->  numeric comparison, then reversed for "desc" as today
one value null        ->  the null row is ALWAYS the greater, in both directions
both values null      ->  equal; their relative order is not specified
```

"Always greater" is not the same as sorting by a sentinel. `Number(null)` is `0`, which would
place suppressed rows among genuinely small per-share values in one direction and at the far end
in the other. The null check must happen before the numeric comparison, and must not be
reversed by the direction flag.

The consequence to hold in mind: suppressed rows sit at the bottom whether the user asks for
ascending or descending. That is intentional — they have no position in a per-share ranking, so
the honest place for them is out of the ranking entirely, in a consistent spot.

### The history divider

`apps/web/app/portfolio/components/SnapshotHistoryModal.tsx` renders a `TimelineList` whose
items are grouped by date (`:51-61`), so there is no flat list of adjacent rows to insert a
divider row between — two points from the same day sit in one group, and points from different
days sit in different groups. A literal divider would have to be threaded through both cases.

The same information, in the structure the component already has:

1. **Every point carries its metric version** as a chip beside the existing
   `Version {snapshot_version}` chip in the `meta` slot (`:72-81`).
2. **The point where the version changes** — compared against the chronologically preceding
   point in the flat `history.points` array, not against its neighbour within a date group —
   additionally carries the notice.

The notice wording is fixed here so it does not drift:

> **Metric definition changed. Values before and after this point are not directly comparable.**

It states a fact about the data rather than warning of an error: nothing is wrong with either
side, only with comparing across them.

Computing the boundary against the flat array rather than the rendered grouping matters. Two
snapshots taken on the same day with different metric versions land in one date group, and a
comparison against the previous item *within* the group would miss the boundary whenever it
falls at a group edge.

The points themselves are unchanged — every average stays visible and every version readable.

The modal already carries a `NO_BRIDGED_ROWS_TITLE` constant and an `== null` guard on both
averages from the preceding work; this addition sits beside them and does not alter either.

## Testing

**This project forbids a frontend unit-test runner** — no Jest, Vitest, or Testing Library,
Playwright only. `bridgedDcfValue` and the sort comparator are pure TypeScript and would be
three-line unit tests under any other rule. They must instead be exercised end to end through
`apps/web/tests/e2e/helpers/corporatePageMock.ts`, which is slower, less direct, and covers
the same logic through the DOM. That is the cost of the standing rule and it is accepted here
rather than worked around.

`corporatePageMock.ts` already sets `bridge_quality: "ok"` on its rows (`:39`, `:96`), so the
field is present and only the other two tiers need adding. The fixture must end up carrying all
three so every branch is reachable in one page load:
- an `ok` row with a per-share `dcf_value` — already there
- an `estimated` row, which must render its number exactly like the `ok` row
- a `missing` row, which must render `—`

The `estimated` row is the one that would be lost to a careless implementation: a check written
as `bridge_quality !== "ok"` passes every test that only distinguishes `ok` from `missing`.

**Playwright** (`apps/web/tests/e2e/`):
- The `missing` row's DCF cell renders `—`, and the `ok` and `estimated` rows render currency.
- Sorting by DCF value descending puts the `missing` row last; ascending also puts it last.
  Both directions matter — a comparator returning `0` for null would pass the descending case
  alone.
- The scatter plots two points, not three.
- A snapshot history containing points at two different `metric_schema_version` values renders
  the divider between them, and one containing a single version does not.

**pytest** (`tests/api/`):
- `load_corporate_comparison_history` reports the stored `metric_schema_version`.
- A snapshot whose rows predate the column reports `0`, not the current version.

**Gates:** backend `python -m pytest tests/core_finance/ tests/api/ -q` at **460 passed**
minimum, `npx tsc --noEmit` from `apps/web` exit 0.

## Rejected alternatives

**Show the enterprise value with a warning marker and tooltip.**
Nothing disappears, and a user wanting the enterprise value can still read it. Rejected because
the two quantities remain in one sortable, plottable column — which is the mechanism by which
they get misread, and a marker does not stop a sort or a chart axis.

**Add a separate bridge-quality column to the table.**
Most informative, and it would surface the `estimated` tier explicitly. Rejected as widening an
already-wide table to display a value that is identical for most rows; the `—` carries the same
information where the reader is already looking.

**Hide averages computed under an older metric version.**
No misleading comparison would be possible. Rejected because it silently discards history the
user deliberately saved, and leaves older snapshots partly blank with nothing explaining why.

**Expose `metric_schema_version` with no UI treatment.**
Smallest possible change, and it makes the discontinuity discoverable to anyone reading the API.
Rejected because the chart still draws the step as a valuation move for everyone reading the UI,
which is where the misreading happens.

**Suppress `estimated` rows along with `missing` ones.**
Simpler rule, one branch instead of two. Rejected because the invariant is about *which
quantity* a number is, and an `estimated` row's number is an intrinsic value per share — see the
semantics table. Its fallback source affects confidence, not units. Hiding it would discard
sound data and suppress the column for most tickers.

**Backfill `metric_schema_version` on legacy rows to the current value.**
Would remove the `0` case entirely. Rejected for the reason the column exists: stamping old rows
with the current version makes pre- and post-change snapshots indistinguishable, which is
precisely what it was added to prevent (`db.py`, the `metric_schema_version` migration comment).

## Not in scope

- **Export paths.** ⚠️ **This entry was false and is corrected below.** It originally read:
  *"Checked: the corporate page has no CSV export, table copy, or snapshot download — the only
  matches for those terms are the TypeScript `export` keyword."* Three CSV exports are wired at
  `page.tsx:1270-1272` (`downloadRawDatasetCsv`, `downloadHistoricalPriceCsv`,
  `downloadQuarterlyStatementsCsv`, defined at `corporateUtils.ts:253/260/267`), and
  `corporateDerivedViews.ts:208` pushes the entire backend DCF response — `estimated_value`
  included — into the raw-dataset CSV. See the correction section below.
- Regenerating `packages/shared-types/generated/portfolio.ts`, now stale on both the new
  nullability and this field. Confirmed inert — nothing in `apps/web` imports corporate types
  from it — and regenerating needs a network install for `json2ts`.
- The `snapshot_version` → `snapshot_id` rename and removing the dead `SNAPSHOT_CADENCE`.
- `_dcf_snapshot`'s unread `status` key. Documented as internal-only; wiring it to the UI is a
  contract change with no requester.

---

## Corrections, found by the final whole-branch review (2026-08-05)

Two claims above were wrong. Both are corrected in place with a ⚠️ marker rather than quietly
edited, because a spec that silently rewrites its own history teaches the next reader to trust
claims that were never checked.

### 1. The suppressed cell's destination discloses the number it suppresses

The consumer table justified keeping the DCF cell's button enabled on the grounds that the
modal behind it is "exactly where 'why is there no value here' is answered". **It is not.**

`CorporateComparisonTable.tsx:88` opens the `backendFairValue` detail. That block
(`buildCalculationDetails.ts:891-916`) renders `moneyText(dcfData.estimated_value)` under the
label **"Intrinsic DCF Value"** three times — the summary row, the `result`, and simulation
step 3 — plus `${estimated_value} / ${current_price} - 1` in step 2. `estimated_value` carries
the *same* enterprise-value fallback as `dcf_value` (`apps/api/services/corporate_dcf.py:222`,
`corporate_comparison.py:399-403`). The bridge quality the justification pointed at
(`CalculationDetailModal.tsx:478`) belongs to `dcfFullReport`, populated only by a separate
`handleViewFullDcfReport` action under a different key.

So clicking the `—` this branch added surfaces the suppressed enterprise value one level
deeper, mislabelled as an intrinsic per-share value. **The button stays enabled** — disabling
it is not the fix and would remove a working navigation — but the stated reason was false and
the leak is real.

### 2. `estimated_value` is a second unguarded surface, on five sites

> **CLOSED 2026-08-05.** Fixed in a follow-up branch via `apps/web/lib/bridgeQuality.ts`.
> The count below is understated and left as written: there were ten render expressions
> across six files, not five sites. `buildCalculationDetails.ts` has three detail blocks
> rather than one, and `components/workbenches/DCFWorkbench.tsx:186` — "Implied Fair Value",
> live on `/detail/[ticker]` — appears in no row of this table, because the search that
> produced it was scoped to `app/corporate/`. `upside_pct` was suppressed at the same sites;
> it is hardcoded to `0.0` on an unresolved bridge and rendered as `+0.00%` in the positive
> colour. See `ERROR-LOG.md` and `guideline/sop/todo.md`.

The invariant was enforced on the field named `dcf_value`. The identical quantity ships as
`estimated_value` and is rendered raw at:

| Site | Rendered as |
|---|---|
| `buildCalculationDetails.ts:894` | "Intrinsic DCF Value", the suppressed cell's own destination |
| `buildCalculationDetails.ts:915` | simulation step 2, the upside arithmetic |
| `TargetStockComparisonSection.tsx:515` | Batch DCF Reports, "Fair Value", beside Current Price and Upside |
| `graphs/DcfCoreModulesGraph.tsx:66-68` | a 2xl KPI tile, "Intrinsic DCF Value" |
| `page.tsx:986` | the headline "Intrinsic DCF" tile, whose tooltip claims the value comes from the bridge |

None of these lines are in this branch's range — they are pre-existing, and the branch neither
introduced nor worsened them. But the invariant as written is page-wide, and it does not hold
page-wide. The discriminator is already on every payload (`bridge_quality` and
`intrinsic_value_per_share`; `graphs/shared.ts:67-74` even declares both and reads neither), so
the fix is mechanical rather than an acquisition problem.

Tracked as its own item in `guideline/sop/todo.md` rather than absorbed here: extending the
rule to five surfaces plus a CSV is a scope change, not a review nit, and it deserves its own
plan and its own tests.
