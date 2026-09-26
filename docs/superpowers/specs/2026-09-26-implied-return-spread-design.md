# Implied return spread: replacing the annual-vs-horizonless `expected_return_spread`

Date: 2026-09-26. Status: approved direction; spec revised after review (rev 2).
Todo: Track E follow-up, "the pre-existing annual-vs-horizonless conflation in
`expected_return_spread`".

## 1. Problem

`/corporate`'s comparison table and chart, and the Portfolio page's "Expected vs Market",
show `expected_return_spread = dcf_implied_return − market_expected_return`
(`packages/core_finance/expected_return.py:65`).

- `dcf_implied_return` is `intrinsic_value / price − 1`. It is a one-off gap with **no
  time dimension**: how far price sits from value, not how fast it closes.
- `market_expected_return` is `rf + ERP`: a rate **per year**.

Subtracting a per-year rate from a one-off gap is a unit error. A stock 9.7% below its
DCF value shows a spread of exactly 0, which reads as "in line with the market". A
stock 50% below value shows +40, as if it earned 40 points a year above the market.
`docs/metrics/discount-rates-and-returns.md` measured the column from −225 to over
6,550,000. The number has no meaning, so no reading of it is right.

This meets CLAUDE.md §7's bar (wrong output, no error raised), so it gets an
`ERROR-LOG.md` entry.

## 2. What replaces it

**The market-implied return:** the annual discount rate at which the comparison's own DCF
of the business equals what the market pays for it today. It is compared with the
company's WACC.

- `market_implied_return` (percent per year): the IRR `r` solving `PV(r) = market_ev`.
- `implied_return_spread` (percentage points per year): `market_implied_return − wacc`.
  Positive means the market price leaves the business earning more than its cost of
  capital, i.e. it is priced below the DCF value. Negative means the reverse.

Both sides are annual rates on the same capital (the whole firm, FCFF), so the
subtraction is unit-consistent. It needs no assumed convergence horizon.

**Why WACC, not `market_expected_return`.** The cash flows are FCFF, so they belong to
debt and equity holders together. Their required return is WACC. `rf + ERP` is the
required return on an all-equity market portfolio. Comparing a firm-level IRR with it
would mix leverage levels, which is a smaller version of the same class of error.
`market_expected_return` stays on the wire and on screen as context, unchanged.

### 2.1 The cash flows are held fixed

`PV(r)` uses exactly the cash flows `_dcf_snapshot` already builds
(`apps/api/services/corporate_comparison.py`):

```text
FCFF_t = base_fcff * (1 + growth)^t,        t = 1..5
TV     = FCFF_5 * (1 + g) / max(r - g, 0.005)
PV(r)  = sum_t FCFF_t / (1 + r)^t  +  TV / (1 + r)^5
```

`g` is the terminal growth already derived at WACC by `derive_terminal_growth`. It is
**not** re-derived at each trial `r`. Only the discount rate varies, which is what an
IRR is. At `r = WACC`, `PV(r)` is the enterprise value the table already shows.

### 2.2 The market's enterprise value

This inverts the same equity bridge the DCF uses (`equity = EV − net_debt +
non_operating_assets`, `per_share = equity / diluted_shares`):

```text
market_ev = current_price * diluted_shares + net_debt - non_operating_assets
```

The inputs are exactly what `load_equity_bridge` (`apps/api/services/equity_bridge.py`)
already returns for the DCF side:

| Input | Definition | Required? |
|---|---|---|
| `current_price` | `price_loader(ticker)`, the last cached close | yes; `<= 0` or no price data refuses `no_price` |
| `diluted_shares` | the latest diluted average share count; basic `sharesOutstanding` is only a fallback, with the bridge's quality marked accordingly | yes; missing or `<= 0` refuses `bridge_unresolved` |
| `net_debt` | total debt minus cash, **both from the same balance-sheet date**; else the reported Net Debt line (fallback quality) | yes; missing refuses `bridge_unresolved` |
| `non_operating_assets` | the latest investments-and-advances line | no; missing counts as `0.0` and the bridge records it as `estimated`, exactly as the DCF side already does |

**The bridge "does not resolve"** means precisely: `net_debt` is `None`, or
`diluted_shares` is `None` or `<= 0`. That is the condition under which `_dcf_snapshot`
already falls back to an enterprise value instead of a per-share value.

Preferred stock and minority interests are **not** in `net_debt`. This is a known limit,
and it is applied identically on both sides: the DCF value is bridged with the same
`net_debt`. So it cannot bias the comparison between the two; it only means both
enterprise values omit those claims.

Units match the DCF by construction, because it is the same bridge run backwards.

### 2.3 Solving

The target, exactly:

```text
find r in [r_min, r_max] such that PV(r) = market_ev
  r_min = g + 0.005      (g: the terminal growth derived at WACC, held fixed)
  r_max = 10.0           (1000% per year)
  PV(r) as in 2.1, with every FCFF_t and the terminal cash flow held fixed
```

- **Search range:** `r` in `[r_min, r_max]`.
  - At or above `g + 0.005`, the `0.005` floor on the terminal denominator is inactive,
    so `PV` is the true Gordon form, strictly decreasing in `r` for positive cash flows.
  - `SAFETY_MARGIN = 0.005` guarantees `WACC ≥ g + 0.005`, so WACC is always inside the
    range.
- **Uniqueness.** `PV` is strictly decreasing on the range whenever every cash flow is
  positive, and then at most one root exists. Every cash flow is positive exactly when
  `base_fcff > 0` and `1 + growth > 0`, because the terminal cash flow's
  `1 + g > 0` always holds (`g >= -0.10`). With `growth <= -100%`, `(1 + growth)^t`
  alternates sign, `PV` stops being monotone and several roots can exist. That case is
  refused as `non_positive_fcff` **before** any solving (§2.4). Multiple roots are
  therefore excluded by precondition, not detected afterwards.
- **No sign change.** The bracket is checked before bisecting:
  - `market_ev > PV(r_min)` gives `below_model_range`;
  - `market_ev < PV(r_max)` gives `above_model_range`.

  These are the only two ways the root can lie outside the range. Each is refused with
  its own code, because the direction is informative: "priced for growth this model
  cannot reach" versus "priced as if nearly worthless".
- **Method:** bisection for a fixed 64 iterations (bracket width `10 / 2^64`, far below
  float resolution), returning the midpoint. The iteration count is fixed, so there is
  no convergence failure mode to handle. The result is deterministic. Tests assert
  `|PV(r) − market_ev| / market_ev < 1e-9`.
- **Consistency invariant.** It follows from monotonicity and `WACC >= r_min`, and is
  **tested, not assumed**. For every row that is not refused (§2.4):
  - `market_implied_return > WACC` ⟺ `PV(WACC) > market_ev`;
  - `market_implied_return < WACC` ⟺ `PV(WACC) < market_ev`;
  - equality at equality.

  Since `PV(WACC)` is the table's enterprise value and both sides use one bridge, the
  per-share form follows: the spread is positive exactly when `dcf_value >
  current_price`. The test checks both forms over a grid of price, FCFF, growth and
  WACC. A property-style sweep catches any future change that breaks monotonicity
  (e.g. re-deriving `g` per trial rate).

### 2.4 Refusals: no number, a stated reason

Both return fields are `None`, and `implied_return_refusal` carries exactly one of these
six codes. They are checked in this order, and the first that applies wins:

| # | Code | Condition |
|---|---|---|
| 1 | `no_price` | no price data, or `current_price <= 0` |
| 2 | `bridge_unresolved` | `net_debt is None`, or `diluted_shares is None` or `<= 0` (§2.2) |
| 3 | `non_positive_fcff` | `metrics.fcff <= 0`, or `1 + growth <= 0` (some projected FCFF `<= 0`) |
| 4 | `non_positive_market_ev` | `market_ev <= 0` (net cash above market cap) |
| 5 | `below_model_range` | `market_ev > PV(r_min)` |
| 6 | `above_model_range` | `market_ev < PV(r_max)` |

- **Non-finite values.**
  - A NaN or ±inf fails "positive" at every check above, because `nan <= 0` is False and
    so must be tested explicitly:
    - FCFF → `non_positive_fcff`;
    - `market_ev` (including via a NaN `non_operating_assets`) →
      `non_positive_market_ev`;
    - price → `no_price`;
    - `net_debt` or shares → `bridge_unresolved`.
  - A non-finite `terminal_growth`, or one that empties the bracket (`g + 0.005 >= 10`), is
    a caller bug rather than a market outcome, so the solver raises `ValueError`. The
    comparison DCF bounds `g` to `[-0.10, WACC − 0.005]`, so it never happens in practice.
  - (rev 3, from the plan review.)
- **Codes, not prose.** The codes are stable, machine-readable, lowercase `snake_case`,
  matching the existing `EngineRefusal` codes (#56). They are a closed set
  (`IMPLIED_RETURN_REFUSAL_CODES`) in `core_finance`, never matched by text.
- **The human-readable explanation lives in the UI:** a code → sentence map with the
  code itself as the fallback. This is the same pattern as H11's binding-constraint
  labels, so a code added later still reaches the reader.

**The FCFF placeholder is never used here.** `_dcf_snapshot` floors FCFF at `1.0` so the
*display* DCF value exists. That existing behaviour is untouched and out of scope (§5).
The implied return reads the **unfloored** `metrics.fcff` and refuses when it is
`<= 0`. An IRR on the placeholder would be a mathematically valid, economically
meaningless number, which is exactly the class of output this change removes.

## 3. Contract changes

### 3.1 Engine (`packages/core_finance/expected_return.py`)

- New: `calculate_market_implied_return(fcff_path, terminal_growth, market_ev) ->
  ImpliedReturn` (`rate` or `refusal`), pure.
- `calculate_expected_return_spread` and `ExpectedReturnResult.expected_return_spread`
  are removed.
- The other four returns (`dcf_implied_return`, `capm_expected_return`,
  `stock_expected_return`, `market_expected_return`) are unchanged.

### 3.2 API row, summary, history (`schema_parts/corporate.py`)

| Model | Removed | Added |
|---|---|---|
| `CorporateComparisonRow` | `expected_return_spread: float` | `market_implied_return: float \| None`, `implied_return_spread: float \| None`, `implied_return_refusal: str \| None` |
| `CorporateComparisonHistoryPoint` | `average_expected_return_spread` | `average_implied_return_spread: float \| None` (over rows with a value; `None` over zero rows, as now) |
| `CorporateComparisonStockHistoryPoint` | `expected_return_spread: float = 0.0` | `implied_return_spread: float \| None` |

The old field is removed rather than renamed in place. A reader holding the old name
then fails loudly instead of silently reading a new meaning. The removal also covers the
Portfolio trend delta (`StockDetailModal`), which subtracts the earliest point from the
latest regardless of version. Old points now carry `None`, so no delta is taken across
the change.

### 3.3 Snapshots (`corporate_comparison_snapshots_v3`)

- **New nullable columns:** `market_implied_return REAL`, `implied_return_spread REAL`,
  `implied_return_refusal TEXT`. They are added by the existing column-migration path in
  `db.py`. Old rows read `NULL`.
- **`METRIC_SCHEMA_VERSION` 2 → 3.** The Snapshot History modal already marks a version
  boundary as "Metric definition changed".
- **The legacy `expected_return_spread` column is retired.** v3 rows write its default
  `0.0` and no code reads it. It is not dropped, because SQLite column drops rebuild the
  table and history must survive. A code comment and the metric doc say so.
- **Old rows are not recomputed.** Their price and bridge inputs are stored, but their
  FCFF path is not. A recomputation would mix today's statements with a past price.

### 3.4 Migration surface

The database legacy column is **not** the application field. After this change, only
the database still holds the name `expected_return_spread`.

| Surface | Before | After |
|---|---|---|
| DB `corporate_comparison_snapshots_v3` | `expected_return_spread REAL NOT NULL DEFAULT 0.0` | Column kept (history survives). v3 rows write `0.0`; **no query reads it**. New nullable columns: `market_implied_return`, `implied_return_spread`, `implied_return_refusal`. |
| DB legacy tables (`corporate_comparison_snapshots`, the pre-v3 migration copies in `db.py`) | hold the column | untouched; they are migration sources only |
| Snapshot writers (`corporate_comparison.py`: the three `INSERT` column lists near lines 201, 519 and 755) | write the old value | write the three new columns; the old column takes its default |
| Snapshot readers (row reload ~612, averages ~691/725, stock history ~824/844) | read the old column | read the new columns; `AVG` over non-NULL `implied_return_spread` |
| API models | `CorporateComparisonRow.expected_return_spread`, `…HistoryPoint.average_expected_return_spread`, `…StockHistoryPoint.expected_return_spread` | removed; the §3.2 fields added |
| Old snapshots on the API | served the old spread | serve `implied_return_spread: null`, and the refusal is `null` too. **Not recorded** is not a refusal, so the UI says "not recorded before metric v3". |
| Shared types | `packages/shared-types/portfolio.ts` and `generated/*` (from `scripts/export_schema.py`) | regenerated; `apps/web/tests/types/shared-types-contract.ts` updated |
| Frontend | `CorporateComparisonTable`, `TargetStockComparisonSection`, `corporateDerivedViews`, `corporateTypes`, `corporate/page.tsx` (default sort key), `portfolio/page.tsx`, `portfolioMetrics`, `StockDetailModal`, `SnapshotHistoryModal` | read the new fields (§4) |
| Exports and reports | none read the spread (checked: `report_renderer.py`, `corporateUtils.ts` CSV) | no change |
| `core_finance` public API | `calculate_expected_return_spread` exported from `__init__` | removed; `calculate_market_implied_return` exported |
| Tests expected to change | `tests/core_finance/test_expected_return.py`, `tests/api/test_corporate_comparison.py`, e2e fixtures (`fixtures/shared.ts`, `corporatePageMock.ts`, `portfolioPageMock.ts`), `corporate-comparison-bridge.spec.ts`, `refresh-idle-state.spec.ts`, `snapshot-history-metric-version.spec.ts` | assertions on the old field are rewritten to the new one; none is deleted without a replacement that asserts the new meaning |

A final grep for `expected_return_spread` outside `db.py`'s column definitions,
migration code, this spec and the historical docs must return nothing. That grep is
part of the plan's last task.

## 4. UI

- **`/corporate` table:** the "Spread" column becomes "Implied return" (the IRR) and
  "vs WACC" (the spread, coloured by sign). A refused row shows `—`, with the reason in
  the cell's `title` and in the row's detail.
- **`/corporate` chart and sort:** the `expected_return_spread` series and sort key become
  `implied_return_spread`.
  - Refused rows are left out of the bar series, not drawn as 0.
  - A saved sort key of the old name (tab state) falls back to the default.
- **Portfolio:** "Expected vs Market" becomes "Implied return vs WACC". It reads
  `implied_return_spread`, and `None` is shown as missing with the refusal reason.
  Outlier and ranking logic keep their shape.
- **Snapshot History modal:** shows `average_implied_return_spread`. Old points show
  "not recorded before v3".
- **Three quantities, three distinct labels.** No label word is shared between them:

  | Field | Label | Meaning |
  |---|---|---|
  | `market_implied_return` | "Market-implied return (per year)" | the annual rate today's market EV implies |
  | `implied_return_spread` | "Implied return vs WACC (pts per year)" | that rate minus WACC |
  | `dcf_implied_return` | "DCF value vs price (one-off gap)" | `value / price − 1`, with no time dimension |

  The old "Spread", "Expected vs Market" and "DCF upside" labels are retired.

## 5. Out of scope

- The naming of `stock_expected_return` (still a copy of `dcf_implied_return`) and its
  `stock_expected_return_method`. That is a separate honesty issue with no unit error;
  noted in the metric doc.
- Charts over snapshot history and readable snapshot identity (the other Track E items).
- Changing the comparison DCF itself: its 5-year horizon, the FCFF floor for display,
  or the terminal growth derivation.

## 6. Testing

- **Engine (pure):**
  - a known cash-flow path whose IRR is computed by hand;
  - `PV(market_implied_return) == market_ev` to 1e-6;
  - the consistency invariant (§2.3) over a grid of price/value pairs;
  - each refusal code at its boundary, and the precedence order when two apply;
  - `growth <= -100%` refused before solving (the non-monotone case);
  - the terminal floor never active inside the search range.
- **Service:**
  - `_dcf_snapshot` fills the three new fields from real loaders' shapes;
  - at `price = intrinsic value per share` the spread is 0;
  - `bridge_unresolved` / `non_positive_fcff` rows have `None` plus a code;
  - v3 snapshot rows persist and reload the new columns;
  - averages skip refused rows.
- **E2E:**
  - the table shows the IRR and the spread, with `—` plus the reason for a refused row;
  - the chart omits refused rows;
  - the portfolio metric label;
  - the history modal before and after v3.
- **Mutation matrix (CLAUDE.md §8):**
  - subtracting `market_expected_return` instead of WACC;
  - re-deriving `g` per trial rate;
  - dropping the `+ net_debt` or `− non_operating_assets` term;
  - an inverted bisection branch;
  - a refusal returning 0.0 instead of `None`;
  - refused rows included in the average;
  - the chart drawing refused rows as 0.

## 7. Records

- `ERROR-LOG.md` entry (unit error, wrong output, no error raised).
- `docs/metrics/discount-rates-and-returns.md`:
  - replace the `expected_return_spread` entry with `market_implied_return` /
    `implied_return_spread`;
  - add the retired-column note.
- `docs/metrics/inventory.md` row updated.
- `guideline/sop/todo.md`: close the conflation item.
