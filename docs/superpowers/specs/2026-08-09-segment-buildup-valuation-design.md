# Segment Build-Up Valuation — Design

Date: 2026-08-09
Status: draft, pending review
Source: `guideline/sop/todo3.md` (Damodaran SpaceX valuation reference)
Scope: pieces **3a + 3b** of the four-piece decomposition in §2 below.

> This is a new track. It is unrelated to the "sub-project N of 4" numbering in
> `guideline/sop/todo.md` §346–494, whose remaining pieces are UI/UX redesign and
> stock-add flows.

---

## 1. Problem

`guideline/sop/todo3.md` reconstructs the valuation architecture Aswath Damodaran
used for SpaceX: a **segment build-up, target-year DCF**. MoneyView cannot express
that model today, and the gaps are structural rather than cosmetic.

| todo3 requirement | MoneyView today | Where |
| --- | --- | --- |
| N business segments, each with its own TAM, share, margin, capital intensity | single consolidated FCFF stream | `packages/core_finance/dcf.py:124` |
| 10-year explicit horizon | 5 years, hardcoded | `apps/api/services/corporate_dcf.py:141` |
| Time-varying WACC, cumulative discount factors (F4) | scalar WACC, `(1+w)^t` | `dcf.py:61` |
| Reinvestment as `ΔRev / salesToCapital` (I1) | capex/D&A/ΔNWC inputs | `dcf.py:13` |
| NOL-aware tax path (F2) | single `tax_rate` scalar | `dcf.py:13` |
| Hand-authored case, no ticker, no market data | every entry point is ticker-driven and loads acquired statement data | `corporate_dcf.py:116` (`current_price_loader`, `metrics_loader`) |
| Every numeric input traces to one narrative claim (§7) | nothing records why an input holds its value | — |

The Monte Carlo tab does not close the gap either. The backend engine
(`apps/api/routes/monte_carlo.py`) simulates GBM **price paths**, and the valuation
simulator (`apps/web/app/monte-carlo/lib/valuation-core.ts:56`) is a client-side
EPS/PER model in a web worker. Neither is a distribution over DCF *inputs*.

### 1.1 The intent decision

This is built as a **generic capability**, not a SpaceX reproduction. Segment
build-up valuation applies to any young, big-market, multi-business company. SpaceX
is the seed fixture that proves the engine.

That decision has one immediate consequence: pre-IPO SpaceX has no ticker and no
acquired data, so `valuation_case` must be a **hand-authored first-class object**,
independent of the acquisition pipeline. It lives alongside the existing
ticker-driven DCF and replaces nothing.

### 1.2 The verification problem

todo3 §9.4 proposes this acceptance test:

> If your build reproduces EV = $1.22T and value/share ≈ $100 from the confirmed
> inputs, the `[V]` assumptions are validated.

**This test does not work as stated.** todo3 §10 concedes that base margins, all four
`sales_to_capital` pairs, the marginal tax rate, the NOL balance, and the exact
interpolation shape are absent from the blog posts. That is more than a dozen free
parameters. A model with a dozen free parameters can be tuned to $1.22T while being
structurally wrong, so agreement would prove nothing.

S4/S5 are `.xlsx` binaries on `pages.stern.nyu.edu`; retrieving them as text does not
yield cell formulas, so calibration is not available in this cycle.

**Resolution.** A subset of todo3 §3 *is* fully determined by confirmed inputs and is
therefore a genuine gate. Target-year revenue is `TAM × share` (or `revenue_target`)
by construction, and `φ(10) = 0` makes target-year margin equal `margin_target`. So:

- **Gated:** year-10 revenue and EBIT totals; all path/tax/discounting invariants.
- **Diagnostic, never gated:** enterprise value and per-share value against
  Damodaran's $1.22T / ~$100. `/run` returns the model's own figures; the
  comparison against Damodaran's published numbers is measured once and recorded
  in the project ledger (`.superpowers/sdd/2026-08-09-segment-buildup-valuation/
  progress.md`), not recomputed on every request.
- Every `[V]` input is persisted with `confidence = 'assumed'` and a claim string, so
  the guessing is visible in the data rather than buried in a comment.

---

## 2. Decomposition

todo3 §9 specifies five tables, eight engine functions, seven endpoints, Monte Carlo,
and an implied UI. That is four independent subsystems. Split:

| Piece | Contents | Status |
| --- | --- | --- |
| **3a** Engine core | `packages/core_finance/segment_valuation.py`: revenue path, margin path, reinvestment, NOL tax, time-varying WACC, cumulative discount factors, terminal value, equity bridge. Pure functions. | **this spec** |
| **3b** Persistence + API | 3 tables, CRUD, `/run`, narrative-completeness rule, both SpaceX cases seeded. | **this spec** |
| **3c** Uncertainty + attribution | Monte Carlo over input distributions, `/fork`, `/diff` attribution waterfall, `/pricing` multiples. | deferred |
| **3d** UI | Valuation tab: segment editor, narrative bridge, waterfall, sensitivity grid. | deferred |

R&D capitalization (todo3 P3/P4/P6) is deferred out of 3a/3b — see §7.2.

---

## 3. Architecture

A new module, additive, with zero changes to existing valuation code.

```
apps/api/routes/valuation.py          ← HTTP, ValueError → 422
        │
apps/api/services/valuation_case.py   ← persistence, narrative rule, orchestration
apps/api/services/valuation_seed.py   ← the two SpaceX fixtures
        │
packages/core_finance/segment_valuation.py   ← pure math, no I/O
        │
packages/core_finance/dcf.py          ← REUSED: calculate_equity_value,
                                         calculate_intrinsic_value_per_share
```

**Why a new module rather than generalizing `dcf.py`.** `calculate_npv` and
`multi_stage_dcf` take a scalar discount rate and are consumed by `corporate_dcf.py`
and `sensitivity_grid`. Widening those signatures to accept a rate *vector* would
touch working code covered by the existing suite, for no benefit to that code. The
two models genuinely differ: 5-year constant-WACC single-stream versus 10-year
time-varying segment build-up.

**Why the equity bridge is reused rather than rewritten.** todo3's E1 is
`Equity = EV + Cash + IPOProceeds − Debt`. MoneyView's is
`Equity = EV − NetDebt + NonOperatingAssets`. These are the same identity under
`NetDebt = Debt − Cash` and `NonOperatingAssets = IPOProceeds` — which is also
todo3 E3's stated reason for holding proceeds as cash. One implementation, one test
asserting the identity holds (§6 gate 5).

### 3.1 Pipeline

```
SegmentSpec[] ─┬─> revenue_path()   ─> revenue[i][1..10]
               └─> margin_path()    ─> margin[i][1..10]
                          │
                    EBIT[i][t] = revenue × margin ;  EBIT[t] = Σ_i
                          │
        reinvestment()  ── ΔRev[i][t] / salesToCapital[i][t]      (I1)
                          │
        tax_path()      ── NOL rollforward → effective τ[t]        (F2)
                          │
        FCFF[t] = EBIT[t]·(1 − τ[t]) − Reinvest[t]                 (F1)
                          │
        wacc_path() ─> discount_factors()   cumulative product     (F3, F4)
                          │
        terminal_value()   +   Σ FCFF[t]·DF[t]                     (F6–F9)
                          │
        EV ─> equity_bridge() ─> equity, per share                 (E1, E4)
```

---

## 4. Engine core (3a)

`packages/core_finance/segment_valuation.py`. Pure functions, NumPy where it earns
its place, no I/O — matching the module contract in
`guideline/sop/file-structure.md:42`.

### 4.1 Contract

```python
@dataclass(frozen=True)
class SegmentSpec:
    name: str
    base_revenue: float          # billions
    base_margin: float           # R&D-adjusted operating margin — see §7.2
    margin_target: float
    sales_to_capital_early: float   # years 1..5
    sales_to_capital_late: float    # years 6..10
    tam_target: float | None = None
    market_share_target: float | None = None
    revenue_target: float | None = None
    ramp_start_year: int = 1

    def target_revenue(self) -> float:   # R1
        ...

@dataclass(frozen=True)
class CaseSpec:
    base_year: int
    target_year: int
    riskfree_rate: float
    wacc_initial: float
    wacc_stable: float
    wacc_converge_from: int      # required, no default
    marginal_tax_rate: float
    nol_balance: float
    roic_stable: float
    cash: float; debt: float; ipo_proceeds: float
    shares_basic: float; shares_new: float     # billions of shares — see §4.3

def revenue_path(spec: SegmentSpec, n: int, g_stable: float) -> list[float]
def margin_path(spec: SegmentSpec, n: int) -> list[float]
def reinvestment(revenues: list[float], spec: SegmentSpec) -> list[float]
def tax_path(ebit: list[float], marginal: float, nol: float) -> list[float]
def wacc_path(wacc_initial: float, wacc_stable: float, n: int, converge_from: int) -> list[float]
def discount_factors(waccs: list[float]) -> list[float]
def terminal_value(ebit_n, marginal_tax, g_stable, roic_stable, wacc_stable) -> float
def run_case(case: CaseSpec, segments: list[SegmentSpec]) -> CaseResult
```

### 4.2 Formula decisions

**Revenue path (R3) — one curve.** Growth decays linearly from `g₁` to `g_stable`:

```
g_t = g₁ − (g₁ − g_stable) · (t − 1)/(n − 1)
```

with `g₁` solved by **bisection** so that `Π_t (1 + g_t) = target_revenue / base_revenue`.
The product is strictly monotone increasing in `g₁`, so bisection converges
deterministically; tolerance `1e-9` on the resulting target revenue.

todo3 §2.1 lists three curve options and the schema in §9.1 carries a `growth_curve`
column. **Dropped.** One curve is what the model needs; a second is speculative
configurability until something requires it. When calibration data arrives, adding a
curve is additive.

**Zero-base and ramped segments.** The `expansion` segment has `base_revenue = 0`, and
no growth rate reaches a positive target from zero. Separate rule: **linear ramp**
from `0` at year `ramp_start_year − 1` to `revenue_target` at year `n`. Years before
`ramp_start_year` are zero revenue *and* zero reinvestment (todo3 trap #6).

**Margin path (P2) — linear φ.**

```
margin_t = margin_target − (margin_target − base_margin) · φ(t)
φ(t) = (n − t)/(n − 1)      so  φ(1) = 1,  φ(n) = 0
```

todo3 P2 notes Damodaran "typically back-loads" φ, but tags it `[V]`. Inventing a
back-loading exponent would be fake precision on an unmeasured quantity. Linear now;
the shape is one function when S4/S5 become available.

**Reinvestment (I1).** `(Rev_t − Rev_{t−1}) / salesToCapital_t`, using
`sales_to_capital_early` for years 1–5 and `..._late` for 6–10. Zero before
`ramp_start_year`. `sales_to_capital ≤ 0` raises.

**Tax (F2).** Explicit NOL rollforward, not a scalar rate:

```
if EBIT_t < 0:  nol += −EBIT_t ;                       tax_t = 0
else:           shield = min(nol, EBIT_t) ; nol −= shield
                tax_t = (EBIT_t − shield) · marginal_tax_rate
τ_t = tax_t / EBIT_t   (effective rate implied by tax_t; not itself computed
                        or returned -- tax_path returns tax_t only)
```

**WACC (F3).** `wacc_initial` through year `wacc_converge_from − 1`, then linear to
`wacc_stable` at year `n`.

**Discount factors (F4).** `DF_t = DF_{t−1} / (1 + wacc_t)`, cumulative product.
Never `(1 + w)^t` — todo3 names this the common implementation bug.

**Terminal value (F5–F8).**

```
g_stable      = terminal_growth ?? riskfree_rate    # raises if supplied g > rf
ReinvRate     = g_stable / roic_stable              # F6
FCFF_{n+1}    = EBIT_n · (1 + g) · (1 − marginal) · (1 − ReinvRate)
TV_n          = FCFF_{n+1} / (wacc_stable − g_stable)
```

`terminal_growth` is an **optional** case input defaulting to `riskfree_rate`.
Without it, todo3's F5 cap ("enforce `g_stable ≤ riskfree_rate` — raise, don't warn",
trap #2) is a tautology: a value *defined* as the riskfree rate cannot exceed it, so
there would be nothing to enforce and trap #2 would have no implementation. Making it
optional keeps Damodaran's behaviour exactly (both seeds leave it NULL) while giving
the cap something real to reject. Adds one nullable column, `terminal_growth REAL`.

**Horizon.** `n = target_year − base_year`. todo3 is self-contradictory here: §9.1
annotates `target_year` as `base_year + 10`, but §9.4 seeds `base_year=2025,
target_year=2036`, which is 11. Every other reference — §3's "target year 2036 (year
10)", R5's ramp "by t = 10", P2's `φ(10)=0`, R2's `^(1/10)` — assumes 10. The seeds
therefore use `base_year=2026, target_year=2036`, with todo3 §4's FY2025 figures as
the year-0 starting point, which matches valuations dated April and June 2026. The
§6 gates are unaffected by this choice either way, since the path terminates at
`target_revenue` and `margin_target` at year `n` for any `n`.

`roic_stable` is a **required case input**. todo3's F6 needs it and §9.1 has no
column for it — an omission in the source document, not a design choice here.
Deriving it from the model's own year-10 ROIC would make terminal value a function of
the `[V]` sales-to-capital guesses, which is exactly the coupling to avoid.

### 4.3 Units

Billions throughout, **including share counts**. `docs/dcf-valuation.md:225` fixes
this convention for the repo; todo3 §9.4 uses millions (`shares_basic=12_535`), which
would introduce a second unit convention into the same codebase. Seeded as `12.535`.

---

## 5. Persistence and API (3b)

### 5.1 Schema

Three tables, appended to the existing `SCHEMA` block in
`apps/api/services/db.py:218`, matching its `CREATE TABLE IF NOT EXISTS` style. There
is no migration framework in this repo; `_ensure_schema_compatibility` handles
retrofits, and new tables need no retrofit.

```sql
CREATE TABLE IF NOT EXISTS valuation_case (
    id                 INTEGER PRIMARY KEY,
    case_name          TEXT NOT NULL UNIQUE,
    ticker             TEXT,                    -- NULL for pre-IPO / private
    as_of_date         TEXT NOT NULL,
    base_year          INTEGER NOT NULL,
    target_year        INTEGER NOT NULL,
    riskfree_rate      REAL NOT NULL,
    wacc_initial       REAL NOT NULL,
    wacc_stable        REAL NOT NULL,
    wacc_converge_from INTEGER NOT NULL DEFAULT 6,
    marginal_tax_rate  REAL NOT NULL,
    nol_balance        REAL NOT NULL DEFAULT 0,
    roic_stable        REAL NOT NULL,
    cash               REAL NOT NULL DEFAULT 0,
    debt               REAL NOT NULL DEFAULT 0,
    ipo_proceeds       REAL NOT NULL DEFAULT 0,
    shares_basic       REAL NOT NULL,
    shares_new         REAL NOT NULL DEFAULT 0,
    parent_case_id     INTEGER REFERENCES valuation_case(id)
);

CREATE TABLE IF NOT EXISTS segment (
    id                     INTEGER PRIMARY KEY,
    case_id                INTEGER NOT NULL REFERENCES valuation_case(id) ON DELETE CASCADE,
    name                   TEXT NOT NULL,
    base_revenue           REAL NOT NULL,
    base_margin            REAL NOT NULL,
    tam_target             REAL,
    market_share_target    REAL,
    revenue_target         REAL,
    margin_target          REAL NOT NULL,
    sales_to_capital_early REAL NOT NULL,
    sales_to_capital_late  REAL NOT NULL,
    ramp_start_year        INTEGER NOT NULL DEFAULT 1,
    UNIQUE(case_id, name)
);

CREATE TABLE IF NOT EXISTS segment_narrative (
    segment_id      INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    input_field     TEXT NOT NULL,
    claim           TEXT NOT NULL,
    evidence_source TEXT,
    confidence      TEXT NOT NULL CHECK(confidence IN ('confirmed','derived','assumed')),
    three_p         TEXT NOT NULL CHECK(three_p IN ('possible','plausible','probable')),
    PRIMARY KEY (segment_id, input_field)
);
```

**`UNIQUE(case_name)`, not `UNIQUE(ticker, case_name)`.** todo3 §9.1 uses the pair,
but `ticker` is NULL for pre-IPO SpaceX and SQLite treats NULLs as distinct in a
unique index — the constraint would silently not constrain the exact rows it exists
to protect.

**Two tables dropped from todo3 §9.1.** `simulation_input` belongs to 3c.
`valuation_output` is dropped outright for now: a deterministic run over 4 segments ×
10 years is microseconds, so persisting it is storage without a consumer. It returns
in 3c, when a 10,000-run Monte Carlo makes caching pay.

**`parent_case_id` is kept** even though `/diff` is deferred, because the seed
genuinely carries the relationship (post-prospectus supersedes pre-prospectus) and
`db.py:668` shows what adding a column later costs in this codebase.

**Two columns dropped, one added** versus todo3 §9.1: `growth_curve` (§4.2),
`rnd_amort_life` (§7.2); `roic_stable` (§4.2).

### 5.2 The narrative rule

Enforced in `valuation_case.py` on write. Every non-NULL value-bearing field on a
`segment` row must have a matching `segment_narrative` row:

```
base_revenue, base_margin, margin_target,
sales_to_capital_early, sales_to_capital_late,
tam_target, market_share_target, revenue_target      (whichever are non-NULL)
```

A missing narrative rejects the whole POST with **422** naming the offending
`(segment, field)`. This is the rule todo3 §9.1 calls the differentiator, and it is
what carries the `[V]` honesty into the data: each guessed input is stored as
`confidence='assumed'` with its claim text and `evidence_source`.

`three_p` is **stored but not gated.** todo3 §7 says value only what clears
*Probable*, but a gate the seed data trivially satisfies tests nothing. `/run`
instead returns the list of inputs below `probable`, so the caller sees them.

### 5.3 Endpoints

`apps/api/routes/valuation.py`, schemas in
`apps/api/models/schema_parts/valuation.py` (existing `schema_parts` pattern).

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/valuation/cases` | Create case + segments + narratives in one transaction; narrative rule enforced |
| `GET` | `/valuation/cases` | List cases |
| `GET` | `/valuation/cases/{id}` | Full case with segments and narratives |
| `POST` | `/valuation/cases/{id}/run` | Deterministic run |

`/run` returns: per-segment per-year revenue, margin, EBIT and reinvestment; the
consolidated EBIT / tax / FCFF / WACC / discount-factor series; `pv_explicit`,
`pv_terminal`, `terminal_value_share_pct`; the **equity waterfall**
(`EV → +cash → +proceeds → −debt → equity → per share`, basic and diluted); the
`wacc_stable − g_stable` **spread** exposed directly (todo3 trap #5);
`base_revenue_total` and `base_ebit_total`; and the `below_probable` input list.
It is the model's own figures throughout — `enterprise_value`,
`value_per_share_basic`/`_diluted` included. There is no endpoint-computed
comparison against Damodaran's published $1.22T / ~$100; see §6.

todo3's separate `GET /bridge` is folded into `/run` — the waterfall is a projection
of the same computation, and a second endpoint recomputing it duplicates the model.
`/fork`, `/diff`, `/simulate`, `/pricing` are 3c.

### 5.4 Seed

`apps/api/services/valuation_seed.py`, following the `watchlist_seed.py` pattern,
idempotent on `case_name`. Plants **both** cases from todo3 §3:

- `spacex_2026_04_pre_prospectus` — target-year revenue $320bn, EBIT $151bn
- `spacex_2026_06_post_prospectus` — target-year revenue $400bn, EBIT $158.5bn,
  `parent_case_id` → the pre case

Both are seeded because each yields an independent confirmed-input gate (§6 gate 1),
and because the pre/post pair is the fixture 3c's `/diff` will need.

Confirmed inputs come from todo3 §3. `[V]` inputs use §9.4's suggested defaults,
each stored `confidence='assumed'` with a claim recording that it is a placeholder
pending S4/S5.

### 5.5 Not touched

`packages/shared-types` is **not** updated. No frontend consumes this contract until
3d, and generating types ahead of a consumer is the stale-shadowing failure that
commit `1c4882f` fixed on this branch.

---

## 6. Verification

### Hard gates

1. **Confirmed-only target-year totals.** Year-10 revenue equals `Σ target_revenue`
   by path construction, and year-10 margin equals `margin_target` because
   `φ(n) = 0`. So both totals are functions of confirmed inputs alone, independent of
   every `[V]` value. Post case: `$400bn` / `$158.5bn`. Pre case: `$320bn` / `$151bn`.
   The $320bn figure has independent corroboration in todo3 §3
   (`1250 / 3.91 = 319.7`).

   The pre-case EBIT gate of `$151bn` **depends on resolving todo3's documented
   45%/50% xAI margin discrepancy** (§3 footnote 1) in favour of **45%**: S1's text
   says 50%, S2 restates the same assumption as 45%, and §3's own derived table uses
   45%. This design adopts 45%, seeded with `confidence='derived'` and a claim
   recording the conflict. At 50% the pre-case EBIT gate would be $155bn instead.
   The revenue gates and the entire post case are unaffected.
2. **Trap tests** — todo3 §9.2's six items, plus a divide-by-zero guard the segment
   model introduces:
   - cumulative discount factors — `|df[t] − df[t−1]/(1+w[t])| < 1e-12`
   - `g_stable > riskfree_rate` **raises** (F5)
   - `roic_stable ≤ wacc_stable` with `g > 0` **raises**
   - `sales_to_capital ≤ 0` **raises**
   - `wacc_stable − g_stable` near zero is guarded, and the spread appears in the
     `/run` response
   - `ramp_start_year > 1` contributes **zero** reinvestment before ramp start
   - trap #4 (R&D ↔ reinvestment cross-check) is **deferred with R&D** (§7.2), not
     dropped — recorded here so the slot is not lost
3. **Path invariants.** `Π(1+g_t)` reaches target within `1e-9`; `g_t` monotone
   decreasing; `g_n = g_stable`; `margin_1 = base_margin`; linear ramp reaches
   `revenue_target` exactly at year `n`.
4. **NOL.** Zero tax while the balance survives; once exhausted, cumulative tax
   equals `marginal × (Σ EBIT − nol_balance₀)`.
5. **Bridge identity.** `EV + cash + proceeds − debt` equals
   `calculate_equity_value(EV, net_debt=debt−cash, non_operating_assets=proceeds)`,
   proving the reuse in §3 is an identity and not a coincidence.
6. **Narrative rule.** A POST omitting one narrative row returns 422 naming the field.
7. **Seed idempotency.** Running the seed twice leaves one row per case.
8. **Base revenue reconciliation.** Σ `base_revenue` = `$15.6bn` (±0.05) for both
   seeds, matching todo3 §6's two independent trailing EV/Sales derivations.

### Diagnostic — recorded once, not computed by `/run`

`/run` does not compute or return a comparison against Damodaran's stated `$1.22T` /
`~$100` (and `$1.21T` for the pre case). It returns the model's own figures
(`enterprise_value`, `value_per_share_basic`/`_diluted`, `terminal_value_share_pct`,
`base_revenue_total`, `base_ebit_total`) and nothing else. §5.3 originally proposed
folding the comparison into the endpoint response; that would mean hardcoding
SpaceX's published numbers into a generic valuation engine — exactly the coupling
`segment_narrative` exists to avoid (§7.3), so it was dropped.

The comparison itself still happened, once, by hand, and is recorded in the project
ledger rather than in a test or an endpoint:
`.superpowers/sdd/2026-08-09-segment-buildup-valuation/progress.md` (Task 4):

```
pre  EV=1,002.1bn  $406.22/share  TV share 93.2%   (he reports ~1,210bn, ~$100)
post EV=  916.2bn  $ 75.86/share  TV share 102.4%  (he reports ~1,220bn, ~$100)
```

Per §1.2, agreement would be evidence of nothing while the `[V]` inputs are
uncalibrated, and disagreement is information about those guesses rather than a build
failure. No test asserts agreement or disagreement; the gates in this section are
what the suite actually enforces.

**Base-year reconciliation diagnostic.** `/run` also reports base-year aggregate
revenue and EBIT beside todo3's own figures, because two independent inconsistencies
in the source deserve to be visible in output rather than lost in a comment:

- *Base revenue closes.* §9.4's segment base revenues sum to
  `4.1 + 11.4 + 0.1 + 0 = $15.6bn`, which §6's pricing multiples corroborate twice
  and independently: `1250 / 80.13 = 15.60` and `1750 / 112.18 = 15.60`. This is
  strong enough to gate (§6 gate 8).
- *Base EBIT does not.* Those same §9.4 base margins imply
  `4.1(−0.10) + 11.4(0.02) + 0.1(−0.50) = −$0.23bn`, against §4's reported
  operating loss of **−$2.57bn** and EBITR of **+$4bn**. Nor do §4's own figures
  close with each other: `−2.57 + 9 = 6.43`, not the stated `4`. Three mutually
  inconsistent base-year EBIT figures, so none can be a gate.

  `/run` reports the model's own `base_ebit_total`, and the three conflicting
  source figures are recorded in the seed's `base_margin` narrative claim.
  They belong there rather than in the engine: they are facts about one company,
  and hardcoding SpaceX constants into a generic valuation engine is exactly the
  coupling `segment_narrative` exists to avoid.

### Error handling

Constraint violations **raise `ValueError`** in the engine; the route maps them to
422. Denominators are not epsilon-floored. This follows the stance documented at
`dcf.py:196`: flooring reports "a large finite value at precisely the point where the
honest answer is that there is none."

**Observed pre-existing inconsistency, deliberately not fixed:**
`corporate_dcf.py:157` floors with `max(wacc - terminal_growth, 0.005)`, which is what
`dcf.py` argues against. It is a different code path, it works, and it is outside this
request. Recorded, not changed.

---

## 7. Out of scope

### 7.1 Deferred pieces

Monte Carlo over input distributions, `/fork`, `/diff` attribution, `/pricing`
multiples (3c); the valuation UI tab (3d).

### 7.2 R&D capitalization (todo3 P3/P4/P6)

Deferred, for two independent reasons either of which is sufficient:

**No data.** P4 (`ResearchAsset_t = Σ_{k=0}^{L−1} R&D_{t−k} · (L−k)/L`) needs `L`
years of R&D history. todo3 §4 supplies exactly one (2025 ≈ $9bn, of which AI $5.1bn).
With the default `L = 5` the rollforward would run on four invented years.

**It would double-count.** todo3 P5 reports Damodaran's own base-year figure as
**EBITR** — $4bn for 2025 against a $2.57bn reported operating loss — i.e. the base he
carries into the model is already R&D-adjusted. Applying P3 on top of a base margin
that already reflects the adjustment counts the R&D twice.

Consequence for the contract: `SegmentSpec.base_margin` is documented as the
**R&D-adjusted operating margin**, and `rnd_amort_life` is absent from the schema.
When R&D capitalization is built, it arrives with the P6 cross-check (trap #4) that
asserts capitalized R&D also appears in reinvestment.

### 7.3 Faithful reproduction of Damodaran's valuation

Not achievable in this cycle and not claimed. See §1.2. It becomes achievable if
`SpaceX2026IPO.xlsx` and `SpaceX2026IPOUpdated.xlsx` are placed in the repo, at which
point the `[V]` inputs can be calibrated and the diagnostic promoted to a gate.

---

## 8. Deviations from `guideline/sop/todo3.md`

Collected for review, since todo3 is the source of record.

| todo3 | This design | Why |
| --- | --- | --- |
| §9.1 `growth_curve` column, 3 curves | one decaying curve, column dropped | speculative configurability (§4.2) |
| §9.1 `rnd_amort_life` column | dropped | R&D deferred (§7.2) |
| §9.1 no `roic_stable` | added, required | F6 needs it (§4.2) |
| §9.1 `UNIQUE(ticker, case_name)` | `UNIQUE(case_name)` | NULL ticker defeats the pair (§5.1) |
| §9.1 `ticker TEXT NOT NULL` | nullable | pre-IPO SpaceX has no ticker (§1.1) |
| §9.1 `simulation_input`, `valuation_output` | dropped | 3c; no consumer yet (§5.1) |
| §9.3 `GET /bridge` | folded into `/run` | same computation (§5.3) |
| §9.4 shares in millions | billions | repo convention (§4.3) |
| §9.4 "$1.22T validates `[V]`" | comparison recorded once in the project ledger, not computed by `/run` or gated | too many free parameters (§1.2); hardcoding SpaceX numbers into the engine repeats the coupling `segment_narrative` avoids (§6) |
| §2.2 P3/P4/P6 R&D capitalization | deferred | no data, double-counts (§7.2) |
| §2.2 P2 back-loaded φ | linear φ | back-loading is `[V]` (§4.2) |
| §7 "value only what clears Probable" | stored and reported, not gated | trivially satisfiable gate (§5.2) |
| §9.1 no `terminal_growth` | added, nullable, defaults to `riskfree_rate` | otherwise F5's cap is a tautology (§4.2) |
| §9.4 `base_year=2025, target_year=2036` (n=11) | `base_year=2026` (n=10) | §9.1, §3, R5, P2, R2 all say 10 (§4.2) |
| §4 base-year EBIT (three conflicting figures) | reported as a diagnostic | −$0.23bn / −$2.57bn / +$4bn cannot all hold (§6) |
