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

### S4 is not internally consistent

S4 predates the uniform treatment. Its year-5 waypoint is at 50% of the gap for
Launch and Starlink but 1/3 for xAI, and Launch's within-block path is a straight
line (equal increments) rather than gap-closing. These look hand-edited. **Treat
S5 as the authoritative shape**; reproduce S4 only by transcribing its output
row, not by applying a rule.

---

## 4. Divergences from the MoneyView engine as built

| # | Item | Source | `valuation_seed.py` | Impact |
| --- | --- | --- | --- | --- |
| 1 | Terminal ROIC | 0.15 | 0.33 | Dominates terminal value; largest single error |
| 2 | Revenue shape | Two-block gap-closing, 1/3 waypoint | Decaying / anchored / hump curve | Whole path |
| 3 | Post target revenue | 420,000 | 400,000 | −4.8% on year-10 revenue |
| 4 | Post year-10 EBIT | 160,000 | 158,500 | — |
| 5 | Pre year-10 EBIT | 155,000 | 151,000 | — |
| 6 | Pre xAI target margin | 0.50 | 0.45 | Followed a footnote guess now disproved |
| 7 | Sales-to-capital slope | Reverses S4→S5 (see §2) | Invented magnitudes, wrong direction | Caused the pre/post EV sign error |
| 8 | Base margins | 0.08 / 0.10 / −0.05 / 0.00 | Single assumed value | Path-wide |
| 9 | R&D capitalization | Yes, in both | Deferred by decision | Base EBIT sign flips: −2,589 → +4,020.2 |
| 10 | Terminal growth | = riskfree, not overridden | — | — |
| 11 | Share count | Circular on value per share | Fixed at 12.535 + 0.556 | Post value/share |

**Item 7 closes the question left open in `todo3.md`'s "Known divergences"
item 1.** The engine produced EV falling pre→post; the source has it rising by
+0.69%. The cause was neither an incompatibility in the source (my first claim,
false) nor a calibration magnitude to be tuned (my second framing, also wrong).
The source reverses the *direction* of the sales-to-capital slope between the two
valuations, and lowers the early ratios while raising the late ones. No amount of
tuning a single "lowering magnitude" reaches that, because it is a different
shape, not a different size.

## 5. What is still not in the spreadsheets

- The narrative rationale for any input. The spreadsheets carry numbers and a few
  one-line labels; the "why" stays in S1–S3.
- Segment-level TAM and market-share arithmetic. Target revenues appear as single
  typed constants, not as `TAM × share`.
- Any confidence or 3P tagging. That layer is MoneyView's own and has no source
  counterpart.
