# Damodaran's SpaceX Valuation — Formula & Criteria Reference

**Purpose:** Extract the complete valuation architecture Aswath Damodaran used for SpaceX (pre-IPO April 2026 and post-prospectus June 2026), in a form directly implementable in the MoneyView valuation engine.

**Primary sources**
| # | Source | Date | Link |
|---|---|---|---|
| S1 | "To a Trillion(s) Dollars and beyond: A SpaceX IPO Odyssey!" | 2026-04-23 | `aswathdamodaran.blogspot.com/2026/04/to-trillion-dollars-and-beyond-spacex.html` |
| S2 | "Revisiting the SpaceX Valuation: A Post-Prospectus Update!" | 2026-06-04 | `aswathdamodaran.blogspot.com/2026/06/a-weeks-ago-i-assessed-value-of-spacex.html` |
| S3 | YouTube companion video to S2 (`NQKIJU7TmTc`) | 2026-06 | embedded in S2 |
| S4 | Spreadsheet (pre-prospectus) | 2026-04 | `pages.stern.nyu.edu/~adamodar/pc/blog/SpaceX2026IPO.xlsx` |
| S5 | Spreadsheet (post-prospectus, 6/2/26) | 2026-06 | `pages.stern.nyu.edu/~adamodar/pc/blog/SpaceX2026IPOUpdated.xlsx` |
| S6 | SpaceX S-1 prospectus, filed 2026-05-20 (277pp + ~100pp addendum) | 2026-05-20 | SEC EDGAR, CIK 1181412 |

**Confidence tagging used throughout this document**
- `[C]` **Confirmed** — stated explicitly in S1/S2.
- `[D]` **Derived** — arithmetic I performed on confirmed numbers; reproducible, but not stated by Damodaran.
- `[V]` **Convention** — standard Damodaran template behaviour, not stated for SpaceX. **Verify against S4/S5 before hardcoding.**

---

## 1. The model class: segment build-up, target-year DCF

This is **not** a standard "grow revenue at g%, apply margin" DCF. It is Damodaran's *young-company / big-market* template, and the structural choice matters more than any single input.

```
For each business segment i:
    narrative  →  (TAM_i,10 , share_i,10 , margin_i,target , salesToCapital_i)
                  ↓
    target revenue in year 10  →  interpolated revenue path (yrs 1-10)
                  ↓
    margin path (base → target)  →  segment EBIT path
                  ↓
Aggregate across segments  →  consolidated EBIT
                  ↓
    − taxes (NOL-aware)  − reinvestment (ΔRev / sales-to-capital)
                  ↓
    FCFF path  →  discount at time-varying WACC  →  + terminal value
                  ↓
    Enterprise value → + cash + IPO proceeds − debt → Equity → per share
```

**Segments used for SpaceX** `[C]`: (1) Space launch, (2) Connectivity/Starlink, (3) AI/xAI, (4) **Expansion options** — a fourth pseudo-segment used as a crude real-option proxy, with revenues ramping only **after year 6 (2032)**.

**Why segment-level, not consolidated:** the three businesses differ in TAM, competitive structure, unit economics *and* capital intensity. A single blended margin destroys the information that drives the valuation. `[C]`

---

## 2. Complete formula set

### 2.1 Revenue layer

| ID | Formula | Notes | Tag |
|---|---|---|---|
| R1 | `TargetRev_i,10 = TAM_i,10 × MarketShare_i,10` | The single most important equation in the model. TAM is *his* estimate, not the prospectus's. | `[C]` |
| R2 | `CAGR_i = (TargetRev_i,10 / Rev_i,0)^(1/10) − 1` | Implied compound rate; used as a plausibility check, not as the path itself. | `[V]` |
| R3 | Revenue path: growth front-loaded in yrs 1–5, decaying to stable growth by yr 10, constrained to hit `TargetRev_i,10` | In S2 he explicitly **slowed near-term growth** for launch and connectivity — i.e. the path shape is an independent lever from the endpoint. | `[C]` shape change / `[V]` exact interpolation |
| R4 | `Rev_t = Σ_i Rev_i,t` | Consolidated top line. | `[C]` |
| R5 | Expansion-options segment: `Rev_exp,t = 0 for t ≤ 6`, ramping to `$50bn` by t = 10 | Deliberately crude stand-in for optionality. | `[C]` |

**Practical interpolation options for MoneyView** (S4/S5 will show which he actually used):
- *Uniform CAGR* — simplest, but overstates near-term cash and understates back-loading.
- *Linearly decaying growth* — `g_t = g_1 − (g_1 − g_stable)·(t−1)/(n−1)`, then rescale to hit target. Closest to his usual template. `[V]`
- *Logistic / S-curve on market share* — hold TAM growth exogenous, model `share_i,t` as a logistic. Most defensible for a big-market story; this is the one I'd build.

### 2.2 Profitability layer

| ID | Formula | Notes | Tag |
|---|---|---|---|
| P1 | `EBIT_i,t = Rev_i,t × Margin_i,t` | Segment-level. | `[C]` |
| P2 | `Margin_i,t = Margin_i,target − (Margin_i,target − Margin_i,0) × φ(t)`, φ(1)=1, φ(10)=0 | Convergence path from (negative) base margin to target. He typically back-loads φ. | `[V]` |
| P3 | **R&D capitalization:** `AdjEBIT_t = ReportedEBIT_t + R&D_t − Amort(ResearchAsset_t)` | Explicit and load-bearing: he states the space segment's reported operating loss was *entirely* R&D-driven, and that capitalizing it produces a healthy margin. | `[C]` principle / `[V]` amortizable life |
| P4 | `ResearchAsset_t = Σ_{k=0}^{L−1} R&D_{t−k} × (L−k)/L` | Straight-line unamortized research asset over life `L`. | `[V]` |
| P5 | `EBITR = EBIT + R&D` (before interest, taxes, R&D) | He reports **$4bn EBITR for 2025** vs a **$2.57bn reported operating loss**. | `[C]` |
| P6 | Capitalized R&D must also be **added to reinvestment** | Otherwise you double-count the benefit. Non-negotiable consistency rule. | `[V]` (his standing rule) |

### 2.3 Reinvestment layer

| ID | Formula | Notes | Tag |
|---|---|---|---|
| I1 | `Reinvestment_i,t = (Rev_i,t − Rev_i,t−1) / SalesToCapital_i,t` | The *only* reinvestment mechanism. No separate capex/D&A/ΔWC schedule. | `[C]` |
| I2 | Lower `SalesToCapital` ⇒ more capital needed per dollar of new revenue | In S2 he **lowered** sales-to-capital for yrs 1–5 (launch + connectivity) after seeing actual capex, and again for AI. | `[C]` |
| I3 | `ROIC_t = EBIT_t(1−τ) / InvestedCapital_t`, `InvestedCapital_t = IC_{t−1} + Reinvestment_t` | Sanity/quality check; also feeds the terminal reinvestment rate. | `[V]` |

### 2.4 Cash flow, discounting, terminal value

| ID | Formula | Notes | Tag |
|---|---|---|---|
| F1 | `FCFF_t = EBIT_t × (1 − τ_t) − Reinvestment_t` | Firm-level FCFF (not FCFE). | `[C]` |
| F2 | `τ_t`: 0 while NOLs remain, converging to marginal rate | SpaceX had large accumulated losses; NOL shield materially shifts early-year cash flow. | `[V]` — marginal rate & NOL balance must come from S5/S6 |
| F3 | `WACC_t`: **8.37%** at t=1 → **8.25%** in stable growth | S1 used 8.02% → 8.00% (riskfree 4.20%). S2 raised both because the 10Y UST moved to **4.56%**. Both are ≈ US median WACC. | `[C]` |
| F4 | `DF_t = Π_{s=1}^{t} 1 / (1 + WACC_s)` | **Cumulated**, not `(1+WACC)^t` — required because WACC is time-varying. Common implementation bug. | `[V]` |
| F5 | `g_stable = riskfree rate = 4.56%` | Damodaran's hard cap: perpetual growth ≤ riskfree rate. | `[C]` (rf) / `[V]` (cap rule) |
| F6 | `ReinvRate_stable = g_stable / ROIC_stable` | Terminal reinvestment must be internally consistent with terminal growth. | `[V]` |
| F7 | `FCFF_11 = EBIT_11 × (1 − τ_marginal) × (1 − g/ROIC_stable)` | | `[V]` |
| F8 | `TV_10 = FCFF_11 / (WACC_stable − g_stable)` | With 8.25% and 4.56%, the spread is **3.69%** — TV is extremely spread-sensitive. Run a sensitivity grid. | `[C]` inputs |
| F9 | `EV = Σ_{t=1}^{10} FCFF_t × DF_t + TV_10 × DF_10` | | `[C]` |

### 2.5 Equity bridge

| ID | Formula | Value (post-prospectus) | Tag |
|---|---|---|---|
| E1 | `Equity = EV + Cash + IPOProceeds − Debt` | `1,220 + 24.7 + 75.0 − 22.9 ≈ $1,297bn` → he reports **$1.3T** | `[C]` inputs, `[D]` arithmetic |
| E2 | Net debt = `22.9 − 24.7 = −$1.9bn` | Cash exceeds debt; debt is rounding error at this scale. | `[C]` |
| E3 | IPO proceeds are held as cash → **add to firm value, not enterprise value** | Prospectus p.66: proceeds earmarked for infrastructure, not retiring debt. | `[C]` |
| E4 | `ValuePerShare = Equity / (SharesOutstanding + NewSharesIssued)` | `1,297 / 12,535 = $103.5`; with ~556m new shares at $135 → `1,297 / 13,091 = $99.1` ≈ his stated **~$100** | `[C]` share count 12,535m; `[D]` new-share reconciliation |
| E5 | RSUs excluded from the 12,535m count (prospectus p.18, redacted) | He explicitly flags this as unresolved downward pressure on per-share value. | `[C]` |

---

## 3. Input table — pre- vs post-prospectus

All figures for **target year 2036 (year 10)** unless noted.

| Segment | Input | April 2026 (S1) | June 2026 (S2) | Direction | Driver of change |
|---|---|---|---|---|---|
| **Launch** | TAM 2036 | $100bn (from $30bn in 2026) | unchanged — rejects prospectus TAM | → | Prospectus TAM judged an over-reach |
| | Market share | 70% (down from >80% in 2025) | unchanged | → | Nationalistic/security-driven competitors |
| | Target op. margin | 40% | **45%** | ▲ | 67% gross margin; reported loss was pure R&D |
| | Near-term growth | — | **slowed** | ▼ | Actual 2025 launch growth only **7.64%** |
| | Sales-to-capital yrs 1–5 | — | **lowered** | ▼ | $14bn 2025 capex |
| **Connectivity (Starlink)** | TAM 2036 | $160bn (from $15bn; 1% → 10% of ~$1.5T internet market) | unchanged | → | |
| | Market share | 75% | unchanged | → | Satellite lead + captive launch capability |
| | Target op. margin | 60% | **60%** (unchanged) | → | Best scale economics once satellites are up |
| | Near-term growth | — | slowed | ▼ | ARPU decay (see §4) |
| | Sales-to-capital yrs 1–5 | — | lowered | ▼ | |
| **AI (xAI)** | Target revenue 2036 | $80bn | **$160bn** | ▲▲ | Cursor acquisition + enterprise intent; his AI TAM = **$3–4T**, vs prospectus **$26T** |
| | Target op. margin | 50% (S1 text) / 45% (S2 restatement)¹ | **25%** | ▼▼ | Lowest and *deteriorating* gross margins; LLM competition |
| | Sales-to-capital | already low | **lower still** | ▼ | $14bn+ reinvestment in AI alone in 2025 |
| **Expansion options** | Target revenue 2036 | $50bn | assumed unchanged `[V]` | → | Ramps only after yr 6 (2032) |
| | Target op. margin | 30% | assumed unchanged `[V]` | → | |
| **Firm-level** | Riskfree rate | 4.20% | **4.56%** | ▲ | 10Y UST move |
| | WACC (initial) | 8.02% | **8.37%** | ▲ | |
| | WACC (stable) | 8.00% | **8.25%** | ▲ | |
| | Cash | ignored | **$24.7bn** | — | From prospectus |
| | Debt (incl. leases) | ignored | **$22.9bn** | — | From prospectus |
| | Book equity | $20bn (guess) | **$41.3bn** | ▲ | xAI acquisition |
| | Share count | 2,467m (backed out) | **12,535m** basic | ▲▲ | Prospectus pp. 246–247 |
| | IPO proceeds | n/a | **$75bn** | — | Held as cash |

¹ **Documented inconsistency:** S1 states a 50% xAI operating margin; S2, restating the same pre-prospectus assumption, says the margin "drops from 45% to 25%." Treat 45% as the value actually in S4 and 50% as a text error — but confirm in the spreadsheet before encoding.

### The offsetting-changes insight `[D]`

Target-year revenue and EBIT, computed from the table above:

| | Pre-prospectus | Post-prospectus |
|---|---|---|
| Launch | 100 × 70% = **$70bn** @ 40% → $28.0bn EBIT | $70bn @ 45% → **$31.5bn** |
| Connectivity | 160 × 75% = **$120bn** @ 60% → $72.0bn | $120bn @ 60% → **$72.0bn** |
| AI | **$80bn** @ 45% → $36.0bn | **$160bn** @ 25% → **$40.0bn** |
| Expansion | **$50bn** @ 30% → $15.0bn | $50bn @ 30% → **$15.0bn** |
| **Total revenue 2036** | **$320bn** | **$400bn** |
| **Total EBIT 2036** | **$151bn** | **$158.5bn** |

The $320bn figure is independently confirmed: S1 quotes a forward EV/Sales of **3.91×** at a $1.25T price, and `1,250 / 3.91 = $320bn`.

**This is why the enterprise value barely moved ($1.21T → $1.22T despite a 277-page prospectus.)** The AI revenue doubling and the launch margin uplift were almost exactly cancelled by the AI margin collapse, the slower near-term growth, the heavier reinvestment, and the higher discount rate. Worth internalizing: in a big-market model, *net* value change is a small difference between large opposing revisions — which is exactly why you must model inputs independently rather than tuning a single "growth" dial.

---

## 4. Unit-economics evidence layer (the "footnote" inputs)

Damodaran's explicit claim in S2: **for young companies the value-relevant information is in the footnotes, not the financial statements.** These are the metrics he actually used to move his inputs.

| Metric | Value | Where it entered the model |
|---|---|---|
| Total revenue growth 2025 | **+33%** | Path calibration |
| Launch revenue growth 2025 | **+7.64%** | ▼ near-term launch growth |
| Connectivity revenue growth 2025 | **~+50%** | Confirms Starlink as the near-term engine |
| AI revenue growth 2025 | **~+22%** | Below his implied path |
| Launch gross margin | **~67%** | ▲ target margin 40% → 45% |
| Connectivity gross margin | **37% (2024) → 48% (2025)** | Holds 60% target |
| AI gross margin | lowest of three, **deteriorating** | ▼ target margin → 25% |
| Starlink ARPU | **$99/mo (2024) → $66/mo (Q1 2026)** | Price/mix headwind |
| Starlink subscribers | **5.0m (Q1 25) → 10.3m (Q1 26)** | Volume more than offsets ARPU decay |
| Colossus datacenter lease to Anthropic | **$1.25bn/month** | Near-term AI revenue + margin support; flagged as a future conflict risk if xAI competes head-on |
| 2025 capex | **~$14bn** | ▼ sales-to-capital |
| 2025 R&D | **~$9bn** | R&D capitalization |
| AI-only 2025 reinvestment | **$14.2bn** ($9.1bn capex + $5.1bn R&D) | ▼ AI sales-to-capital |
| 2025 reported operating loss | **−$2.57bn** (his estimate was −$2.0bn) | Base-year margin |
| 2025 interest expense | **~$2bn** | Net loss ~$5bn |
| 2025 EBITR | **+$4bn** | Demonstrates the R&D reclassification |

**TAM rejection — a documented criterion.** The prospectus claims a **$28T total TAM, $26T of it AI**. He rejects it and substitutes **$3–4T** for enterprise AI products/services, with the precedents cited explicitly: Uber's 2019 prospectus claimed $5.7T; Airbnb's 2020 claimed $3.4T. His stated inference is that the $26bn figure likely counts *all operating expenses of all businesses*. **Rule: prospectus TAM is a marketing artifact and is never an input.**

---

## 5. How he actually handled uncertainty (correcting a common assumption)

Your brief described "scenario-based probabilities such as the success of Mars colonization." That is **not** what he did here, and the distinction matters for how you build MoneyView.

**What he explicitly excluded** `[C]`: Mars, space tourism/travel, and expanded in-space business opportunities are *deliberately omitted* — he calls this "being conservative" and says he doesn't currently see a viable revenue path. There is no Mars probability node anywhere in the model.

**What he actually used:**

| Technique | Used for SpaceX? | Implementation |
|---|---|---|
| **Monte Carlo simulation** | ✅ **Yes** — the primary uncertainty tool | 10,000 runs over distributions for TAM, market share, target margin, sales-to-capital. **Median $1.29T** vs base case $1.22T (S1 run). He notes $1.75–2.0T *is inside the distribution*, but with no upside left at that price. |
| **Real-option proxy** | ✅ Yes, but crudely | The "expansion options" segment: `$50bn` revenue @ 30% margin, ramping only after year 6. He calls this a "crude attempt" — not a Black-Scholes option valuation. |
| **Discrete scenario trees** | ❌ No | He uses these elsewhere (biotech/pharma phase trials). |
| **Probability-of-failure adjustment** | ❌ **No** | The classic `E[V] = V_going_concern × (1−p_fail) + V_distress × p_fail` was **not** applied. Reason: SpaceX is revenue-generating with $24.7bn cash — not a going-concern risk. Build the hook; leave it at p=0 here. |
| **Risk premium in WACC** | ⚠️ Deliberately *not* inflated | **This is the most counter-intuitive and most important methodological point.** WACC is only **8.37%** — near the US median — for a company most would call extreme-risk. His stated reasoning: most SpaceX risk is **firm-specific** (diversifiable in a portfolio), it is **two-sided** (upside as well as downside), and the outliers are more likely on the upside. |

**Design implication for MoneyView:** do not let users "punish" a risky company by inflating the discount rate. That is double-counting if the risk is already in the cash-flow distribution. Route uncertainty into input *distributions* and simulation, and keep WACC anchored to business-mix betas.

---

## 6. Intrinsic value vs. pricing — the diagnostic layer

He treats these as **two different games with different rules**, and refuses to blend them.

| | Valuation (intrinsic) | Pricing (relative) |
|---|---|---|
| Question | What are the cash flows worth? | What will someone pay? |
| Drivers | Revenue, margin, reinvestment, risk | Mood, momentum, peer multiples |
| Uncertainty | **Explicit** — you must state your numbers | **Implicit** — hidden in the multiple |
| Output | $1.25–1.35T equity, ~$100/share | $1.8T IPO price, $135/share |

**Pricing metrics he computed** `[C]`:

| Metric | At $1.25T (private) | At $1.75T (IPO) |
|---|---|---|
| EV/Sales, trailing 2025 | **80.13×** (he also cites ~81×) | **112.18×** |
| EV/EBITDA, trailing 2025 | **156×** | — |
| EV/Sales, forward (target-year $320bn revenue) | **3.91×** | **5.47×** |

He documents the **forward-multiple bias mechanism** as an explicit red flag: bullish analysts who cannot justify a price on trailing numbers migrate to forward multiples, then inflate the forward revenue. The defense is a rule: *if you use forward multiples, use the same forward year for every peer.*

**The peer-group problem** `[C]`: no true comparable exists. Aerospace/defense (Boeing, Northrop) are low-growth/low-margin; telecom (Verizon, T-Mobile) have different unit economics; Palantir has no infrastructure intensity; LLM peers are private with VC-round marks. His conclusion: pricing does not *remove* the assumptions, it only *hides* them.

**The bottom line and the gap:**

| | Value |
|---|---|
| Damodaran's equity value | **$1.25–1.35T** (~$100/share) |
| IPO offer price | **$135/share ≈ $1.8T** |
| Implied overvaluation | **~28%** |
| His action | Will not buy at IPO; **will not short either** — momentum risk in a Musk vehicle is asymmetric |

He is explicit that this is a point of view, not a proof: *"if you contend that it is worth $3 trillion or only half a trillion, it is neither my job nor my place to convince you that I am right."*

---

## 7. The narrative-to-number bridge, formalized

Every numeric input traces to exactly one narrative claim. That's the whole discipline. Concretely, for SpaceX:

| Narrative claim | Input it constrains | Value |
|---|---|---|
| "The launch market grows from $30bn to $100bn as government and private demand rises" | `TAM_launch,2036` | $100bn |
| "SpaceX stays dominant but sheds share to security/nationalism-driven entrants" | `share_launch` | 70% |
| "Reusability + existing infrastructure produce a durable cost advantage; costs fall with scale" | `margin_launch` | 45% |
| "Satellite internet goes from 1% to 10% of a $1.5T internet market" | `TAM_conn,2036` | $160bn |
| "Starlink's satellite lead plus captive launch capacity is defensible" | `share_conn` | 75% |
| "Once satellites are in orbit, incremental subscribers are nearly pure margin; CAC eases as business mix rises" | `margin_conn` | 60% |
| "xAI wants enterprise (Cursor acquisition) against a $3–4T real AI TAM" | `TargetRev_AI` | $160bn |
| "LLM competition and delivery costs persist" | `margin_AI` | 25% |
| "SpaceX is very capital-intensive, and AI is the most capital-hungry of the three" | `salesToCapital_i` | ▼ all segments |
| "Risk is firm-specific and two-sided, not systematic" | `WACC` | 8.37% → 8.25% |

**His 3P test** (apply before accepting any narrative): is the story **Possible** (physically/legally feasible) → **Plausible** (a credible pathway exists) → **Probable** (you can attach numbers with a straight face)? Value only what clears *Probable*. Mars sits at Possible/Plausible — hence its exclusion.

**Corollary criterion** `[C]`: he explicitly rejects screening SpaceX out on "money-losing / negative FCF / >100× sales" grounds, calling that reasoning "lazy and unconvincing." The *legitimate* bear cases are: (a) TAM smaller than assumed, (b) competition compresses margins, (c) governance — Musk's ~85% voting control via 5,602m ten-vote Class B shares means shareholders cannot restrain over-investment in AI. **His single biggest stated risk: over-reach in AI**, funded by a controlling founder that no one can vote down.

---

## 8. Life-cycle disclosure map — a reusable MoneyView rule

The generalizable lesson from S2, worth encoding as a configuration table:

| Life-cycle stage | What drives value | Where the information lives | Which metrics are misleading |
|---|---|---|---|
| **Start-up / Young growth** | Total market size, unit economics, capital intensity | **Footnotes, MD&A, operating KPIs** (ARPU, subs, gross margin by segment, capex mix) | Net income, ROE/ROIC, EPS, P/E, FCF — all structurally negative *by design* |
| **High growth** | Market share trajectory, margin convergence, reinvestment efficiency | Segment income statements, cohort data | Trailing multiples |
| **Mature** | Margin sustainability, ROIC vs WACC, payout | Financial statements proper | Growth extrapolation |
| **Decline** | Asset liquidation value, cash return discipline | Balance sheet | Growth narratives |

MoneyView implication: **the metric panel should be stage-conditional.** Showing P/E and ROIC as headline "quality" indicators for a stage-1 company is actively misleading — which is exactly the failure mode Damodaran calls out in S2.

---

## 9. MoneyView implementation spec

Designed as an **extension of the existing DCF/Monte Carlo engine**, not a parallel system. The new work is a *segment build-up front-end* that produces a consolidated `(Revenue, EBIT)` path; everything downstream reuses what's already there.

### 9.1 Schema (SQLite)

```sql
CREATE TABLE valuation_case (
    id                INTEGER PRIMARY KEY,
    ticker            TEXT NOT NULL,
    case_name         TEXT NOT NULL,          -- 'spacex_2026_06_post_prospectus'
    as_of_date        TEXT NOT NULL,
    base_year         INTEGER NOT NULL,
    target_year       INTEGER NOT NULL,       -- base_year + 10
    riskfree_rate     REAL NOT NULL,          -- 0.0456
    wacc_initial      REAL NOT NULL,          -- 0.0837
    wacc_stable       REAL NOT NULL,          -- 0.0825
    wacc_converge_from INTEGER DEFAULT 6,     -- year WACC starts converging
    marginal_tax_rate REAL NOT NULL,
    nol_balance       REAL DEFAULT 0,
    rnd_amort_life    INTEGER DEFAULT 5,      -- R&D capitalization life
    cash              REAL, debt REAL, ipo_proceeds REAL,
    shares_basic      REAL, shares_new REAL,
    parent_case_id    INTEGER REFERENCES valuation_case(id),  -- lineage: pre → post
    UNIQUE(ticker, case_name)
);

CREATE TABLE segment (
    id                INTEGER PRIMARY KEY,
    case_id           INTEGER NOT NULL REFERENCES valuation_case(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,          -- 'launch' | 'connectivity' | 'ai' | 'expansion'
    base_revenue      REAL NOT NULL,
    base_margin       REAL NOT NULL,
    tam_target         REAL,                  -- NULL for 'expansion' (revenue set directly)
    market_share_target REAL,
    revenue_target    REAL,                   -- if set, overrides tam × share
    margin_target     REAL NOT NULL,
    sales_to_capital_early REAL NOT NULL,     -- years 1..5
    sales_to_capital_late  REAL NOT NULL,     -- years 6..10
    ramp_start_year   INTEGER DEFAULT 1,      -- 7 for 'expansion'
    growth_curve      TEXT DEFAULT 'decaying' -- 'uniform'|'decaying'|'logistic'
);

CREATE TABLE segment_narrative (
    segment_id        INTEGER NOT NULL REFERENCES segment(id) ON DELETE CASCADE,
    input_field       TEXT NOT NULL,          -- 'tam_target', 'margin_target', ...
    claim             TEXT NOT NULL,          -- the sentence justifying the number
    evidence_source   TEXT,                   -- 'S-1 p.90' | 'company KPI' | 'own estimate'
    confidence        TEXT CHECK(confidence IN ('confirmed','derived','assumed')),
    three_p           TEXT CHECK(three_p IN ('possible','plausible','probable')),
    PRIMARY KEY (segment_id, input_field)
);

CREATE TABLE simulation_input (        -- Monte Carlo distributions
    segment_id        INTEGER REFERENCES segment(id) ON DELETE CASCADE,
    input_field       TEXT NOT NULL,
    dist_type         TEXT NOT NULL,          -- 'triangular'|'normal'|'lognormal'|'uniform'
    p1 REAL, p2 REAL, p3 REAL,
    PRIMARY KEY (segment_id, input_field)
);

CREATE TABLE valuation_output (
    case_id           INTEGER REFERENCES valuation_case(id) ON DELETE CASCADE,
    run_at            TEXT NOT NULL,
    pv_explicit       REAL, pv_terminal REAL,
    enterprise_value  REAL, equity_value REAL, value_per_share REAL,
    mc_median REAL, mc_p10 REAL, mc_p90 REAL, mc_runs INTEGER,
    PRIMARY KEY (case_id, run_at)
);
```

`segment_narrative` is the **narrative-to-number bridge as a schema constraint**: enforce at the service layer that every non-null numeric input on `segment` has a corresponding row. That single rule is what separates this from a generic DCF calculator, and it's the differentiator worth demoing.

### 9.2 Engine contract (Python)

```python
@dataclass(frozen=True)
class SegmentSpec:
    name: str
    base_revenue: float
    base_margin: float
    margin_target: float
    sales_to_capital_early: float
    sales_to_capital_late: float
    tam_target: float | None = None
    market_share_target: float | None = None
    revenue_target: float | None = None
    ramp_start_year: int = 1
    growth_curve: str = "decaying"

    def target_revenue(self) -> float:
        if self.revenue_target is not None:
            return self.revenue_target
        if self.tam_target is None or self.market_share_target is None:
            raise ValueError(f"{self.name}: need (tam × share) or explicit revenue_target")
        return self.tam_target * self.market_share_target      # R1

def revenue_path(spec, n=10)      -> list[float]: ...          # R3
def margin_path(spec, n=10)       -> list[float]: ...          # P2
def reinvestment(revs, spec)      -> list[float]: ...          # I1
def tax_path(ebit, marginal, nol) -> list[float]: ...          # F2
def wacc_path(w0, w_stable, n, converge_from=6) -> list[float]  # F3
def discount_factors(waccs)       -> list[float]: ...          # F4  cumulative product
def terminal_value(ebit_n, tau, g, roic_stable, wacc_stable)    # F6-F8
def equity_bridge(ev, cash, debt, proceeds, shares_basic, shares_new)  # E1, E4
```

**Implementation traps to guard in tests:**
1. `discount_factors` must be a **cumulative product** (F4), not `(1+w)^t`. Assert `abs(df[t] - df[t-1]/(1+w[t])) < 1e-12`.
2. Enforce `g_stable ≤ riskfree_rate` (F5) — raise, don't warn.
3. Enforce `ROIC_stable > WACC_stable` when `g > 0`, otherwise terminal value implies value-destroying growth.
4. If R&D is capitalized (P3), it **must** appear in reinvestment (P6). Add a cross-check assertion.
5. Guard `WACC_stable − g` against approaching zero; expose the spread (here 3.69%) directly in the UI.
6. Expansion segments with `ramp_start_year > 1` must contribute **zero** reinvestment before ramp start, or you'll book capital against revenue that doesn't exist yet.

### 9.3 API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/valuation/cases` | Create a case with segments + narratives |
| `POST` | `/valuation/cases/{id}/run` | Deterministic DCF → `valuation_output` |
| `POST` | `/valuation/cases/{id}/simulate` | Monte Carlo (n runs) → percentile distribution |
| `GET` | `/valuation/cases/{id}/bridge` | EV → equity → per-share waterfall (E1–E4) |
| `POST` | `/valuation/cases/{id}/fork` | Clone as child case (pre → post-prospectus lineage) |
| `GET` | `/valuation/cases/{a}/diff/{b}` | **Input-level attribution:** decompose Δvalue by input |
| `GET` | `/valuation/cases/{id}/pricing` | Trailing & forward EV/Sales, EV/EBITDA vs market price |

The `diff` endpoint is the one that earns its keep. §3's offsetting-changes finding — AI revenue doubling cancelled by AI margin collapse — is invisible in a headline number and obvious in an attribution waterfall. Reuse the Brinson-Fachler attribution pattern already in MoneyView: same decomposition logic, different factor set.

### 9.4 Suggested defaults for the SpaceX reference case (post-prospectus)

```python
CASE = dict(base_year=2025, target_year=2036, riskfree_rate=0.0456,
            wacc_initial=0.0837, wacc_stable=0.0825,
            cash=24.7, debt=22.9, ipo_proceeds=75.0,
            shares_basic=12_535, shares_new=556)          # $bn, millions of shares

SEGMENTS = [
  SegmentSpec("launch",       base_revenue=4.1,  base_margin=-0.10,  # base margin [V]
              tam_target=100.0, market_share_target=0.70, margin_target=0.45,
              sales_to_capital_early=1.0, sales_to_capital_late=1.5),   # [V]
  SegmentSpec("connectivity", base_revenue=11.4, base_margin=0.02,
              tam_target=160.0, market_share_target=0.75, margin_target=0.60,
              sales_to_capital_early=1.0, sales_to_capital_late=1.5),   # [V]
  SegmentSpec("ai",           base_revenue=0.1,  base_margin=-0.50,
              revenue_target=160.0, margin_target=0.25,
              sales_to_capital_early=0.6, sales_to_capital_late=1.0),   # [V]
  SegmentSpec("expansion",    base_revenue=0.0,  base_margin=0.0,
              revenue_target=50.0, margin_target=0.30, ramp_start_year=7,
              sales_to_capital_early=1.0, sales_to_capital_late=1.5),   # [V]
]
```

Everything tagged `[V]` above — base margins, all sales-to-capital ratios, the marginal tax rate, and the exact interpolation shape — is **not in the blog posts**. Calibrate against `SpaceX2026IPOUpdated.xlsx` (S5) before treating the engine as a faithful reproduction. If your build reproduces EV = $1.22T and value/share ≈ $100 from the confirmed inputs, the `[V]` assumptions are validated; if not, they're where the error is.

---

## 10. Limitations of this document

1. **No video transcript.** YouTube blocked automated retrieval, so this reconstructs the video's content from S2, which the video accompanies directly. Anything Damodaran said only verbally — particularly spreadsheet walkthroughs — is not captured here.
2. **No spreadsheet access.** Cell-level formulas, the exact revenue/margin interpolation, base-year segment margins, sales-to-capital values, tax rates and NOL balances live in S4/S5 and are marked `[V]` throughout. These are the highest-value remaining gaps.
3. **Post-cutoff events.** SpaceX's IPO (Nasdaq, 2026-06-12, $135/share) and subsequent trading are outside my reliable knowledge; figures here come from the sources listed and current search results. Prices and any post-IPO revisions by Damodaran should be re-verified.
4. **The 45%/50% xAI margin discrepancy** (§3, footnote 1) is unresolved between S1 and S2.
5. This is a methodology reference for building a valuation tool. It documents one analyst's framework and his stated conclusions; it isn't investment advice, and I'm not a licensed advisor.