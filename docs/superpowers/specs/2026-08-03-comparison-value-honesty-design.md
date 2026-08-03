# Comparison Value Honesty — Design

Date: 2026-08-03
Follows: `docs/superpowers/specs/2026-08-03-dcf-data-completeness-design.md`
Branch: `feat-statements-acquisition`

Two findings from that spec's final whole-branch review, deferred deliberately because both
needed frontend work outside its scope. They share one root cause, so they share one spec.

## Design principle

`dcf_value` is no longer a single quantity. Making it honest is a presentation problem, not
a valuation one: the backend already computes and persists everything needed to tell the two
apart. This spec adds one backend field that is already stored but never selected, and spends
the rest of its effort making the frontend stop conflating two kinds of number.

No formula changes. No new acquisition. No migration.

## Problem

### The comparison table renders two quantities in one column

`corporate_comparison.py:399-403` sets `estimated_value` to the intrinsic per-share value when
the bridge resolves, and to enterprise value otherwise. Both land in `dcf_value`. With the
current fixtures a resolved row carries ≈ $158 and an unresolved one ≈ 2438 — the latter being
billions of currency, not a share price.

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
| Unbridged `dcf_value` in the table | **Suppressed.** Render `—`, exclude from sort and from the scatter. An enterprise value in a `$`/share column is the exact defect the preceding work existed to remove; a footnote beside it would still let it sort and plot against real per-share values. |
| `estimated` rows | **Keep their number.** Their net debt came from Yahoo's reported `Net Debt` line or their share count from `sharesOutstanding` — defensible figures, and genuinely per-share. Only `missing` is suppressed. |
| Where the rule lives | One exported helper, `bridgedDcfValue`. Every consumer calls it; none re-implements the `missing` check. |
| Sort placement of suppressed rows | **Last in both directions.** Not `Number(null) → 0`, which would bury them mid-table among genuinely small values. |
| History discontinuity | **Expose `metric_schema_version` and mark the boundary.** All history stays readable; a divider says the step is a definition change. |
| Which version a history point reports | `MAX(s.metric_schema_version)` over the snapshot's rows. |

### Why suppression rather than a marker

An install where statement acquisition has never run will show `—` down the whole DCF column.
That is the correct outcome, not a regression: the column currently shows a plausible dollar
figure for every such row, and every one of those figures is wrong by three orders of
magnitude. A blank column that prompts the user to acquire statements is better than a full one
that misinforms.

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
 * The row's DCF value when it is genuinely a per-share price, and null when it is not.
 *
 * When the equity bridge does not resolve, dcf_value falls back to enterprise value in
 * billions -- a number three orders of magnitude away from a share price, and meaningless
 * in a $ cell, a sort against per-share values, or a scatter axis paired with current_price.
 * `estimated` still resolves to a real per-share value and is returned as one.
 */
export function bridgedDcfValue(
  row: { dcf_value: number; bridge_quality?: string },
): number | null {
  return row.bridge_quality === "missing" ? null : row.dcf_value;
}
```

A row whose `bridge_quality` is absent entirely — a legacy snapshot, or a payload from an older
backend — returns its value unchanged. Suppressing on absence would blank the column for every
historical snapshot, which is a bigger lie than the one being fixed.

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
| `CorporateComparisonTable.tsx:90` | `bridgedDcfValue(row)` — render `—` with a `title` when null, `formatMoney` otherwise |
| `corporateDerivedViews.ts:28-37` | `sortComparisonRows` — when `sortKey === "dcf_value"`, null rows sort last regardless of direction; other sort keys unaffected |
| `corporateDerivedViews.ts:75-85` | `buildSimilarComparisonScatterPeers` — drop null-DCF rows |
| `corporateDerivedViews.ts:87-96` | `buildSimilarComparisonScatterSelected` — return `[]` when the selected row's value is null |
| `TargetStockComparisonSection.tsx:426` | the chart's `dcf_value` dataKey feeds from the filtered builders above; verify no separate path bypasses them |

### The history divider

`apps/web/app/portfolio/components/SnapshotHistoryModal.tsx` renders a divider between two
adjacent points whose `metric_schema_version` differs, worded so it reads as a definition
change rather than a data gap. The points themselves are unchanged — every average stays
visible and every version stays readable.

The modal already carries a `NO_BRIDGED_ROWS_TITLE` constant and an `== null` guard on both
averages from the preceding work; this addition sits beside them and does not alter either.

## Testing

**This project forbids a frontend unit-test runner** — no Jest, Vitest, or Testing Library,
Playwright only. `bridgedDcfValue` and the sort comparator are pure TypeScript and would be
three-line unit tests under any other rule. They must instead be exercised end to end through
`apps/web/tests/e2e/helpers/corporatePageMock.ts`, which is slower, less direct, and covers
the same logic through the DOM. That is the cost of the standing rule and it is accepted here
rather than worked around.

The mock fixture carries three rows so every branch is reachable in one page load:
- one `bridge_quality: "ok"` row with a per-share `dcf_value`
- one `"estimated"` row, which must render its number like the `ok` row
- one `"missing"` row, which must render `—`

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
Simpler rule, one branch instead of two. Rejected because an `estimated` value is a real
per-share price — its net debt came from Yahoo's reported `Net Debt` line, or its share count
from `sharesOutstanding` rather than the diluted average. Hiding it would discard sound data and
blank the column for most tickers.

**Backfill `metric_schema_version` on legacy rows to the current value.**
Would remove the `0` case entirely. Rejected for the reason the column exists: stamping old rows
with the current version makes pre- and post-change snapshots indistinguishable, which is
precisely what it was added to prevent (`db.py`, the `metric_schema_version` migration comment).

## Not in scope

- Regenerating `packages/shared-types/generated/portfolio.ts`, now stale on both the new
  nullability and this field. Confirmed inert — nothing in `apps/web` imports corporate types
  from it — and regenerating needs a network install for `json2ts`.
- The `snapshot_version` → `snapshot_id` rename and removing the dead `SNAPSHOT_CADENCE`.
- `_dcf_snapshot`'s unread `status` key. Documented as internal-only; wiring it to the UI is a
  contract change with no requester.
