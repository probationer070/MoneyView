# The Valuation Tab — Design

Date: 2026-09-04
Status: draft, pending review
Scope: Track C1. One page surfacing the evidence panel that already exists at
`GET /api/v1/valuation/verdict/{ticker}`.

> Every figure quoted below was measured against the running app and
> `data/processed/moneyview.db` on 2026-09-04, not assumed. Measurements are
> reproduced inline so a reviewer can disagree with the evidence rather than
> only with the conclusion.

---

## 1. Problem

Sub-projects 1–3 shipped an evidence panel, an industry-relative conservative
case, and a segment build-up engine. **None of them has a UI.** All are
HTTP-only, so the only way to read a verdict today is to call the API by hand.

`guideline/sop/todo.md` Track C1 states the requirement that shapes this whole
design:

> The verdict panel is designed to be shown as rows with a `source` beside each
> — a refused row is content, not an error state, and the UI must render it as
> such.

### 1.1 Refusal is the majority state, not the edge case

Measured 2026-09-04 with `build_verdict` across all 139 watchlist tickers:

| Signal | Computed | Refused | Dominant reason |
| --- | --- | --- | --- |
| `volume` | 139 | 0 | — |
| `drawdown` | 84 | 55 | `peer_set_too_thin`=51 |
| `trailing_pe` | 0 | 139 | `no_vintage`=139 |
| `dcf_gap` | 0 | 139 | `no_vintage`=139 |

So a tab built today shows **two rows with numbers and two rows explaining why
they have none**, for every ticker. The refusal presentation is the main event.
A design that treats refusals as a fallback path would be designing for a state
this data does not currently produce.

`no_vintage` is Track A1 — a missing Damodaran workbook — and is not fixable
from here. The tab must be useful while half its rows refuse, and must stay
correct when A1 lands and they start computing.

---

## 2. Scope

**In:** one route, `/valuation`, showing the four-row evidence panel for one
ticker at a time, plus a nav entry.

**Out, deliberately:**

| Item | Why |
| --- | --- |
| The conservative case (`POST /valuation/conservative/{ticker}`) | Depends on `industry_benchmark`, which is empty; it would refuse too. Its own sub-project. |
| Segment cases (`/valuation/cases…`) | A create-and-run workflow, not a read. Its own sub-project. |
| A watchlist-wide comparison table | A different product from the per-ticker panel. |
| Sorting or ranking tickers by "cheapness" | Requires a rollup this design refuses to compute (§4). |

---

## 3. The API contract, captured from a live response

Not paraphrased — a real `GET /api/v1/valuation/verdict/AEP` on 2026-09-04.
`fetchApi` unwraps the envelope and `buildApiUrl` prepends `/api/v1`, so
`fetchApi<VerdictPanel>("/valuation/verdict/AEP")` returns the `data` object.

```json
{
  "ticker": "AEP",
  "direction": "Testing UNDERVALUATION. Each row states the basis it was compared against, and those bases differ: only a row benchmarked against the top of the sector carries that framing. …",
  "rows": {
    "drawdown": {
      "value": -0.09395437797260045,
      "comparison": "peer mean -12.9%",
      "source": "own window: last 252 of 2513 bars; peers: 8 of 8 within 2025-09-04..2026-09-03",
      "reason": null
    },
    "volume": {
      "value": 1.1951446405779511,
      "comparison": null,
      "source": "own bars: 90/252 bars",
      "reason": null
    },
    "trailing_pe": {
      "value": null,
      "comparison": null,
      "source": "Damodaran",
      "reason": "no_vintage: no industry benchmark data has been loaded"
    },
    "dcf_gap": {
      "value": null,
      "comparison": null,
      "source": "conservative case",
      "reason": "no_vintage: no industry benchmark data has been loaded"
    }
  }
}
```

Three properties of this shape drive the design:

1. **`value` and `reason` are mutually exclusive** — the model's own docstring
   says so (`VerdictRow`: *"`value` and `reason` are mutually exclusive"*).
2. **`source` is present on every row, including refusals.** A refused
   `trailing_pe` still reports `source: "Damodaran"` — it names where the figure
   *would* have come from. So `source` is never conditional on success.
3. **`comparison` arrives pre-formatted** (`"peer mean -12.9%"`). It is the
   backend's own attribution wording. The UI renders it **verbatim** and never
   reformats or recomputes it.

---

## 4. The four rows are in different units

This is the design's single most important constraint. Confirmed by reading
each producer in `apps/api/services/valuation_verdict.py` and
`packages/core_finance/price_signals.py`:

| Row | Raw value | What it is | Renders as |
| --- | --- | --- | --- |
| `drawdown` | `-0.0939` | fractional decline from the running peak | `-9.4%` |
| `volume` | `1.1951` | recent mean volume ÷ baseline mean volume | `×1.20` |
| `trailing_pe` | e.g. `24.3` | price ÷ EPS, a multiple | `24.3` |
| `dcf_gap` | `(intrinsic - price) / price` | gap to fair value, **no time horizon** | `+18.2%` |

**There is no shared `formatValue()`.** A single formatter applied to all four
renders volume's `1.1951` as `119.5%` or `+19.5%`, either of which states
something false: the number is a ratio, not a proportion. Each row owns its
formatter, keyed to its own basis.

`dcf_gap` carries the same caveat as the decision log's
`dcf_implied_return_pct`: it is a **horizonless** total gap, not an annualised
return. It must never be combined with, subtracted from, or ranked against a
figure that has a time horizon. `ERROR-LOG.md` records that conflation twice.

---

## 5. `direction` is framing, not a verdict

`build_verdict` returns `direction` as a **fixed constant string**
(`valuation_verdict.py`, `DIRECTION`), identical for every ticker. It is a
disclosure of the panel's framing — that it tests undervaluation, that the rows'
bases differ, and that a basis conservative for one direction is
anti-conservative for the other.

It is **not** a computed verdict, and the backend deliberately computes none.

Therefore the UI renders it as prose above the rows and **must not**:

- show an "UNDERVALUED" / "OVERVALUED" badge,
- colour rows green/red by whether they look favourable,
- compute a score, count, or ratio across rows,
- rank or sort rows by magnitude.

Each of those invents a rollup the API refuses to produce, over four signals in
four different units. That is the defect class this repository records three
times in `ERROR-LOG.md` — a number wearing an attribution it has not earned.

---

## 6. Row anatomy

Four rows, **equal visual weight**, fixed order: `drawdown`, `volume`,
`trailing_pe`, `dcf_gap`. Each row shows:

| Element | Computed row | Refused row |
| --- | --- | --- |
| Signal name | yes | yes |
| Value | formatted by its own unit (§4) | **absent** — never `0`, never `—` styled as a value, never blank |
| `comparison` | verbatim, when non-null | absent (it is null) |
| `reason` | absent (it is null) | **rendered as the row's content**, in ordinary text |
| `source` | **always, in full** | **always, in full** |

`source` is always visible and never behind a click or hover. It is the panel's
product: the number without its basis is exactly the thing the panel exists to
avoid presenting. Hiding it makes the value look more authoritative than it is.

---

## 7. Ticker selection

A single input, seeded from the watchlist (`GET /portfolio/watchlist`, already
consumed by the corporate page — 139 rows, each with a name and sector as of
2026-09-04). It offers those as suggestions and still accepts any symbol typed
in, because the panel answers honestly for an unknown ticker: every row refuses
with a stated reason rather than erroring.

---

## 8. UI state contract

The same contract `/decisions` follows, for the same reason: loading and error
must not state an answer the request never returned.

| Condition | The page must |
| --- | --- |
| No ticker chosen yet | prompt for one; render no panel and no row |
| `isLoading` | a loading indicator — never rows, never a partial panel |
| `isError` | an error — never rows, never "no signals" |
| Loaded | the four rows, refusals included; this is the normal case |

Loaded-with-refusals is **not** an error state and must not be styled as one.

---

## 9. Testing

One Playwright spec against a mocked endpoint, following the 24 specs in
`apps/web/tests/e2e/` (counted 2026-09-04, not carried forward). The fixture must contain **both** row states — at least
one computed and one refused — because a fixture where every row computes would
pass against a UI that drops refusals entirely.

Every assertion of absence carries a positive control first: an absence check
against a page that never rendered proves nothing
(`corporate-probability-labels.spec.ts` establishes this pattern).

Mutations that must break a named test:

| Guarantee | Mutation that must break it |
| --- | --- |
| Each row formats by its own unit | format `volume` with the drawdown percent formatter; the `×1.20` assertion must fail |
| A refusal is content, not a zero | render a refused row's value as `0` or `—`; the refusal test must fail |
| `source` is always visible | hide `source` behind an expander; the source assertions must fail |
| No rollup is invented | add a computed verdict badge; the forbidden-label check must fail |
| `comparison` is verbatim | reformat the comparison string; the verbatim assertion must fail |

The suite is Playwright-only (`apps/web` has no unit runner) plus
`npx tsc --noEmit`, which is a required gate — the e2e harness runs Next in dev
mode and never typechecks.

---

## 10. Out of scope

| Item | Why |
| --- | --- |
| Fixing `no_vintage` | Track A1. Needs a Damodaran workbook not on this machine. The tab is designed to be correct before and after it lands. |
| `peer_set_too_thin` (51 tickers) | A real modelling limit, not a UI concern. The row states it. |
| Charting any signal over time | The panel is point-in-time. A time series needs its own basis disclosure. |
| Caching or offline behaviour | React Query's defaults, as on every other page. |
