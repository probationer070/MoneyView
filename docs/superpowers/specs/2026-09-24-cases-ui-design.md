# Cases UI: fork, diff and simulate in the browser (design)

Date: 2026-09-24
Status: draft, pending review
Scope: the UI half of Track C2 (3c). A new **Cases** tab over the valuation-case
endpoints that already exist. `/pricing` is a separate sub-project and is not
designed here. It gets its own scoping round, because two earlier specs
(`2026-09-04-fork-and-diff-design.md`, `2026-09-05-simulate-design.md`) found
it overlaps the verdict panel's `trailing_pe` and `dcf_gap` rows.

---

## 1. Problem

`/fork`, `/diff` and `/simulate` shipped 2026-09-05/06 as HTTP-only endpoints.
No page in `apps/web` calls any `/valuation/cases` route. `/valuation` shows only
the verdict panel. The local database holds about 30 stored conservative cases,
and they can be valued, forked, explained and simulated only with curl.

## 2. The workflow this UI serves

Agreed with the user on 2026-09-24:

> Pick a stored case → see its valuation → **fork** it with a few changed
> assumptions, giving a reason for each narrated change → see **why the value
> moved** (the `/diff` Shapley breakdown against its parent) → optionally
> **simulate** it with ranges on a few inputs to see how uncertain the value is.

### Out of scope

| Item | Why |
| --- | --- |
| Creating a case from scratch (`POST /cases`) | A ~30-field form with narratives. Forking a conservative case covers the workflow above. |
| Deleting cases | No delete endpoint exists. |
| `/pricing` | Its own sub-project (see Scope). |
| Any backend change | Every call below already exists and is tested. |
| Storing simulation results | The API stores nothing. The seed makes a result reproducible instead. |

## 3. Pages and navigation

- **Sidebar:** a new entry, **Cases**, directly after **Valuation**
  (`apps/web/components/ui/Sidebar.tsx`).
- **`/cases`, the list.** Built from `GET /api/v1/valuation/cases`. Columns: name,
  ticker, as-of date, base → target year, parent (a link to the parent case).
  - A ticker filter, kept per tab with `useTabState` and preset from
    `?ticker=` in the URL.
  - An empty list says "No stored cases yet." It does not point to a generator: the
    Valuation tab has none. `POST /valuation/conservative/{ticker}` exists only as an
    API call, which the spec wrongly assumed had a UI.
  - Shows `RecordsSyncStatus`, like the other record pages, because reading the
    list triggers a records sync.
- **`/cases/[id]`, one case.** Five sections, described in §4–§8.
- **Link from `/valuation`.** When the chosen ticker has stored cases, the
  verdict page shows "Stored cases for {ticker} →" linking to
  `/cases?ticker={ticker}`.
- **Naming.** The simulate section is titled **"Uncertainty (simulate this
  case)"**, never "Monte Carlo". The existing Monte Carlo tab is an unrelated
  client-side EPS/PER simulator, and this must not look like a second copy of it.

The dynamic route must read `params` the async way Next.js 16 requires. Reading
it synchronously caused the "No data available for UNDEFINED" bug on `/detail`
(`ERROR-LOG.md` 2026-09-13).

## 4. Section 1: Valuation

`POST /cases/{id}/run`. It is a POST, but it only computes and stores nothing.

- **Headline figures:** value per share (diluted and basic), enterprise value,
  equity value, terminal-value share.
- **Year-by-year table:** revenue, EBIT, tax, reinvestment, FCFF, WACC.
- **Per-segment table:** name, revenue, margin, EBIT, reinvestment.
- **A 422 is a model refusal:** the case is valid data the engine will not value.
  Its message is shown verbatim as ordinary content, not in error colour. The
  same rule applies on the verdict panel (C1).

## 5. Section 2: Inputs (read-only)

From `GET /cases/{id}`:

- Case-level fields, then each segment's fields.
- Each narrated segment field shows its narrative: claim, `three_p`,
  confidence, evidence source.

This is what the fork and simulate forms change from.

## 6. Section 3: Why it moved (forks only)

Rendered only when `parent_case_id` is set. Data: `GET /cases/{id}/diff`.

- **Headline:** parent value → this case's value, and the total difference per
  share.
- **Bars:** one horizontal bar per changed input, in the order the API returns
  (canonical order).
  - Label: the input, with its from → to (rates in %).
  - Length: the contribution in $/share, coloured by sign.
- **Closing row:** the sum of the contributions next to the total difference.
  The API guarantees they are equal (Shapley conservation). The UI shows the sum
  and marks a mismatch beyond a rounding tolerance of 0.005 per share, rather
  than trusting the guarantee silently.
- **A refusal replaces the bars** with the API's message, shown as content.
  Codes: `too_many_changed_inputs` (cap 12), `no_effective_change`,
  `not_a_fork`, `unrunnable_coalition`.

## 7. Section 4: Fork (change-list builder)

### 7.1 Fields offered

These mirror `case_fork._SETTABLE_CASE_FIELDS` and `_SETTABLE_SEGMENT_FIELDS`:

- **16 case-level fields:** `base_year`, `target_year`, `riskfree_rate`,
  `wacc_initial`, `wacc_stable`, `wacc_converge_from`, `marginal_tax_rate`,
  `nol_balance`, `roic_stable`, `terminal_growth`, `effective_tax_rate`, `cash`,
  `debt`, `ipo_proceeds`, `shares_basic`, `shares_new`. None is narrated.
- **11 fields per segment**, chosen as "segment → field": all
  `_SEGMENT_COLUMNS` except `name`.
  - 10 are narrated (`valuation_case.NARRATED_FIELDS`).
  - `ramp_start_year` is not narrated.
- **Not offered:** `ticker`, `as_of_date`, `case_name`, `parent_case_id`. The API
  refuses them.

### 7.2 A change row

| Part | Rule |
| --- | --- |
| Field | picked from §7.1 |
| Current value | the parent's stored value, read-only |
| New value | required |
| Claim | narrated fields only; required |
| `three_p` | narrated fields only; required, no default (the API deliberately never defaults it) |
| Confidence | narrated fields only; optional (the API defaults to `assumed`) |
| Evidence source | narrated fields only; optional (the API defaults to `fork`) |

- **Unchanged rows:** a row whose new value equals the current value is marked
  "unchanged, will be ignored". The API discards these rows too.

### 7.3 Above the rows

- **Case name:** a required new case name.
- **Changed-input counter:** e.g. "3 of 12 changed inputs", counting rows whose
  value actually differs.
  - Past 12 it warns that `/diff` will not be able to explain this fork.
  - It does not block, because such a fork is still valid.

### 7.4 Request

```json
{
  "case_name": "...",
  "overrides": {
    "case": { "wacc_stable": 0.081 },
    "segments": {
      "<segment name>": {
        "base_margin": { "value": 0.21, "claim": "...", "three_p": "plausible" },
        "ramp_start_year": 2
      }
    }
  }
}
```

- Narrated fields are sent as objects; everything else as a bare number.
- On success (`{id}`) the page navigates to `/cases/{id}`, where "Why it moved"
  is populated.

### 7.5 Refusals

Every refusal message is shown verbatim, and a row is highlighted when the
message names its field:

- `narrative_required: base_margin …` highlights the `base_margin` row.
- `unknown_field` / `unknown_segment` highlight the named row.
- `duplicate_case_name` (409) highlights the name box.
- An engine refusal (422, no prefix, e.g. WACC not above terminal growth) is
  shown in the engine's own words.

## 8. Section 5: Uncertainty (simulate this case)

### 8.1 Builder

The change-list pattern again, with the same field list and field metadata. Each
row has:

- **Field and current value.**
- **Shape:**
  - triangular (low / most likely / high): the default, the usual form of a
    stated range;
  - normal (mean / sd);
  - uniform (low / high).

  The parameter boxes follow the chosen shape.
- **Claim and `three_p`** for narrated fields, required, as in the fork form.
  `case_simulate` applies the same rule and refuses `unexpected_narrative` on an
  unnarrated field.

Below the rows:

- **Runs:** default 2,000, limited to the API's `MIN_RUNS`–`MAX_RUNS`
  (1,000–20,000).
- **Seed:** optional.

Request: `{runs, seed?, distributions: {case: {...}, segments: {name: {...}}}}`.
Each leaf is `{shape, <params>, claim?, three_p?, confidence?}`.

### 8.2 Results

- **Accounting line, always first:** "1,934 of 2,000 draws valued · 66 refused
  (3.3%)". That line is `runs_valid`, `runs_requested`, `runs_refused` and
  `refused_fraction`.
- **Refusal table:** one row per group (code, count, the engine's message), in
  the API's order.
- **Seed:** the seed the API used, with **"Rerun with this seed"**.
- **At or above `REFUSED_FRACTION_CAP` (10%):** the API omits `p10`/`p50`/`p90`/
  `mean`/`histogram`/`association_among_accepted_samples`. The page then shows
  none of them, with no zeros and no empty chart. It shows one sentence instead:
  the surviving draws describe the value only where the engine accepted the
  inputs, which is not the distribution that was stated. The page checks whether
  the keys are present, not whether the fraction is below 0.10, so the API stays
  the single authority on suppression.
- **Below the cap:**
  - **Statistics:** p10 / p50 / p90 / mean per share. When any draw was refused,
    they are labelled "among accepted draws".
  - **Histogram:** the API's 32 bins, with the case's own point value (§4) drawn
    as a reference line when §4 computed one.
  - **Association:** one row per input with its Spearman coefficient as a signed
    number in [−1, 1], sorted by absolute value, titled "rank association among
    accepted draws". It is never shown as shares, percentages or anything that
    sums to 100%. That would present it as a breakdown of the value, which is
    what `/diff` does and this does not.

Chart styling follows the `dataviz` skill, loaded before any chart code is
written.

## 9. Units and field metadata

One module, `apps/web/app/cases/caseFields.ts`, holds for each settable field:

- a label;
- a unit: `rate`, `money`, `ratio`, `year`, `count`;
- whether it is narrated;
- whether it is an integer.

**Rates are shown and entered as percentages.** Both forms send fractions.

| Where | Rule |
| --- | --- |
| Rate fields | stored as fractions (`wacc_stable` = 0.074); shown as 7.4 |
| Conversion | exactly two functions, `toWire` and `fromWire`, used by display, fork and simulate alike |
| Distribution parameters | converted the same way (a normal's `sd` on a rate is also in percentage points) |
| Integer fields (`base_year`, `target_year`, `wacc_converge_from`, `ramp_start_year`) | whole numbers only (`case_fork._INTEGER_FIELDS`) |

Which fields are rates:

- **Rates:** `riskfree_rate`, `wacc_initial`, `wacc_stable`,
  `marginal_tax_rate`, `roic_stable`, `terminal_growth`, `effective_tax_rate`,
  `base_margin`, `market_share_target`, `margin_target`, `initial_growth`.
- **Not rates:** `waypoint_gap_fraction` is a fraction of a gap, not a rate, so
  it stays a plain ratio. The two `sales_to_capital_*` fields are ratios.

This metadata copies knowledge that lives in the backend, so it can drift:

- **A field the backend adds** is not offered until the metadata adds it.
- **A field the backend removes** is refused with `unknown_field`, and that
  refusal is shown (§7.5).

Neither failure silently sends a wrong number.

## 10. Page states

Every section follows the same rules:

- **Loading:** renders no partial content.
- **Network or server failure:** one error line.
- **Model refusal (422):** the API's message, as ordinary content.

## 11. Files

New, under `apps/web/app/cases/`:

- `page.tsx`: the list;
- `[id]/page.tsx`: the detail page;
- `caseTypes.ts`: wire types;
- `caseFields.ts`: §9;
- `components/`: one component per section, plus the shared change-list row.

Changed:

- `apps/web/components/ui/Sidebar.tsx`;
- `apps/web/app/valuation/page.tsx`: the link.

Tests:

- `apps/web/tests/e2e/cases.spec.ts`;
- `apps/web/tests/e2e/helpers/casesApiMock.ts`.

Docs:

- `docs/tabs/cases-tab.txt`;
- `docs/tabs/index.txt`;
- `docs/INDEX.md`;
- the C2 entry in `guideline/sop/todo.md`.

## 12. Testing

### 12.1 Rules and their mutations

Playwright with mocked API responses, following the existing
`helpers/*Mock.ts` pattern. Each rule is a test, and each test is
mutation-checked before it counts as verified (CLAUDE.md §8): break the rule on
purpose and confirm the test fails for the intended reason.

| Rule | Mutation the test must catch |
| --- | --- |
| A rate entered in % is sent as a fraction (fork and simulate) | `toWire` drops the `/100` |
| A narrated change is sent as `{value, claim, three_p}` | sent as a bare number |
| An unnarrated change is sent as a bare number | sent as an object |
| A fork refusal is shown verbatim and highlights the named row | a generic "fork failed" |
| The counter counts only changed rows | an unchanged row counted |
| A suppressed simulation shows no statistics | zeros or an empty histogram rendered |
| Association is never shown as shares | values normalised to sum to 100% |
| A run or diff refusal renders as content | rendered as an error, or as 0 |
| The detail page loads the case named by the URL | `params` read synchronously |
| `/valuation` links to that ticker's cases | the link drops the ticker |

### 12.2 Real-API test

One test uses the real API, which the harness starts with its own isolated
database:

1. Create a small one-segment case with `POST /cases`.
2. Fork it through the UI.
3. Assert that "Why it moved" shows contributions whose sum equals the
   difference.

The mocks could drift from the real API, and this test would catch that.

### 12.3 Other gates

- `npm run typecheck`.
- eslint on the changed files.
- The full Playwright suite, run once at the end. Per-spec runs have missed
  cross-spec collisions before (todo I-D, Ruling O).
