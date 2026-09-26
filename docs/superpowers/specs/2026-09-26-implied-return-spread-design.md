# Implied return spread: replacing the annual-vs-horizonless `expected_return_spread`

Date: 2026-09-26. Status: approved direction; spec for review.
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

Units match the DCF by construction, because it is the same bridge run backwards.

### 2.3 Solving

- **Search range:** `r` in `[g + 0.005, 10.0]`.
  - At or above `g + 0.005`, the `0.005` floor on the terminal denominator is inactive,
    so `PV` is the true Gordon form, strictly decreasing in `r` for positive cash flows.
  - `SAFETY_MARGIN = 0.005` guarantees `WACC ≥ g + 0.005`, so WACC is always inside the
    range.
- **Method:** bisection to `|Δr| < 1e-7`. It is monotone, so there is no bracketing
  ambiguity, and it is deterministic.
- **Consistency invariant.** For every row that is not refused (§2.4), it follows from
  monotonicity and the previous bullet, and is tested:
  - `implied_return_spread > 0` exactly when `dcf_value > current_price` (bridge
    resolved).
  - `implied_return_spread < 0` exactly when `dcf_value < current_price`.
  - The spread is 0 when they are equal.

### 2.4 Refusals: no number, a stated reason

The field is `None` and `implied_return_refusal` carries a code in each of these cases:

| Code | When |
|---|---|
| `bridge_unresolved` | `net_debt` or `diluted_shares` is missing, so there is no `market_ev` (today's `bridge_quality = 'missing'`) |
| `no_price` | `current_price <= 0` or no price data |
| `non_positive_fcff` | `metrics.fcff <= 0`. The DCF floors FCFF at `1.0` to keep a value on screen. An IRR on that placeholder cash flow would be invented. |
| `non_positive_market_ev` | `market_ev <= 0` (net cash above market cap) |
| `below_model_range` | `market_ev > PV(g + 0.005)`: the market pays more than any return the model can price down to `g + 0.5%` |
| `above_model_range` | `market_ev < PV(10.0)`: implied return above 1000%/yr |

The codes are an `EngineRefusal`-style closed set in `core_finance`, with no text
matching (the same discipline as #56).

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
- All wording says **"per year"** for the implied return and the spread, and **"one-off
  gap"** for `dcf_implied_return` (DCF upside), so the two can't be read as the same
  kind of number again.

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
  - each refusal code at its boundary;
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
