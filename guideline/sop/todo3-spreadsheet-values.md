# todo3 Ground Truth: Values Read from Damodaran's Spreadsheets

**Date:** 2026-08-11
**Status:** Confirmed. Supersedes every `[V]` tag in `todo3.md`.

`todo3.md` line 436 says: *"Everything tagged `[V]` above ... is **not in the blog
posts**. Calibrate against `SpaceX2026IPOUpdated.xlsx` (S5) before treating the
engine as a faithful reproduction."* Line 443 calls the missing spreadsheet
access "the highest-value remaining gaps."

Both spreadsheets were retrieved and read on 2026-08-11:

| Ref | File | Valuation date | URL |
| --- | --- | --- | --- |
| S4 | `SpaceX2026IPO.xlsx` | 2026-04-01 | `pages.stern.nyu.edu/~adamodar/pc/blog/SpaceX2026IPO.xlsx` |
| S5 | `SpaceX2026IPOUpdated.xlsx` | 2026-06-01 | `pages.stern.nyu.edu/~adamodar/pc/blog/SpaceX2026IPOUpdated.xlsx` |

Both are Damodaran's `fcffsimpleginzu` template with the single revenue row
expanded into four segment rows. Values below are read from the `Input sheet`
and `Valuation output` tabs. **These are not reconstructions.**

---

## 1. Headline outputs

| | S4 (pre) | S5 (post) |
| --- | ---: | ---: |
| Value of operating assets (EV) | 1,216,061.16 | 1,224,448.01 |
| Value of equity | 1,216,061.16 | 1,301,299.01 |
| Number of shares | 2,416.67 | 13,301.95 |
| Value per share | 503.20 | 97.83 |

**EV rises pre → post by +0.69%** (+8,386.85). Value per share falls 81% for one
reason only: the share count rises 5.5×, because S4 was written before the
prospectus disclosed the real count and before the IPO proceeds were known.

## 2. Confirmed inputs

Units are $ millions. Rows marked — have no entry in that workbook.

### Base year

| | S4 this / last | S5 this / last |
| --- | --- | --- |
| Revenues (Launch) | 4,100 / 3,500 | 4,086 / 3,796 |
| Revenues (Starlink) | 11,400 / 8,000 | 11,387 / 7,599 |
| Revenues (xAI) | 100 / — | 3,201 / 2,620 |
| Revenues (Other) | no base row | no base row |
| **Total revenues** | **15,600** | **18,674** |
| Operating income (EBIT), as reported | −2,000 | −2,589 |
| EBIT after R&D capitalization | −316.8 | 4,020.2 |
| Interest expense | 0 | 1,945 |
| Book value of equity | 20,000 | 41,325 |
| Book value of debt | 0 | 22,896 |
| Cash and marketable securities | 0 | 24,747 |
| Expected IPO proceeds | 0 | 75,000 |
| Shares outstanding | 2,416.667 | 12,535.3 |
| Current price | 600 | 135 |
| Effective tax rate | 0.10 | 0.10 |
| Marginal tax rate | 0.25 | 0.25 |
| Capitalize R&D? | **Yes** | **Yes** |
| Capitalize operating leases? | No | No |

### Base-year operating margins

Read from `Valuation output` column B, rows 8–11. Both workbooks:

| Segment | Base margin |
| --- | ---: |
| Launch | 0.08 |
| Starlink | 0.10 |
| xAI | −0.05 |
| Other | 0.00 |

### Year-10 (2036) targets

| Segment | S4 revenue | S4 margin | S5 revenue | S5 margin |
| --- | ---: | ---: | ---: | ---: |
| Launch | 70,000 | 0.40 | 40,000 | 0.45 |
| Starlink | 120,000 | 0.60 | 120,000 | 0.60 |
| xAI | 80,000 | **0.50** | 160,000 | 0.25 |
| Other | 50,000 | 0.30 | 100,000 | 0.30 |
| **Total** | **320,000** | | **420,000** | |
| **Year-10 EBIT** | **155,000** | | **160,000** | |

`todo3.md` footnote ¹ instructed: *"Treat 45% as the value actually in S4 and 50%
as a text error — but confirm in the spreadsheet before encoding."* **Confirmed
false.** S4 cell `Input sheet!B32` is `0.5`. The blog text was right; the
footnote's guess was wrong.

Year of convergence: 10 in both.

### Sales-to-capital ratios

| Segment | S4 yrs 1–5 | S4 yrs 6–10 | S5 yrs 1–5 | S5 yrs 6–10 |
| --- | ---: | ---: | ---: | ---: |
| Launch | 4 | **2** | 3 | **4** |
| Starlink | 10 | **5** | 3 | **5** |
| xAI | 2.5 | **1.5** | 1.5 | **2.5** |
| Other | 3 | 3 | 5 | 5 |

The within-case slope **reverses** between the two workbooks. In S4 the late
ratio is at or below the early one — capital intensity rises as the company
scales. In S5 the late ratio is at or above the early one — capital intensity
falls. This is the single largest structural change between the two valuations,
and no blog post mentions it.

### Market and terminal inputs

| | S4 | S5 |
| --- | ---: | ---: |
| Riskfree rate | 0.042 | 0.0456 |
| Initial cost of capital | 0.080246 | 0.083745 |
| Terminal cost of capital (override) | 0.0800 | 0.0825 |
| **Terminal return on capital (override)** | **0.15** | **0.15** |
| Terminal growth | = riskfree (0.042) | = riskfree (0.0456) |
| NOL carried into year 1 | 0 | 0 |
| Probability of failure | 0 | 0 |

The NOL override cell is `No` in both workbooks, so the `250` sitting in `B66` is
inert template text, not an input.

---

## 3. The interpolation shape

This is the `[V]` gap `todo3.md` line 443 called highest-value. S5 applies one
uniform rule to all four segments.

### Revenue

A **two-block gap-closing** scheme, not a growth-rate curve. Growth rates are an
*output* (`Valuation output` row 2 is labelled "Imputed Revenue growth rate").

1. The year-5 waypoint sits one third of the way from base to target:

   `R₅ = R₀ + (R₁₀ − R₀) / 3`

2. Within each five-year block, each year closes a fixed fraction of the
   *remaining* gap to that block's endpoint — the same vector in both blocks:

   `f = [0.2, 0.3, 0.4, 0.5, 1.0]`

   `Rₜ = Rₜ₋₁ + (R_endpoint − Rₜ₋₁) · f[t]`

3. Terminal revenue: `R₁₁ = R₁₀ · (1 + g)`.

Consequence: exactly one third of total base→target revenue growth lands in
years 1–5 and two thirds in years 6–10, so the imputed growth rate **jumps
upward at year 6** (S5 total: 16.5% in year 5, 50.5% in year 6). The curve is not
monotonically decaying.

The zero-base segment ("Other") is separate: zero through year 5, then linear
from 0 to target across years 6–10, anchored on the absolute year-5 cell.

### Everything else

| Quantity | Rule |
| --- | --- |
| Operating margin | Linear from base to target over `year_of_convergence` years; flat after. `mₜ = target − ((target − base)/Y)·(Y − t)` |
| Tax rate | Flat at the effective rate for years 1–5, then linear to the marginal rate across years 6–10 |
| Cost of capital | Flat at initial for years 1–5, then linear to terminal across years 6–10 |
| Discount factor | Cumulative product of `1/(1+WACCₜ)` |
| Reinvestment | Per segment, `(Revₜ − Revₜ₋₁) / s2c_block` |
| Invested capital | `ICₜ = ICₜ₋₁ + reinvestmentₜ`, seeded at BV equity + BV debt − cash + capitalized R&D |
| ROIC | `EBIT(1−t)ₜ / ICₜ` |
| Terminal reinvestment | `(g / ROIC_terminal) · EBIT(1−t)_terminal` |
| Terminal value | `FCFF_terminal / (WACC_terminal − g)`, discounted at the year-10 cumulative factor |
| Share count | `base shares + IPO proceeds / value per share` — **circular**, solved by Excel iteration |

---

## 3a. S4 contains a formula error

`SpaceX2026IPO.xlsx`, `Valuation output` row 15 — launch's reinvestment:

| Cell | Formula | Reads |
| --- | --- | --- |
| `C15` (year 1) | `=(C3-B3)/C49` | row 3, launch revenue — **correct** |
| `D15`–`L15` (years 2–10) | `=(D7-C7)/D49` … | **row 7, TOTAL revenue** |

Every year after the first divides the change in *consolidated* revenue by
*launch's* sales-to-capital ratio. S5's row 15 reads row 3 in all ten columns,
so the error was fixed between the two workbooks.

Verified two ways: the buggy formula reproduces S4's stored values exactly in
all ten columns, and the correct one reproduces only year 1.

| | Launch reinvestment, 10-year total |
| --- | ---: |
| S4 as computed | 119,682.5 |
| Correct | 24,712.5 |

Nearly 5× overstated. That suppresses FCFF across the explicit period and holds
S4's enterprise value down. Discounting the excess at S4's flat 8% cost of
capital accounts for 54.7 of enterprise value — which is the entire gap between
this engine's corrected pre-case figure and the published one.

**Consequence for the headline finding.** As published, enterprise value rises
1,216,061 → 1,224,448 (+0.69%), and `todo3.md` line 158 builds its central
lesson on that: *"This is why the enterprise value barely moved."* Correct the
error and the April valuation is ≈1,270,800, so enterprise value **falls about
3.6%** across the prospectus. The near-cancellation is real at the target-year
EBIT level (155.0 → 160.0, +3.2%); it is not real at the enterprise-value level.

This also closes the pre/post direction question in the engine's favour. This
model showed a fall throughout, and three rounds of work treated that as its own
defect. It was not.

### S4 is not internally consistent

S4 predates the uniform treatment. Its year-5 waypoint is at 50% of the gap for
Launch and Starlink but 1/3 for xAI, and Launch's within-block path is a straight
line (equal increments) rather than gap-closing. These look hand-edited. **Treat
S5 as the authoritative shape**; reproduce S4 only by transcribing its output
row, not by applying a rule.

---

## 4. Divergences from the MoneyView engine as built

All of the below were corrected on 2026-08-11 unless marked open.

| # | Item | Source | Was | Status |
| --- | --- | --- | --- | --- |
| 1 | Terminal ROIC | 0.15 | 0.33 | Fixed |
| 2 | Revenue shape | Two-block gap-closing | Decaying / anchored curve | Fixed — `waypoint_gap_fraction` |
| 3 | Effective tax rate | 0.10, ramping to marginal | marginal every year | Fixed — `effective_tax_rate` |
| 4 | Post target revenue | 420,000 | 400,000 | Fixed |
| 5 | Post / pre year-10 EBIT | 160,000 / 155,000 | 158,500 / 151,000 | Fixed |
| 6 | Pre xAI target margin | 0.50 | 0.45 | Fixed — footnote 1 disproved |
| 7 | Sales-to-capital | Slope reverses S4→S5 | Invented magnitudes | Fixed |
| 8 | Base revenues and margins | Per-segment rows | Apportioned / single value | Fixed |
| 9 | Expansion ramp start | Year 6 | Year 7 | Fixed |
| 10 | Share count | Circular on value per share | 12.535 + 0.556 | Fixed — solved count transcribed |
| 11 | R&D capitalization | Yes, in both | Not implemented | **Open** |
| 12 | Case-level narratives | n/a | Absent | **Open** — needs a schema change |

**Result.** The post-prospectus case now reproduces `SpaceX2026IPOUpdated.xlsx`
exactly — PV of the explicit period 161.8819499, PV of terminal value
1062.5660566, enterprise value 1224.4480065, value per share 97.8276552, and the
revenue path matches cell for cell. The pre-prospectus case reproduces the
*corrected* April valuation to within 1%; it cannot reproduce the published one,
because the published one contains the error in §3a.

Items 11 and 12 do not affect either figure: R&D capitalization changes only the
base year, which is not discounted, and case-level narratives are a provenance
mechanism rather than an input.

## 5. What is still not in the spreadsheets

- The narrative rationale for any input. The spreadsheets carry numbers and a few
  one-line labels; the "why" stays in S1–S3.
- Segment-level TAM and market-share arithmetic. Target revenues appear as single
  typed constants, not as `TAM × share`.
- Any confidence or 3P tagging. That layer is MoneyView's own and has no source
  counterpart.
