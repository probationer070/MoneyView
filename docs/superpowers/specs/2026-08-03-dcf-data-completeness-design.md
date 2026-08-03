# DCF Data Completeness — Design

Date: 2026-08-03
Track: Financial Logic Remediation, Phase 2 (`guideline/sop/todo.md`)
Covers Phase 2 items 1, 2 and 3. Item 4 (the WACC × terminal-growth sensitivity table)
is deliberately excluded — see [Not in scope](#not-in-scope).

## Design principle

Equity-bridge inputs are derived exclusively from locally stored statements and quote facts.
No acquisition pipeline, no new table, no migration of existing values. This phase converts
raw data the statements track already stores into valuation inputs carrying explicit quality
metadata — nothing more.

One exception, and it is additive: `corporate_comparison_snapshots_v3` gains a
`bridge_quality` column. The aggregates it governs are computed in SQL over that table
(`corporate_comparison.py:605-607`), not in Python over live rows, so a value that is not
persisted cannot be filtered on. It follows the guarded `PRAGMA table_info` /
`ALTER TABLE ... ADD COLUMN` pattern the table already uses for four other columns
(`db.py:639-670`). No existing column is altered and no stored value is rewritten.

Every decision below follows from that. Where a choice would have required new storage, new
fetching, or a migration, it was rejected; the [Rejected alternatives](#rejected-alternatives)
section records which.

## Problem

Phase 1 built the enterprise-to-equity bridge and it is correct. Nothing supplies its inputs.

They exist only as request parameters on `ValuationAssumptions`
(`apps/api/models/schema_parts/corporate.py:23-25`), and no caller sends them, so:

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
| Where scaling happens | At read time in `equity_bridge.py`, not in the store. Stored values stay verbatim as the provider reported them, no migration is needed, and unit conversion lives in exactly one layer instead of being spread across the acquisition, storage and metric paths. |
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

## The valuation this feeds

```
                         projected FCFF + terminal value, discounted
    enterprise_value  =  ─────────────────────────────────────────────   (Phase 1, correct)
                                        at WACC

    equity_value      =  enterprise_value − net_debt + non_operating_assets
                                            ▲              ▲
                                            └──────────────┴── supplied by this phase

                            equity_value
    per-share value   =  ───────────────────────
                         diluted_shares_outstanding
                                    ▲
                                    └── supplied by this phase

    upside_pct        =  (per-share value / current_price − 1) × 100
```

`current_price` appears once, in the last line, and only as a comparison. It must never
reach any line above it — that is the Phase 1 invariant this phase must not break.

All three quantities on the right of the bridge are in billions, so the division yields
dollars per share directly.

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
    source: str                  # one of BridgeSource, never a free-form string
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

`load_equity_bridge` writes nothing, opens no socket, and holds no module state. Its only
effect is the read its `bundle_loader` performs, and that read goes through the same
`get_db()` connection handling as the rest of the service layer. Two concurrent fan-out
calls for different tickers cannot interfere.

### Source and quality vocabulary

`source` is drawn from a closed set, not written free-form at each call site. Free-form
strings drift, and the UI has to render this value.

```python
class BridgeSource(StrEnum):
    REQUEST                = "request"                    # the caller asserted it
    TOTAL_DEBT_LESS_CASH   = "total_debt_less_cash"
    NET_DEBT_PLUS_CASH     = "net_debt_plus_cash"         # Total Debt line absent
    INVESTMENTS_ADVANCES   = "investments_and_advances"
    DILUTED_AVERAGE_SHARES = "diluted_average_shares"
    SHARES_OUTSTANDING     = "shares_outstanding"         # basic, not diluted
    UNAVAILABLE            = "unavailable"
```

**Quality ordering.** `ok` < `estimated` < `missing`, and `bridge_quality` is the worst of
the three inputs. This is a three-value subset of the six-level vocabulary
`corporate_statement_metrics.py:857` already ranks (`ok`, `estimated`, `stale`,
`suspicious`, `invalid`, `missing`) — the bridge reuses `_pick_worst_quality` unchanged and
simply never emits the middle three. A figure copied verbatim off a filing is not
`suspicious`; it is present or it is not.

**The rule for which one applies:**

| Quality | Means | Effect on the sum |
|---|---|---|
| `ok` | The preferred source was present and parsed | Used as-is |
| `estimated` | A documented fallback source was used, or the term was omitted as immaterial | Used, or treated as `0.0` |
| `missing` | No source resolved, and no defensible substitute exists | `value=None`; the per-share value cannot be produced |

The dividing line is whether a wrong answer is bounded. Omitting `non_operating_assets`
understates equity value by an amount that is small for most issuers, so it degrades to
`estimated`. Substituting anything for `net_debt` or the share count is unbounded — a
leveraged company valued at zero net debt is simply wrong — so those degrade to `missing`.

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
| `net_debt` | `total_debt − cash` → `ok`; else the `Net Debt` line → `estimated` | `value=None`, `quality="missing"` |
| `non_operating_assets` | `Investments And Advances`; else `Long Term Equity Investment` | `value=None`, `quality="estimated"`, summed as `0.0` |
| `diluted_shares_outstanding` | `Diluted Average Shares` (income) → `ok`; else `info["sharesOutstanding"]` → `estimated` | `value=None`, `quality="missing"` |

Debt resolution, which is the only input with a recovery path:

```
   Total Debt AND a cash line present?
          │
         yes ──> net_debt = TotalDebt − cash    total_debt_less_cash   quality: ok
          │
          no
          ▼
   Net Debt line present?
          │
         yes ──> net_debt = NetDebt             net_debt_plus_cash     quality: estimated
          │
          no
          ▼
   net_debt = None                              unavailable            quality: missing
```

The fallback branch is `estimated`, not `ok`, and that is deliberate. Recovering total debt
as `NetDebt + cash` and then netting cash back out is arithmetically just `NetDebt` — so
taking that branch means relying on Yahoo's own net-debt definition, which is undocumented
and varies by sector. The result is usable and the payload says it was a fallback.

Note the asymmetry with the WACC fix below: `debt_ratio` needs **gross** total debt, so
there the recovery genuinely is `NetDebt + cash` and the cash term does not cancel. Same two
line items, two different consumers, two different expressions. Do not collapse them into
one helper.

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
frontend already handles for a missing price.

How `bridge_quality` governs each row:

| `bridge_quality` | `dcf_value` | `status` | The three return fields | In the aggregates? |
|---|---|---|---|---|
| `ok` | intrinsic per-share | Undervalued / Overvalued | computed from intrinsic value | yes |
| `estimated` | intrinsic per-share | Undervalued / Overvalued | computed from intrinsic value | yes |
| `missing` | enterprise value | `Bridge Incomplete` | `0.0`, not meaningful | **no** |

Excluding `missing` rows from `average_expected_return_spread` and `average_dcf_value` is
what stops one starved ticker dragging the portfolio aggregate toward zero. An `estimated`
row is included: its number is defensible, and the row carries the label that says so.

### Compatibility

**Additive:** `BridgeInputMeta` and the three fields on `DCFSummary` / `DCFFullReport`;
`bridge_quality` on `CorporateComparisonRow`. Existing clients that ignore them are
unaffected.

**Changed in value, not in shape:** `dcf_value`, `status`, `dcf_implied_return`,
`stock_expected_return`, `expected_return_spread`, `debt_ratio`, `wacc`. Same names, same
types, same units — different numbers, because the old ones were wrong.

**Not changed:** `ValuationAssumptions` keeps all three request fields, so the DCF what-if
simulator and any caller supplying its own bridge continue to work unmodified. No field is
removed or renamed, and no type is widened. Nothing in this phase is breaking.

**Snapshots and caches.** Snapshot rows are immutable and inserted, never replaced, so no
stored history is rewritten; existing rows keep `metric_schema_version = 1` and stay
readable alongside new `2` rows. The statement cache is keyed by ticker and holds raw
provider frames, not derived metrics, so nothing in it needs invalidating.

**The `bridge_quality` column defaults to `''` for pre-existing rows, not to `'missing'`.**
`db.py:666-670` already sets this precedent for `metric_schema_version`, which defaults to
`0` rather than the current version precisely so rows computed before the column existed stay
distinguishable. The aggregate filter excludes only `bridge_quality = 'missing'`, so legacy
rows carrying `''` remain in the aggregates and every historical average reads exactly as it
does today. Defaulting them to `'missing'` would silently rewrite the history the column
exists to preserve.

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
- Snapshot and cache handling is unchanged — see [Compatibility](#compatibility).
- `packages/shared-types/generated/*` gets staler by four fields. Already known-stale and
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
- `Total Debt` absent but the `Net Debt` line present resolves `net_debt` at quality
  `estimated`, not `ok` — the fallback must be labelled as one.
- A ticker with nothing stored returns three `missing` inputs, not `None`.
- Every emitted `source` is a `BridgeSource` member, so no free-form string can reach the UI.

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
- An `estimated` row **is** included in both aggregates — the exclusion rule must not be
  written as "anything that isn't `ok`".
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

## Rejected alternatives

Each of these was considered and discarded. Recorded so the next reader does not have to
re-derive the reasoning, and so a future change that revisits one knows what it is overturning.

**Gross-debt bridge — `net_debt = TotalDebt`, cash on the asset side.**
Arithmetically identical to the chosen definition, and it keeps every stored figure
traceable to exactly one Yahoo label. Rejected because the field is named `net_debt` in an
API contract that already shipped; putting gross debt in it makes the payload lie.

**Trust Yahoo's `Net Debt` line as the primary source.**
Higher coverage, fewer `missing` rows. Rejected because its definition is undocumented and
varies by sector, so two different definitions would flow into one field with nothing
downstream able to tell which it got — the same opacity that produced the `Total Debt`
alias bug. It survives only as the `estimated` fallback.

**Raw dollars everywhere — remove the `1e9` division from `metrics.fcff`.**
The most internally consistent option: every figure in units of currency, no scaling layer.
Rejected on blast radius. It changes `fcff`, `enterprise_value` and everything derived from
them across the comparison table, the DCF report, stored snapshots and every frontend format
string and chart axis that assumes billions.

**Migrate stored values to billions.**
Rejected for the same reason read-time scaling was chosen: it requires a migration over
existing rows, and it would make the store's contents differ from what the provider
reported, so a stored figure could no longer be checked against the source.

**Tag units on the model — `net_debt_unit: Literal["usd", "usd_billions"]`.**
Genuinely safer against a future caller passing the wrong scale. Rejected as three new
fields and a conversion layer defending one division; the scaling test covers the same risk.

**Drop the three request parameters and always source from the store.**
A stronger invariant — the bridge could not be spoofed by a caller. Rejected because it
breaks the DCF what-if simulator, whose entire purpose is overriding assumptions, and
because removing shipped request fields is a breaking contract change.

**Put the three fields on `CorporateMetrics`.**
Everything already loading metrics would get the bridge for free, including
`corporate_comparison`. Rejected because it widens a model already carrying 40+ fields and
mixes point-in-time valuation inputs with multi-year operating metrics — two different
things with two different freshness boundaries.

**Reuse `CorporateDerivedMetricMeta` for the bridge inputs.**
One metadata type across the corporate surface, and the frontend already renders it.
Rejected because `confidence`, `warnings`, `metric_role` and `calculation_version` are
meaningless for a number copied verbatim off a balance sheet — six of its nine fields would
hold constants, and an invented confidence score is worse than none.

**A single scalar `bridge_quality` plus a list of degraded field names.**
Smallest possible contract change. Rejected because the UI could then say "incomplete" but
not "net debt as of 2025-09-30, from total debt minus cash", which is most of what makes the
label worth showing.

**Source real ESG data first, then decide item 3.**
Yahoo exposes sustainability data for some tickers. Rejected as a whole acquisition
sub-project with thin coverage; it would dominate this spec. The decision to keep ESG
diagnostic-only stands until that work happens.

## Not in scope

- **Item 4, the WACC × terminal-growth sensitivity table.** A UI feature, and one worth
  building on a bridge that has data in it. Its own cycle.
- **ESG as an acquisition data class.** Would dominate this spec, and coverage is thin.
- **Removing the dead `agency_discount`.** An API contract change.
- **The `snapshot_version` → `snapshot_id` rename and `SNAPSHOT_CADENCE` removal.** Seven
  call sites that must move together.
- **Regenerating `packages/shared-types/generated/*`.** Needs network.
