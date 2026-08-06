# Comparison Value Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the corporate comparison table presenting an enterprise value as an intrinsic value per share, and stop the snapshot history drawing a metric-definition change as a valuation move.

**Architecture:** One backend field already stored but never selected (`metric_schema_version` on the history payload). On the frontend, one exported helper — `bridgedDcfValue` — becomes the only place that decides whether a DCF value may be presented; the table cell, the sort comparator and the two scatter builders all consume it. The history modal gains a per-point version chip and a boundary notice.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, SQLite, pytest; Next.js 15, TypeScript, recharts, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-03-comparison-value-honesty-design.md`

## Global Constraints

- **The invariant, copied verbatim from the spec.** Every value displayed in the DCF column, used for DCF sorting, or plotted against current price must be an intrinsic value per share. An enterprise value is never presented as a per-share value.
- **`bridge_quality` semantics** — the table this plan is written against:

  | `bridge_quality` | What `dcf_value` holds | Shown in the DCF column |
  |---|---|---|
  | `ok` | intrinsic value per share | yes |
  | `estimated` | intrinsic value per share | **yes** |
  | `missing` | enterprise value, in billions | no — suppressed |
  | absent | either | yes |

- **A check written `bridge_quality !== "ok"` is a defect**, and it passes any test that only distinguishes `ok` from `missing`. Every fixture in this plan carries an `estimated` row for exactly that reason.
- **`bridgedDcfValue` is the only place that decides whether a DCF value may be presented.** No component may branch on `bridge_quality` to make that decision. Reading `bridge_quality` to display the quality itself as a labelled datum is different and remains fine — `CalculationDetailModal.tsx:478` does that and is untouched.
- **No frontend unit-test runner.** No Jest, Vitest, or Testing Library. Playwright only.
- **No network in tests.**
- **Missing values stay missing.** Never substitute `0.0` or `""` for an absent financial input.
- **Backend suite floor: 460 passed**, `python -m pytest tests/core_finance/ tests/api/ -q` from the repo root.
- **`npx tsc --noEmit` from `apps/web` must exit 0.**
- **Commit message trailer**, on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **PowerShell caveat:** `git commit -m` with a message containing double quotes breaks argument parsing on this machine. Write the message to a file and use `git commit -F <file>`.
- **`apps/web/test-results/.last-run.json` is dirty in the working tree.** Leave it alone; never `git add -A`.
- **Run backend commands from the repo root** `C:\Learn\Economy\MoneyView`; run `tsc` and Playwright from `apps/web`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `apps/api/models/schema_parts/corporate.py` | `CorporateComparisonHistoryPoint.metric_schema_version`. Modify. | 1 |
| `apps/api/services/corporate_comparison.py` | Select and pass through the version. Modify. | 1 |
| `tests/api/test_corporate_comparison.py` | Backend coverage for the new field. Modify. | 1 |
| `apps/web/app/corporate/corporateDerivedViews.ts` | `bridgedDcfValue`, the sort comparator, the two scatter builders. Modify. | 2, 3 |
| `apps/web/app/corporate/corporateTypes.ts` | `bridge_quality?` on `CorporateComparisonRowApi`. Modify. | 2 |
| `apps/web/app/corporate/components/CorporateComparisonTable.tsx` | `bridge_quality?` on `ComparisonTableRow`; the suppressed cell. Modify. | 2 |
| `apps/web/app/corporate/components/TargetStockComparisonSection.tsx` | `bridge_quality?` on `ComparisonRow`. Modify. | 2 |
| `apps/web/tests/e2e/helpers/corporatePageMock.ts` | Fixture rows for all three tiers. Modify. | 2 |
| `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts` | **Create.** Cell, sort and scatter behaviour. | 2, 3 |
| `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx` | Version chip and boundary notice. Modify. | 4 |
| `apps/web/app/portfolio/page.tsx` | `metric_schema_version` on the history point type, if declared there. Modify. | 4 |
| `apps/web/tests/e2e/` (portfolio spec) | History divider coverage. Modify or create. | 4 |

Task 1 is backend-only and independent. Tasks 2 and 3 both touch `corporateDerivedViews.ts` and must run in order. Task 4 is independent of 2 and 3.

---

### Task 1: Expose `metric_schema_version` on the history payload

**Files:**
- Modify: `apps/api/models/schema_parts/corporate.py` (`CorporateComparisonHistoryPoint`, around line 299)
- Modify: `apps/api/services/corporate_comparison.py` (the history query's aggregate block at `:659-661`, and the `CorporateComparisonHistoryPoint` construction at `:692-694`)
- Test: `tests/api/test_corporate_comparison.py`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `CorporateComparisonHistoryPoint.metric_schema_version: int`, defaulting to `0`. Task 4's frontend reads it.

**Read first:** `apps/api/services/corporate_comparison.py:640-700`. The column is already written on every insert (`:185`); only the read path lacks it.

- [ ] **Step 1: Write the failing tests**

Add to `tests/api/test_corporate_comparison.py`. The file already has `_insert_snapshot_rows` and `_history_point` helpers from earlier work — reuse them. `_insert_snapshot_rows` currently hardcodes `metric_schema_version` as `2` in its parameter tuple; parameterise it so these tests can write other values.

```python
def test_the_history_point_reports_the_stored_metric_schema_version(tmp_path, monkeypatch):
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "ok", 100.0, 3.0)], metric_schema_version=2)
    assert _history_point().metric_schema_version == 2


def test_a_snapshot_predating_the_column_reports_version_zero(tmp_path, monkeypatch):
    # Rows written before metric_schema_version existed carry 0, and the history must say so
    # rather than claiming the current version. Averages either side of that boundary are
    # different quantities; 0 is what makes the boundary visible.
    monkeypatch.setattr(db_service, "_DB_PATH", tmp_path / "moneyview.db")
    db_service.init_db()
    _insert_snapshot_rows([("AAA", "ok", 100.0, 3.0)], metric_schema_version=0)
    assert _history_point().metric_schema_version == 0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_corporate_comparison.py -k metric_schema_version -v`
Expected: FAIL — `AttributeError: 'CorporateComparisonHistoryPoint' object has no attribute 'metric_schema_version'`

- [ ] **Step 3: Write the implementation**

In `apps/api/models/schema_parts/corporate.py`, add to `CorporateComparisonHistoryPoint` after `stock_count`:

```python
    # 0 for snapshots taken before the column existed. The metric definition behind
    # average_dcf_value changed at version 2 -- rows before it averaged enterprise values,
    # rows from it average intrinsic per-share values -- so a reader comparing two points
    # across that boundary is comparing two different financial quantities, not one
    # quantity that moved.
    metric_schema_version: int = 0
```

In `apps/api/services/corporate_comparison.py`, add to the aggregate SELECT beside the existing aggregates:

```sql
                      MAX(s.metric_schema_version) AS metric_schema_version,
```

and to the `CorporateComparisonHistoryPoint(...)` construction:

```python
            # MAX, not MIN: every row of a snapshot is written in one transaction so they
            # necessarily share a version, and if that invariant is ever broken the newer
            # definition should surface rather than a stale one masking a mixed snapshot.
            metric_schema_version=int(row["metric_schema_version"] or 0),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_corporate_comparison.py -v`
Expected: PASS, the whole file.

- [ ] **Step 5: Run the full backend suite**

Run: `python -m pytest tests/core_finance/ tests/api/ -q`
Expected: 460 or higher, 0 failed. Report the number.

- [ ] **Step 6: Commit**

```bash
git add apps/api/models/schema_parts/corporate.py apps/api/services/corporate_comparison.py tests/api/test_corporate_comparison.py
git commit -F <message-file>
```

Message:
```
feat: report the metric schema version on the history payload

corporate_comparison_snapshots_v3 has stored metric_schema_version per row
since the bridge work, but the history query never selected it and the
history point never declared it. So a client had no way to see that
average_dcf_value means enterprise value before version 2 and intrinsic
value per share from version 2 on -- two different quantities charted as
one series.

MAX over the snapshot's rows: they share a version by construction, and if
that ever breaks the newer definition should surface rather than a stale
one masking it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 2: `bridgedDcfValue`, the types, and the suppressed cell

**Files:**
- Modify: `apps/web/app/corporate/corporateDerivedViews.ts`
- Modify: `apps/web/app/corporate/corporateTypes.ts` (`CorporateComparisonRowApi`, around line 126-144)
- Modify: `apps/web/app/corporate/components/CorporateComparisonTable.tsx` (`ComparisonTableRow` at `:5-19`, the DCF cell at `:83-92`)
- Modify: `apps/web/app/corporate/components/TargetStockComparisonSection.tsx` (`ComparisonRow` at `:18-32`)
- Modify: `apps/web/tests/e2e/helpers/corporatePageMock.ts`
- Test: `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts` (**create**)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `bridgedDcfValue(row: { dcf_value: number; bridge_quality?: string }): number | null`, exported from `apps/web/app/corporate/corporateDerivedViews.ts`. Task 3 consumes it.

**Read first:** `apps/web/tests/e2e/helpers/corporatePageMock.ts` in full. It already sets `bridge_quality: "ok"` at `:39` and `:96` — the field is present and only the other two tiers need adding. Read a neighbouring spec in `apps/web/tests/e2e/` for the file's conventions before writing a new one.

- [ ] **Step 1: Extend the mock fixture**

The fixture's `baseRows` (around `:267`) currently holds a benchmark row (`dcf_value: 110`) and `AAPL` (`dcf_value: 240.5`), among others. Add two rows to it, copying an existing row's shape and changing only what must differ:

```ts
      {
        ticker: "ESTM",
        name: "Estimated Bridge Co",
        sector: "Technology",
        group_name: "core",
        weight: 0.1,
        roic: 15,
        wacc: 10,
        roic_minus_wacc: 5,
        // A real intrinsic value per share, reached through a documented fallback input.
        // It must render exactly like an `ok` row -- this is the row that catches a guard
        // written `!== "ok"` instead of `=== "missing"`.
        dcf_value: 300.0,
        bridge_quality: "estimated",
        current_price: 250.0,
        dcf_implied_return: 20.0,
        capm_expected_return: 11.0,
        stock_expected_return: 20.0,
        market_expected_return: 9.7,
        expected_return_spread: 10.3,
        stock_expected_return_source: "dcf_implied_upside",
        has_price_data: true,
      },
      {
        ticker: "MISS",
        name: "No Bridge Co",
        sector: "Technology",
        group_name: "core",
        weight: 0.1,
        roic: 12,
        wacc: 10,
        roic_minus_wacc: 2,
        // An enterprise value in billions, which is what dcf_value actually holds when the
        // bridge does not resolve. Deliberately the LARGEST value in the fixture: a
        // comparator that fails to suppress it sorts it first on "DCF value descending",
        // which is exactly what the sort test detects.
        dcf_value: 2438.0,
        bridge_quality: "missing",
        current_price: 240.0,
        dcf_implied_return: 0.0,
        capm_expected_return: 11.0,
        stock_expected_return: 0.0,
        market_expected_return: 9.7,
        expected_return_spread: -9.7,
        stock_expected_return_source: "dcf_implied_upside",
        has_price_data: true,
      },
```

Also add `bridge_quality: "ok"` to the existing `baseRows` entries that lack it, so the fixture states every row's tier rather than relying on absence.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts`. Use the mock helper the same way neighbouring specs do.

```ts
test("a row whose bridge did not resolve shows no DCF value", async ({ page }) => {
  // dcf_value falls back to enterprise value when the bridge does not resolve. That is a
  // different financial quantity from an intrinsic value per share -- not a smaller one --
  // so it cannot appear in a $/share column however close the numbers happen to fall.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(rowCell(page, "MISS", "DCF Value")).toHaveText("—");
});

test("an estimated bridge still shows its value", async ({ page }) => {
  // The guard must be `=== "missing"`, never `!== "ok"`. An estimated row's number IS an
  // intrinsic value per share -- the fallback source affects confidence, not units -- and
  // a test that only distinguishes ok from missing would pass against the wrong check.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(rowCell(page, "ESTM", "DCF Value")).not.toHaveText("—");
  await expect(rowCell(page, "ESTM", "DCF Value")).toContainText("$");
});

test("the suppressed cell still opens its calculation detail", async ({ page }) => {
  // The cell is a button onto the modal that explains WHY there is no value
  // (CalculationDetailModal renders bridge quality). Disabling it would take the
  // explanation away along with the number.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await rowCell(page, "MISS", "DCF Value").getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
```

Write `rowCell` and `gotoComparison` concretely against the page's real DOM — locate the DCF Value column by its header text so the helper survives a column reorder. Do not leave them as sketches.

- [ ] **Step 3: Run tests to verify they fail**

Run from `apps/web`: `npx playwright test corporate-comparison-bridge --reporter=line`
Expected: FAIL — the `MISS` cell renders a currency string, not `—`.

If the harness reports a port already in use (8110 or 3101), a previous run left servers behind. Find and kill them:
```powershell
Get-NetTCPConnection -LocalPort 8110 -State Listen
taskkill /PID <id> /T /F
```

- [ ] **Step 4: Write the helper**

In `apps/web/app/corporate/corporateDerivedViews.ts`, above `sortComparisonRows`:

```ts
/**
 * The row's DCF value when it is an intrinsic value per share, and null when it is not.
 *
 * When the equity bridge does not resolve, dcf_value falls back to enterprise value -- a
 * different financial quantity, not a smaller one. It cannot go in a $/share cell, be ranked
 * against per-share values, or share an axis with current_price, however close the numbers
 * happen to fall. `estimated` is a real per-share value and is returned as one.
 *
 * This is the only place that decides whether a DCF value may be presented. Do not branch on
 * bridge_quality elsewhere: a fourth quality tier must be one edit, not a search.
 */
export function bridgedDcfValue(
  row: { dcf_value: number; bridge_quality?: string },
): number | null {
  return row.bridge_quality === "missing" ? null : row.dcf_value;
}
```

- [ ] **Step 5: Add the type declarations**

Add `bridge_quality?: string;` after `has_price_data` in each of:
- `corporateTypes.ts` → `CorporateComparisonRowApi`
- `CorporateComparisonTable.tsx` → `ComparisonTableRow`
- `TargetStockComparisonSection.tsx` → `ComparisonRow`

Optional, so no existing construction site or fixture breaks.

- [ ] **Step 6: Suppress the cell**

In `CorporateComparisonTable.tsx`, replace the DCF cell's `{formatMoney(row.dcf_value)}` (`:90`). Keep the button and its existing classes and handler; change only the label and add a title when suppressed:

```tsx
{bridgedDcfValue(row) === null ? "—" : formatMoney(row.dcf_value)}
```

with `title="The equity bridge did not resolve for this ticker, so no intrinsic value per share is available."` applied when it is null. Import `bridgedDcfValue` from `../corporateDerivedViews`.

- [ ] **Step 7: Run tests to verify they pass**

Run from `apps/web`:
```
npx playwright test corporate-comparison-bridge --reporter=line
npx tsc --noEmit
```
Expected: 3 passed; `tsc` exit 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/corporate/corporateDerivedViews.ts apps/web/app/corporate/corporateTypes.ts apps/web/app/corporate/components/CorporateComparisonTable.tsx apps/web/app/corporate/components/TargetStockComparisonSection.tsx apps/web/tests/e2e/helpers/corporatePageMock.ts apps/web/tests/e2e/corporate-comparison-bridge.spec.ts
git commit -F <message-file>
```

Message:
```
fix: stop showing an enterprise value in the per-share DCF column

dcf_value carries an intrinsic value per share when the equity bridge
resolves and an enterprise value when it does not. Those are different
financial quantities, not one quantity at two scales, so the column was
mislabelling roughly whichever rows had no stored statements.

bridge_quality was already persisted and returned, and graphs/shared.ts
already declared it, but none of the three table row types did -- so
nothing in the table could tell the cases apart.

bridgedDcfValue is now the only place that decides whether a DCF value may
be presented. estimated rows keep their number: the fallback source
affects confidence, not units.

The cell stays a button. It opens the calculation detail modal, which is
where the bridge quality is shown and therefore where "why is there no
value here" gets answered.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 3: The sort comparator and the scatter builders

**Files:**
- Modify: `apps/web/app/corporate/corporateDerivedViews.ts` (`sortComparisonRows` at `:28-37`, `buildSimilarComparisonScatterPeers` at `:75-85`, `buildSimilarComparisonScatterSelected` at `:87-96`)
- Test: `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts` (extend)

**Interfaces:**
- Consumes: `bridgedDcfValue` from Task 2.
- Produces: no new exported names.

**The ordering contract, copied from the spec.** Applies only when `sortKey === "dcf_value"`; the other two keys are untouched.

```
both values present   ->  numeric comparison, then reversed for "desc" as today
one value null        ->  the null row is ALWAYS the greater, in both directions
both values null      ->  equal; relative order unspecified
```

`Number(null)` is `0`, which would place suppressed rows among genuinely small per-share values in one direction and at the far end in the other. **The null check must happen before the numeric comparison and must not be reversed by the direction flag.**

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/tests/e2e/corporate-comparison-bridge.spec.ts`:

```ts
test("a suppressed row sorts last in both directions", async ({ page }) => {
  // Both directions matter. MISS carries the largest raw dcf_value in the fixture (2438),
  // so a comparator that fails to suppress it puts it FIRST on descending. And one that
  // suppresses via Number(null) -> 0 puts it first on ascending instead. Only a check that
  // precedes the numeric comparison and ignores the direction flag passes both.
  await mockCorporatePageApi(page);
  await gotoComparison(page);

  await sortBy(page, "dcf_value", "desc");
  const descending = await tickerOrder(page);
  expect(descending.at(-1)).toBe("MISS");

  await sortBy(page, "dcf_value", "asc");
  const ascending = await tickerOrder(page);
  expect(ascending.at(-1)).toBe("MISS");

  // The rest of the table really did reverse, so "MISS last both times" is the null rule
  // at work and not a table that failed to re-sort at all.
  expect(ascending.slice(0, -1)).toEqual([...descending.slice(0, -1)].reverse());
});

test("a suppressed row is not plotted against current price", async ({ page }) => {
  // dcf_value is a scatter axis paired with current_price. An enterprise value there is
  // not an outlier point, it is a different quantity sharing an axis.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await selectSimilarComparison(page);

  const plotted = await plottedTickers(page);
  expect(plotted).not.toContain("MISS");
  expect(plotted).toContain("ESTM");
});
```

Assert MISS's **position** rather than a hardcoded full ordering: the fixture may gain rows later, and a full-order assertion would then fail for a reason unrelated to this rule.

Write `sortBy`, `tickerOrder`, `selectSimilarComparison` and `plottedTickers` concretely against the real DOM. The sort control is a `<select>` at `TargetStockComparisonSection.tsx:290` with a `dcf_value` option at `:295`; find the direction control beside it. For `plottedTickers`, recharts renders each scatter point as an SVG element — inspect the rendered markup and key off whatever carries the ticker, rather than counting nodes blindly. Read the DOM; do not guess selectors.

- [ ] **Step 2: Run tests to verify they fail**

Run from `apps/web`: `npx playwright test corporate-comparison-bridge --reporter=line`
Expected: FAIL — `MISS` appears first under descending sort, and the scatter plots one point too many.

- [ ] **Step 3: Write the implementation**

Replace `sortComparisonRows`:

```ts
export function sortComparisonRows(
  rows: CorporateComparisonRowApi[] = [],
  sortKey: ComparisonSortKey,
  sortDirection: "desc" | "asc",
) {
  return [...rows].sort((left, right) => {
    if (sortKey === "dcf_value") {
      // A row with no per-share value has no position in a per-share ranking, so it goes
      // last whichever way the user sorts. This check must precede the numeric comparison
      // and must NOT be reversed by sortDirection: Number(null) is 0, which would bury
      // these rows among genuinely small values in one direction.
      const leftValue = bridgedDcfValue(left);
      const rightValue = bridgedDcfValue(right);
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const dcfDelta = leftValue - rightValue;
      return sortDirection === "asc" ? dcfDelta : -dcfDelta;
    }
    const delta = Number(left[sortKey]) - Number(right[sortKey]);
    return sortDirection === "asc" ? delta : -delta;
  });
}
```

In `buildSimilarComparisonScatterPeers`, drop unbridged rows before mapping:

```ts
  return rows
    .filter((row) => row.ticker !== selectedTicker)
    // An enterprise value on an axis paired with current_price is not an outlier point,
    // it is a different quantity sharing an axis.
    .filter((row) => bridgedDcfValue(row) !== null)
    .map((row) => ({ ... }));
```

In `buildSimilarComparisonScatterSelected`, return `[]` when the selected row has no bridged value:

```ts
export function buildSimilarComparisonScatterSelected(row: CorporateComparisonRowApi | null) {
  return row && bridgedDcfValue(row) !== null
    ? [{ ... }]
    : [];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run from `apps/web`:
```
npx playwright test corporate-comparison-bridge --reporter=line
npx tsc --noEmit
```
Expected: 5 passed; `tsc` exit 0.

- [ ] **Step 5: Verify no consumer bypasses the helper**

Run from the repo root:
```bash
grep -rn "dcf_value" apps/web/app/corporate/
```
Every hit must be either a type declaration, a `bridgedDcfValue` call, a recharts `dataKey` string fed from one of the filtered builders, or the raw value inside a branch already guarded by `bridgedDcfValue`. List each hit and its verdict in your report. Any unguarded presentation path is a defect this task must fix.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/corporate/corporateDerivedViews.ts apps/web/tests/e2e/corporate-comparison-bridge.spec.ts
git commit -F <message-file>
```

Message:
```
fix: keep unbridged rows out of the DCF sort and the scatter

Suppressing the table cell alone was not enough: the same value still
ranked against per-share values and shared a scatter axis with
current_price.

Unbridged rows now sort last in both directions. Not via a sentinel --
Number(null) is 0, which would bury them among genuinely small per-share
values in one direction and place them at the far end in the other. The
null check precedes the numeric comparison and is not reversed by the
direction flag.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

### Task 4: The history metric-version boundary

**Files:**
- Modify: `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx`
- Modify: `apps/web/app/portfolio/page.tsx` (the `CorporateComparisonHistoryPoint` type, if declared there — the modal imports it from `../page` at `:10-13`)
- Test: an `apps/web/tests/e2e/` portfolio spec — extend an existing one if a snapshot-history spec exists, otherwise create `snapshot-history-metric-version.spec.ts`

**Interfaces:**
- Consumes: `metric_schema_version` from Task 1.
- Produces: no new exported names.

**Read first:** `apps/web/app/portfolio/components/SnapshotHistoryModal.tsx:51-115`. It builds a `TimelineList` grouped by date, so there is no flat list of adjacent rows to insert a divider between.

**The rule.** Compare each point's `metric_schema_version` against the **chronologically preceding point in the flat `history.points` array**, not against its neighbour within a date group. Two snapshots taken on the same day with different versions land in one group, and comparing within the group misses the boundary whenever it falls at a group edge.

**The notice wording, fixed by the spec so it does not drift:**

> Metric definition changed. Values before and after this point are not directly comparable.

- [ ] **Step 1: Write the failing test**

Find how the portfolio e2e specs mock the history endpoint and follow that pattern. The fixture needs at least three points across two versions, with the boundary NOT at a date-group edge so the flat-array rule is genuinely exercised.

```ts
test("the point where the metric definition changed says so", async ({ page }) => {
  // Snapshots before version 2 averaged enterprise values; from version 2 they average
  // intrinsic per-share values. The step between them is a definition change, not a
  // market move, and nothing said so.
  await mockPortfolioHistory(page, [
    { as_of_date: "2026-07-28", metric_schema_version: 1, average_dcf_value: 2431.0 },
    { as_of_date: "2026-08-03", metric_schema_version: 1, average_dcf_value: 2438.0 },
    { as_of_date: "2026-08-03", metric_schema_version: 2, average_dcf_value: 158.5 },
  ]);
  await openSnapshotHistory(page);

  // Exactly one boundary, on the third point -- not on the second, whose version matches
  // its predecessor despite sharing a date group with the third.
  await expect(page.getByText(/Metric definition changed/)).toHaveCount(1);
});

test("a history at one metric version shows no boundary", async ({ page }) => {
  await mockPortfolioHistory(page, [
    { as_of_date: "2026-08-01", metric_schema_version: 2, average_dcf_value: 150.0 },
    { as_of_date: "2026-08-03", metric_schema_version: 2, average_dcf_value: 158.5 },
  ]);
  await openSnapshotHistory(page);
  await expect(page.getByText(/Metric definition changed/)).toHaveCount(0);
});
```

Write `mockPortfolioHistory` and `openSnapshotHistory` concretely, filling every other required field of the history payload from the real response shape. Do not leave them as sketches.

- [ ] **Step 2: Run the test to verify it fails**

Run from `apps/web`: `npx playwright test snapshot-history-metric-version --reporter=line`
Expected: FAIL — the boundary text is not present.

- [ ] **Step 3: Write the implementation**

Add `metric_schema_version: number;` to the history point type wherever it is declared for the frontend.

In `SnapshotHistoryModal.tsx`, before the grouping at `:51`, compute the boundary set from the flat array:

```tsx
// The version boundary is computed against the flat points array, not against a point's
// neighbour inside its date group: two snapshots from the same day can straddle the
// boundary, and a within-group comparison would miss it at every group edge.
const versionBoundaryIds = useMemo(() => {
  const ids = new Set<string>();
  const points = history?.points ?? [];
  points.forEach((point, index) => {
    const previous = points[index - 1];
    if (previous && previous.metric_schema_version !== point.metric_schema_version) {
      ids.add(point.snapshot_version);
    }
  });
  return ids;
}, [history?.points]);
```

Then in the `meta` slot (`:72-81`), render the version chip beside the existing snapshot-version chip, and the notice when the point is in `versionBoundaryIds`. Match the existing chip's classes.

Note the ordering assumption: `history.points` arrives newest-first (`corporate_comparison.py` orders by `snapshot_date DESC`). "The chronologically preceding point" is therefore `points[index + 1]`, not `points[index - 1]` — **verify the actual order against the response before choosing**, and state which you found in your report. Marking the wrong side of the boundary puts the notice on the last old point instead of the first new one.

- [ ] **Step 4: Run the test to verify it passes**

Run from `apps/web`:
```
npx playwright test snapshot-history-metric-version --reporter=line
npx tsc --noEmit
```
Expected: 2 passed; `tsc` exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/portfolio/components/SnapshotHistoryModal.tsx apps/web/app/portfolio/page.tsx <the spec file>
git commit -F <message-file>
```

Message:
```
fix: mark where the snapshot history changes metric definition

average_dcf_value means enterprise value before metric schema version 2
and intrinsic value per share from version 2 on. The history modal drew
the step between them as if it were a valuation move.

Every point now carries its metric version, and the point where it changes
carries a notice. The boundary is computed against the flat points array
rather than within a date group, because two snapshots from the same day
can straddle it.

Older averages are still shown. Hiding them would discard history the user
deliberately saved and leave blanks with no explanation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

---

## Verification Checklist

Run before declaring the plan complete:

- [ ] `python -m pytest tests/core_finance/ tests/api/ -q` — 460 or higher, 0 failed
- [ ] `cd apps/web && npx tsc --noEmit` — exit 0
- [ ] `cd apps/web && npx playwright test --reporter=line` — full suite, 0 failed
- [ ] `grep -rn "bridge_quality" apps/web/app/` — every hit is a type declaration, the `bridgedDcfValue` body, or `CalculationDetailModal.tsx` displaying the quality as its own labelled datum. **No component branches on it to decide whether a DCF value may be shown.**
- [ ] An `estimated` row renders its DCF value exactly like an `ok` row — verified by a test, not by inspection
- [ ] A suppressed row sorts last under BOTH ascending and descending
- [ ] The history boundary notice lands on the first point of the new version, not the last of the old
