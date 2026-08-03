# DCF Data Completeness — Design

Date: 2026-08-03
Track: Financial Logic Remediation, Phase 2 (`guideline/sop/todo.md`)
Covers Phase 2 items 1, 2 and 3. Item 4 (the WACC × terminal-growth sensitivity table)
is deliberately excluded — see [Not in scope](#not-in-scope).

## Problem

Phase 1 built the enterprise-to-equity bridge and it is correct. It is also starved.

`net_debt`, `non_operating_assets` and `diluted_shares_outstanding` exist only as request
parameters on `ValuationAssumptions` (`apps/api/models/schema_parts/corporate.py:23-25`).
Nothing supplies them, so:

- `corporate_dcf.py:161-162` substitutes `0.0` for the two missing terms and
  `intrinsic_value_per_share` stays `None`, which forces `estimated_value` to fall back to
  enterprise value and `status` to `"Bridge Incomplete"`.
- `corporate_comparison.py:372` hardcodes `net_debt=0.0`, so every comparison row reports
  enterprise value under a per-share label.

Three defects were found while tracing this, all in scope:

1. **Unit mismatch.** `metrics.fcff` is stored in billions
   (`corporate_statement_metrics.py:774` divides by `1_000_000_000`), so `enterprise_value`
   and `equity_value` are in billions. Balance-sheet figures and `sharesOutstanding` are
   raw. Feeding them in unscaled makes `equity_value / diluted_shares_outstanding` wrong by
   a factor of 10⁹ — and it returns a small plausible number, never an error.
2. **`Total Debt` aliased to `Net Debt`.** `corporate_statement_metrics.py:659`, `:1311`
   and `:1551` all read `_statement_map(balance, ("Total Debt", "Net Debt"))`. Net debt is
   total debt *minus cash*; for a cash-rich company the two differ by most of the balance
   sheet. When Yahoo omits `Total Debt` this silently understates debt in `debt_ratio`, the
   capital-structure weights and WACC.
3. **`intrinsic_value=current_price`.** `corporate_comparison.py:380` passes the current
   price as the intrinsic value into `calculate_expected_return_result`. Since
   `dcf_implied_return = f(price, price) = 0` and `stock_expected_return` is assigned from
   it (`packages/core_finance/expected_return.py:89`), three columns of the comparison table
   are structurally constant for every ticker: `dcf_implied_return` and
   `stock_expected_return` are always `0.00`, and `expected_return_spread` is always exactly
   `−market_expected_return`.

The raw data is already local. `corporate_statements` holds every balance-sheet line item
verbatim and `corporate_quote_facts` holds `shares_outstanding`, both acquired by the
statements track. **This design adds no acquisition and no SQL.** It reads what is stored.

## Decisions

| Question | Decision |
|---|---|
| Bridge input definitions | `net_debt = TotalDebt − (Cash + ShortTermInvestments)`, derived by us. `non_operating_assets = InvestmentsAndAdvances`. Cash enters exactly one term. |
| Yahoo's own `Net Debt` line | Not trusted as a primary source — its definition is undocumented and varies by sector. Used only to recover `Total Debt` when that line is absent. |
| Units | Billions everywhere. Scale at read time, `raw / 1e9`. Billions ÷ billions cancels to dollars per share. No currently displayed number changes. |
| Entry point | Request parameter wins; the store fills any field left `None`. Follows the precedent already at `corporate_dcf.py:119` for `fcff` and `esg_penalty`. |
| Quality metadata | A small dedicated `BridgeInputMeta` per field, reusing the existing `ok`/`estimated`/`missing` vocabulary. No invented confidence score. |
| ESG (item 3) | **Diagnostic-only, permanently, while its source is a string hash.** See below. |
| Comparison table | Fixed, and `METRIC_SCHEMA_VERSION` bumps `1 → 2`. |
| Alias bug | Fixed here, because shipping a correct `Total Debt` extractor next to the buggy one guarantees the two disagree. |

### Item 3: ESG and governance stay diagnostic-only

`esg_penalty` is not measured. `corporate_metrics_service.py:146` computes it as
`round(8.0 + (seed % 32), 2)` where `seed = sum(ord(char) for char in f"{ticker}:{sector}")`
— the sum of the character codes in the ticker string. `governance` (line 145) is the same.
The one value derived from it, `agency_discount` (`corporate_dcf.py:150`), is computed,
reported in `DCFFullReport`, and never multiplied into anything.

**Wiring ESG into WACC or the cash-flow scenarios would let renaming a ticker change its
valuation.** So it must not be wired in, and the decision is enforced by a test rather than
left to memory. Revisit only if ESG becomes a real acquisition data class with a measured
source.

`agency_discount` stays reported and inert. Removing it is an API contract change and
belongs with the `snapshot_version` rename, not here.

## Components

### `packages/core_finance/dcf.py` — one new formula

Sits beside `calculate_equity_value`; no new module.

```python
def calculate_net_debt(total_debt: float | None,
                       cash_and_equivalents: float | None) -> float | None:
    """Net debt = total debt - cash.

    None if either input is missing: a missing cash balance is not a zero cash
    balance, and returning 0.0 would hand a real number to the equity bridge.
    """
```

Negative results are valid and must be preserved — a company with more cash than debt has
negative net debt, which correctly *raises* equity value above enterprise value.

### `apps/api/services/equity_bridge.py` — new

Owns everything Yahoo-shaped. Pure apart from the injected loader.

One type throughout, not an internal dataclass mirrored by a payload model. `BridgeInputMeta`
is a Pydantic model declared in `apps/api/models/schema_parts/corporate.py` beside the other
DCF models; `equity_bridge.py` constructs it directly and the DCF payload carries the same
instances. A parallel dataclass would have to be kept structurally identical by hand, which
is the defect the `PortfolioStock` clone taught us to avoid.

```python
# apps/api/models/schema_parts/corporate.py
class BridgeInputMeta(BaseModel):
    value: float | None = None   # billions
    source: str                  # the line items used, e.g. "TotalDebt - (Cash + STI)"
    quality: str                 # ok | estimated | missing
    as_of: str | None = None     # period end the figure came from, "2025-09-30"


# apps/api/services/equity_bridge.py
@dataclass(frozen=True)
class EquityBridge:
    net_debt: BridgeInputMeta
    non_operating_assets: BridgeInputMeta
    diluted_shares_outstanding: BridgeInputMeta


def load_equity_bridge(
    ticker: str,
    *,
    bundle_loader=get_yahoo_statement_bundle,
) -> EquityBridge
```

`bundle_loader` is injected exactly as `yahoo_statement_metrics` does it, so every test runs
against a synthetic bundle with no database and no network. A ticker with nothing stored
returns an `EquityBridge` whose three inputs are all `quality="missing"` — never `None` for
the bridge itself, so callers never branch on two levels of absence.

### Extraction rules

The bundle already carries `income`, `balance`, `quarterly_balance` and `info`
(`store.py:148-156`), with `pd.Timestamp` columns.

**Latest period wins across annual and quarterly.** A balance sheet is a point-in-time
snapshot, so the newest one is the right one — unlike the per-year maps the metric layer
builds for multi-year ratios. The winning period end is recorded as `as_of`.

| Field | Source, in order | Absent → |
|---|---|---|
| `total_debt` | `Total Debt`; else `Net Debt + cash` | `net_debt` is `missing` |
| `cash` | `Cash Cash Equivalents And Short Term Investments`; else `Cash And Cash Equivalents` | `net_debt` is `missing` |
| `net_debt` | `total_debt − cash` | `value=None`, `quality="missing"` |
| `non_operating_assets` | `Investments And Advances`; else `Long Term Equity Investment` | `value=None`, `quality="estimated"`, summed as `0.0` |
| `diluted_shares_outstanding` | `Diluted Average Shares` (income) → `ok`; else `info["sharesOutstanding"]` → `estimated` | `value=None`, `quality="missing"` |

`non_operating_assets` is the one input that degrades to `estimated` rather than `missing`.
Omitting it understates equity value, but by an amount that is immaterial for most issuers,
and refusing to value a company because Yahoo did not report an investments line would make
the bridge useless. The degradation is visible in the payload; it is not silent.

The diluted share count prefers `Diluted Average Shares` because the field promises
*diluted* and `sharesOutstanding` is basic. `quote_facts.py` warns that share counts
aggregate share classes and miscount ADRs — that warning was measured against deriving
market cap from a share count, and the diluted average share count is the textbook
denominator for a per-share bridge. `sharesOutstanding` remains the fallback, marked
`estimated` so the payload says which one was used.

All four figures are divided by `1e9` at read time. Everything downstream is in billions.

## Wiring

### `corporate_dcf._build_dcf_outputs`

Extends the precedent already at line 119:

```python
bridge = bridge_loader(ticker) if (
    params.net_debt is None
    or params.non_operating_assets is None
    or params.diluted_shares_outstanding is None
) else None

net_debt = params.net_debt if params.net_debt is not None else bridge.net_debt.value
```

`bridge_quality` becomes `_pick_worst_quality` over the three inputs, reusing the existing
ranking in `corporate_statement_metrics.py:857`. A request-supplied override reports
`quality="ok"` with `source="request"` — the caller asserted it.

Three `BridgeInputMeta` fields join `DCFSummary` and `DCFFullReport`.
`ValuationAssumptions` is unchanged, so the DCF what-if simulator keeps working.

### `corporate_comparison._dcf_snapshot`

- Stops hardcoding `net_debt=0.0`; consumes `load_equity_bridge`.
- Stops passing `intrinsic_value=current_price`. Passes the real intrinsic per-share value
  when the bridge resolves.
- `dcf_value` becomes the intrinsic per-share value when available, enterprise value
  otherwise, matching `estimated_value`'s documented fallback.
- `status` becomes a real Undervalued/Overvalued verdict instead of a constant.

**When the bridge does not resolve**, `dcf_implied_return`, `stock_expected_return` and
`expected_return_spread` are typed `float` on `CorporateComparisonRow`
(`schema_parts/corporate.py:217-221`) and feed non-optional aggregates such as
`average_expected_return_spread`. Widening them to `float | None` is a contract change that
would push `None` handling into the frontend and the aggregate math.

Instead, follow the precedent the row already sets with `has_price_data: bool` (line 223):
add `bridge_quality: str = "missing"` to `CorporateComparisonRow`. The three fields keep
their `0.0`, and the flag beside them says the value is not meaningful — the same shape the
frontend already handles for a missing price. Rows without a resolved bridge are excluded
from `average_expected_return_spread` and `average_dcf_value`, so one starved ticker cannot
drag the portfolio aggregate toward zero.

### `corporate_statement_metrics.py`

`("Total Debt", "Net Debt")` becomes `("Total Debt",)` at `:659-660`, `:1311-1312` and
`:1551-1552`, with `Net Debt + cash` as the recovery path so coverage does not drop for
tickers where Yahoo omits the `Total Debt` line.

## Blast radius

Accepted deliberately; this is the point of the work.

- Every comparison row's `dcf_value`, `status`, `dcf_implied_return`,
  `stock_expected_return` and `expected_return_spread` change, and the row gains
  `bridge_quality`.
  **`METRIC_SCHEMA_VERSION` bumps `1 → 2`** (`corporate_comparison.py:46`) so pre- and
  post-change snapshots never compare as like-for-like.
- `debt_ratio` and `wacc` change for any ticker where Yahoo omitted `Total Debt`. Those
  values were understated; the new ones are correct.
- Existing snapshot rows keep `metric_schema_version = 1` and stay readable. Snapshots are
  immutable and inserted, never replaced, so no history is rewritten.
- `packages/shared-types/generated/*` gets staler by three fields. Already known-stale and
  confirmed inert — nothing in `apps/web` imports corporate-comparison types from it.
  Regeneration needs a network install for `json2ts` and stays with the contract-cleanup
  track.

## Testing

Every test is written failing first.

**`packages/core_finance`**
- `calculate_net_debt` subtracts cash; returns `None` if either input is `None`; preserves a
  negative result for a cash-rich balance sheet.

**`apps/api/services/equity_bridge.py`**
- Each field extracted from a synthetic bundle, with `as_of` equal to the newest period end.
- Quarterly beats annual when its period end is newer.
- Each quality outcome: `ok`, the `estimated` fallbacks, and `missing`.
- **Scaling**: a bundle in raw dollars yields a per-share value in dollars, not 10⁻⁹ dollars.
  This is the test that would have caught the unit mismatch.
- `Total Debt` absent but `Net Debt` and cash present recovers total debt.
- A ticker with nothing stored returns three `missing` inputs, not `None`.

**`apps/api/services/corporate_dcf.py`**
- A request parameter overrides the store.
- The store fills a field the request left `None`.
- `bridge_quality` is the worst of the three.
- `esg_penalty` moves no output — enterprise value, equity value and per-share value are
  identical for `esg_penalty=8.0` and `esg_penalty=40.0`. This encodes the item 3 decision.

**`apps/api/services/corporate_comparison.py`**
- `dcf_value` is the intrinsic per-share value and `status` is not `"Bridge Incomplete"`
  when the bridge resolves.
- `dcf_implied_return` varies with intrinsic value rather than being pinned at `0.00`.
- A row whose bridge does not resolve reports `bridge_quality="missing"` and is excluded
  from `average_expected_return_spread` and `average_dcf_value`.
- `metric_schema_version` is written as `2`.

**Regression, must stay green**
- The existing "DCF value does not depend on current price" tests from Phase 1.
- Backend suite lands at **≥418 passed** (the current baseline).
- `npx tsc --noEmit` from `apps/web` exits 0.

## Documentation

- `docs/dcf-valuation.md` — the bridge definitions, the units convention, and the item 3
  ESG decision with its evidence.
- `ERROR-LOG.md` — one entry each for the `Total Debt`/`Net Debt` alias and the
  `intrinsic_value=current_price` defect. Both caused wrong output with no error raised.
- `guideline/sop/todo.md` — Phase 2 items 1–3 marked complete; item 4 restated as its own
  track.

## Not in scope

- **Item 4, the WACC × terminal-growth sensitivity table.** A UI feature, and one worth
  building on a bridge that has data in it. Its own cycle.
- **ESG as an acquisition data class.** Would dominate this spec, and coverage is thin.
- **Removing the dead `agency_discount`.** An API contract change.
- **The `snapshot_version` → `snapshot_id` rename and `SNAPSHOT_CADENCE` removal.** Seven
  call sites that must move together.
- **Regenerating `packages/shared-types/generated/*`.** Needs network.
