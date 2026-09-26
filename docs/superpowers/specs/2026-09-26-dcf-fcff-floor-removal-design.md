# Removing the DCF's $1B FCFF floor (metric v4)

Date: 2026-09-26. Status: direction approved (with review additions); spec for review.
Follows: `2026-09-26-implied-return-spread-design.md` (metric v3, PR #59).
Defect: `ERROR-LOG.md` 2026-09-26, "the comparison DCF floors FCFF at $1B"; `guideline/sop/todo.md`.

## 1. Problem

Two DCF valuation paths value the business on `max(fcff, 1.0)`. `fcff` is a three-year
average of free cash flow in **billions** (`corporate_statement_metrics.py`,
`fcff_billions`).

| Path | Site | Serves |
|---|---|---|
| Comparison DCF | `corporate_comparison.py` `_dcf_snapshot` | `/corporate` comparison table, snapshots, history, Portfolio, the decision log's recorded figures |
| Single-ticker DCF | `corporate_dcf.py` `build_dcf_summary` / `build_dcf_full_report` | `/corporate` DCF panel, the DCF workbench, "Calculate All Reports" |

The floor distorts two groups of companies:

- **FCFF in (0, 1).** The company is valued as if it earned $1B. At $0.5B its value is
  overstated 2x.
- **FCFF ≤ 0.** A company burning cash is valued as if it earned **+$1B**, and the table
  shows it as worth a lot.

Since metric v3, the implied return uses the real FCFF. So in these bands "DCF value vs
price" and "Implied return vs WACC" can disagree in sign within one row.

## 2. The rule after this change

> A DCF value exists only when **every explicit forecast FCFF is positive**. When it
> exists, it is computed on the actual FCFF, with no minimum and no placeholder.

- **One definition of admissibility, shared with the implied return.** The forecast path
  is `FCFF_t = fcff * (1 + growth)^t, t = 1..5`. It is admissible iff every `FCFF_t > 0`
  and every value is finite. This is the same test
  `calculate_market_implied_return` applies (`non_positive_fcff`). Checking only the base
  FCFF is not enough: a positive base with `growth <= -100%` has non-positive forecast
  years.
- **An inadmissible path is refused, not valued.** The DCF produces no value and records
  a refusal code, `non_positive_fcff`. Computing a negative enterprise value instead would
  be arithmetically true, but it reads as a valuation when it is not one.
- **The grep invariant.** After this change no valuation path contains an FCFF floor
  (`max(... fcff ..., 1.0)`). The plan's last task checks this by grep.
  `corporate_metrics_service._valuation_params_from_metrics` clamps the default assumption
  at `max(fcff, 0.0)`. That clamp becomes redundant (0 is refused anyway), so it is
  removed too, so no clamp hides the real sign.

## 3. Comparison path (`_dcf_snapshot`) and the stored snapshot

### 3.1 Values

- **Admissible path:**
  - `enterprise_value = enterprise_present_value(real_path, g, wacc)`;
  - the bridge, `estimated_value` and `dcf_implied_return` are as today, on the real
    value;
  - `dcf_refusal = None`.
- **Inadmissible path:**
  - `estimated_value = None` and `dcf_implied_return = None`;
  - `dcf_refusal = "non_positive_fcff"`;
  - the implied return refuses with the same code on its own (it uses the same path).

### 3.2 Contract changes

| Model | Field | Before | After |
|---|---|---|---|
| `CorporateComparisonRow` | `dcf_value` | `float` | `float \| None` (required) |
| `CorporateComparisonRow` | `dcf_implied_return` | `float = 0.0` | `float \| None` (required) |
| `CorporateComparisonRow` | `dcf_refusal` | — | `str \| None` (required) |
| `CorporateComparisonStockHistoryPoint` | `dcf_implied_return` | `float = 0.0` | `float \| None` |
| `CorporateComparisonStockHistoryPoint` | `dcf_refusal` | — | `str \| None` |

- `dcf_refusal` and `implied_return_refusal` stay **separate fields**. They may carry the
  same code, but they report two different calculations each declining to produce a
  value.
- `stock_expected_return` is a literal copy of `dcf_implied_return`. It follows it and
  becomes `float | None`.
- `capm_expected_return` and `market_expected_return` do not depend on FCFF and are
  unchanged.

### 3.3 Persistence: why this is not a plain `NULL`

The v3 table declares `dcf_value REAL NOT NULL DEFAULT 0.0`, and likewise for
`dcf_implied_return` and `stock_expected_return`. SQLite cannot drop a `NOT NULL`
constraint without rebuilding the table, and a rebuild of the one table that holds a
year of history is the riskier change. So:

- **New nullable column:** `dcf_refusal TEXT`, added by the existing column-migration
  path. Earlier rows read `NULL`.
- **Refused rows write the columns' defaults and the reader maps them.**
  - A refused row writes `0.0` into `dcf_value`, `dcf_implied_return` and
    `stock_expected_return`.
  - The reader maps **`dcf_refusal IS NOT NULL` → those fields `None`**.
  - The `0.0` is never served. A test pins both halves.
- **History averages exclude refused rows explicitly.** `average_dcf_value` already
  filters `bridge_quality != 'missing'`, and it gains `AND s.dcf_refusal IS NULL`. This
  is the one place the structural-`NULL` approach the review preferred is not available,
  for the reason above. An all-refused snapshot still averages to `NULL`, never 0.

### 3.4 Metric version and history wording

- `METRIC_SCHEMA_VERSION` goes from 3 to 4. `dcf_value` changes definition for companies
  with FCFF below $1B, and for those with FCFF ≤ 0 it stops existing.
- The Snapshot History modal currently says only "Metric definition changed" at a
  boundary. It states **which** definition changed, per crossing:

  | Crossing | Notice |
  |---|---|
  | into v3 | "Implied return vs WACC starts here; earlier snapshots did not record it." |
  | into v4 | "DCF values before this point used a $1B minimum FCFF, which overstated companies with FCFF under $1B and valued cash-burning companies at +$1B. Values across this point are not comparable for those companies." |
  | out of v0 | the existing "definition not recorded" wording, unchanged |
  | into v2 | the existing enterprise-value → per-share wording, kept |

## 4. Single-ticker path (`corporate_dcf.py`)

- **The same admissibility test runs before valuing.** An inadmissible path raises
  `EngineRefusal("non_positive_fcff", <message>)`, the typed refusal from #56. `params.fcff`
  can be user-supplied through the DCF workbench, so this covers typed input too.
  `non_positive_fcff` is added to `ENGINE_REFUSAL_CODES`. The structural test requires
  every code to be raised with a literal, and every raise to use a known code.
- **Routes.** The three routes map `EngineRefusal` to HTTP 422, with body
  `{"code": ..., "message": ...}`, so a refusal is content rather than a 500:
  - `POST /dcf/{ticker}`;
  - `POST /dcf/{ticker}/report`;
  - `POST /dcf/{ticker}/stream`, which emits a refusal event before closing, in the form
    its existing error events use.
- **Bulk "Calculate All Reports" already skips** any per-ticker exception with its reason
  (`build_bulk_dcf_reports`). A refused ticker now appears in `skipped` as
  `non_positive_fcff: <message>`, instead of being valued at +$1B. No change is needed
  beyond a test.
- **Frontend.** The DCF panel, the DCF workbench and the full-report view show the
  refusal as **content**, with `—` for the value and the message. They must not show the
  generic error state, and must not show a number. The wording comes from one shared map
  (`apps/web/lib/impliedReturn.ts`'s refusal text, generalised to a valuation-refusal map
  that both callers use), so the two refusals cannot drift apart.

## 5. Decision log

`investment_decision._default_figures_loader` copies `float(dcf["estimated_value"])`.
When `dcf_refusal` is set, `record_decision` records `figures_unavailable_reason` ("FCFF
is zero or negative over the forecast, so the model cannot value {ticker}"), and no
figures. This is the same mechanism the missing-bridge and fabricated-metrics guards use.
A decision is never recorded with a floored or fabricated value.

## 6. UI (comparison and Portfolio)

- **Comparison table.**
  - A refused row's "DCF Value" and "DCF value vs price (one-off gap)" cells show `—`,
    with the refusal text as the title.
  - The sort by `dcf_value` already puts rows without a per-share value last; refused rows
    join them.
  - The price-vs-value scatter already filters rows with no bridged value; refused rows
    are filtered the same way.
- **Portfolio.**
  - `dcfUpside` reads `null` with the refusal reason, through the existing
    `buildNumericMetric` missing path.
  - The summary's "Positive DCF" count uses the same only-rows-with-a-value rule as
    finding #4 of PR #59.

## 7. Tests (the review's four cases, plus the chain)

1. **Small positive FCFF.** At `fcff = 0.5`, the enterprise value equals
   `enterprise_present_value` of the real 0.5 path (hand-computed), not the 1.0 path. This
   replaces
   `test_a_sub_unit_fcff_is_solved_on_the_real_cash_flow_not_the_display_floor`, whose
   premise (the two paths intentionally differ) no longer holds.
2. **Zero or negative FCFF, for `fcff` ∈ {0, −0.5}:**
   - `dcf_value is None`;
   - `dcf_refusal == "non_positive_fcff"`;
   - `implied_return_spread is None`;
   - `implied_return_refusal == "non_positive_fcff"`.
3. **Forecast-path refusal.** A positive base with `growth = −150%` makes **both**
   calculations refuse.
4. **Sign invariant, restricted to rows where both calculations produce values.**
   - The test sweeps a parametrised grid over FCFF ∈ {0.2, 0.5, 1, 5, 50}, prices on both
     sides of value, and resolved bridges.
   - The condition is: whenever `dcf_value` and `implied_return_spread` are both non-null,
     `sign(dcf_value − price) == sign(implied_return_spread)`.
   - Rows where the implied return refuses for range reasons are excluded, because the
     DCF can be valid there.
5. **Persistence.**
   - A refused v4 row reloads with `None` values and its code.
   - The written `0.0` is never served.
   - `average_dcf_value` excludes refused rows.
   - Stock history carries `dcf_refusal`.
   - `init_db` adds the column to an existing table.
6. **Single-ticker.**
   - Each of the three routes returns 422 with `code == "non_positive_fcff"` for
     `fcff ≤ 0`, and for a negative forecast path.
   - The bulk batch lists the ticker in `skipped`.
   - The structural refusal-code test passes with the new code.
7. **Decision log.** Recording a decision on a refused ticker stores
   `figures_unavailable_reason`, and no figures.
8. **E2E:**
   - the comparison row's DCF cells show `—` plus the reason;
   - the single-ticker DCF panel shows the refusal as content;
   - the history modal shows the v4 notice.
9. **Mutation matrix (CLAUDE.md §8):**
   - the floor reintroduced;
   - the base-only admissibility check;
   - the reader not mapping the `0.0`;
   - the average not excluding refused rows;
   - the route returning 500 instead of 422;
   - the decision log copying a refused value;
   - the history notice falling back to the generic wording.

## 8. Out of scope

- The other Track E items: readable snapshot identity, and charts over snapshot history.
- The deferred minors from PR #59, unless a task above touches the same line.
- Changing the DCF model itself: the 5-year horizon and the terminal growth derivation.

## 9. Records

- `ERROR-LOG.md`: amend the 2026-09-26 FCFF-floor entry's `Fix:` line from "Not fixed" to
  this fix, as the file's own rule requires.
- `docs/metrics/discount-rates-and-returns.md`:
  - the `dcf_implied_return` entry gains the refusal;
  - the implied-return entry drops its "exception" paragraph (the columns now agree).
- The spec for metric v3 gets a one-line pointer to this one.
- `guideline/sop/todo.md`: close the floor item.
