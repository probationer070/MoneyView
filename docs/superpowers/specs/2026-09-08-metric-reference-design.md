# The Metric Reference — Design

Date: 2026-09-08
Status: draft, pending review
Scope: documentation only. Seven files under `docs/metrics/`, an index, and one
row in `docs/INDEX.md`. No code changes, no behaviour changes, no tests beyond
two mechanical checks on the docs themselves.

> Every count below was measured against this repository on 2026-09-08, not
> assumed. Measurements are reproduced inline so a reviewer can disagree with the
> evidence rather than only with the conclusion.

---

## 1. Problem

MoneyView reports numbers. It does not, anywhere, say what they mean.

`docs/dcf-valuation.md` does this well for one family — it explains DCF from
first principles and then how this backend actually computes it. Nothing
comparable exists for the other 41. A reader looking at
`dcf_gap: 0.182` has no way to learn that it is a horizonless fraction that must
never be compared with an annualised return.

That risk is not hypothetical, though it is worth being precise about what the
record actually shows. `ERROR-LOG.md` carries **ten entries mentioning
attribution**, and two distinct defects in `dcf_gap` itself: `dcf_implied_return`
computed as `f(price, price)` and pinned at `0.0` across three propagated columns
(2026-08-03), and `dcf_gap` publishing an older bar's close as "price" with no
marker when the newest close was NULL (`ERROR-LOG.md:1743`). Neither is the
horizon conflation specifically -- that one has not bitten yet, which is the
argument for documenting it before it does.

Measured 2026-09-08: 411 distinct field names across `apps/api/models/schema_parts/`,
72 public functions across 13 `packages/core_finance/` modules. Most of those
fields are identifiers, labels, dates and sources. The reference documents the
subset that carries meaning a reader can get wrong.

---

## 2. What earns an entry

**A field earns an entry when it carries material interpretive ambiguity** — when
a competent reader could form a wrong belief about what the number means.

That is deliberately broader than "the calculation had a defensible alternative".
An alternative-formula test admits `dcf_gap` and `beta` but lets three classes
slip through, and each is a class this repository has already been bitten by:

| Class | Example | Why the narrower test misses it |
| --- | --- | --- |
| Thresholds | `three_p`, `REFUSED_FRACTION_CAP` | There is no competing formula — the question is what the threshold *does* operationally. |
| Normalisations | `volume_ratio`, benchmark `fade` | The formula is uncontroversial; the denominator's choice is not. |
| Association measures | Spearman `association` | Uncontested to compute, and extremely easy to read as a contribution. |

**Excluded**, because there is no method to explain: identifiers, names, dates,
sources, counts, and raw statement passthroughs.

Inventory: **50 candidate entries across 7 families**, enumerated 2026-09-08
against the rule above. This is an enumeration, not a code-derived count -- I
listed what passes the test, and a different reader could reasonably judge one or
two differently. The implementation plan's first task confirms the list against
the code before any entry is written, and reports what it added or dropped.

| Family | Entries |
| --- | --- |
| `discount-rates-and-returns` | 11 |
| `dcf-mechanics` | 9 |
| `fundamental-quality` | 7 |
| `attribution-and-uncertainty` | 7 |
| `verdict-panel` | 6 |
| `price-signals` | 5 |
| `industry-benchmarks` | 5 |

`price-signals` and `discount-rates-and-returns` were considered for merging on
the grounds that the first is thin. They stay separate: 5 entries is the same
size as `industry-benchmarks`, which stays separate for substantive reasons, and
merging would produce a 16-entry file — nearly double the next largest — that
mixes two different interpretive problems. What the market *did* and what return
we *require* are not the same kind of question.

---

## 3. The entry template

This is the spec's real content. Every entry carries all eight fields, in this
order. An entry missing one is incomplete, not merely terse.

### 3.1 What it is
One sentence a non-specialist can hold in their head.

### 3.2 Why this metric
What question it answers that a neighbouring metric does not. If two metrics in
the reference could answer the same question, this field says which to prefer and
when.

### 3.3 How it is calculated here
**The implementation's exact semantics, not the textbook formula.** A `file:line`
citation is mandatory. The field must state, wherever the code does:

- **sign convention** — is a decline negative, or a positive loss?
- **denominator** — what exactly it divides by, and over what window
- **annualisation** — whether the figure is per-period, annualised, or horizonless
- **fallback logic** — what happens when an input is missing
- **guards** — what the code refuses, and with what message

Where the implementation diverges from the textbook, the entry documents the
implementation and flags the divergence explicitly. The code is the authority;
the entry describes what actually runs.

### 3.4 What it affects
What downstream consumes it. `wacc` feeds every DCF; `dcf_gap` feeds the verdict
panel; `three_p` gates whether a case can be stored at all. A reader changing an
assumption deserves to know the blast radius.

### 3.5 Where it is shown
Endpoint and screen — or "HTTP-only, no UI", which is currently true of `/fork`,
`/diff` and `/simulate`. Verified 2026-09-08: `apps/web` references
`/valuation/verdict/{ticker}` and nothing under `/valuation/cases/`, so those
three endpoints have no UI consumer at all.

### 3.6 How to read it
Unit, direction and sign, **and the interpretation a reader should not make**.

### 3.7 Common misreading
**A required field, not an implied one.** The most plausible wrong reading,
stated as a wrong reading — especially where the metric resembles another
quantity closely enough to be mistaken for it.

Worked examples of what this field must carry:

| Metric | Common misreading |
| --- | --- |
| `dcf_gap` | Read as a return over a horizon. It is a dimensionless valuation gap with **no time dimension at all**, and must never be subtracted from or ranked against an annualised return. |
| `drawdown` | Read as a positive loss percentage. It is a **negative fraction** of the running peak; `-0.094` is a 9.4% decline, not a 9.4% gain or a 0.094% one. |
| `trailing_pe` | Read as a percentage. It is a **multiple** — `24.3` means 24.3×, and formatting it as `24.3%` is a category error. |
| `volume_ratio` | Read as a proportion. It is a **ratio of two means**; `1.195` is `×1.20`, not `+19.5%` or `119.5%`. |
| `three_p` | Read as a confidence score. It is a **three-valued epistemic label** (`possible`/`plausible`/`probable`) that gates storage: a changed narrated field cannot be persisted without one, and it is never defaulted. |
| Spearman `association` | Read as a contribution. It is **unitless and sums to nothing**, unlike `/diff`'s Shapley contributions, which are in per-share units and sum exactly to the difference. |

### 3.8 Current state (dated)
What the metric actually does today: how much of the watchlist it computes for,
what it refuses with, and why. Measured when written, dated, and marked
**re-measure rather than quote**.

Without this field the reference describes an ideal the product does not deliver.
Several metrics refuse for most of the watchlist right now, and that is often the
most useful thing a reader can learn about them.

---

## 4. The unit rule

Every entry states its unit explicitly. The design of `/valuation` (C1) already
concluded that no shared formatter can serve these four, and this reference
records the same constraint where a reader will meet it.

The four units in play, and why no shared formatter exists:

| Unit | Metric | Renders as |
| --- | --- | --- |
| fraction of a peak | `drawdown` | `-9.4%` |
| ratio of two means | `volume_ratio` | `×1.20` |
| multiple | `trailing_pe` | `24.3` |
| horizonless fraction | `dcf_gap` | `+18.2%` |

A single formatter across all four renders `volume_ratio`'s `1.1951` as `119.5%`,
which states something false about what the number is.

---

## 5. Structure

```
docs/metrics/
  README.md                        index of the seven, and the entry template
  price-signals.md                 5
  discount-rates-and-returns.md    11
  fundamental-quality.md           7
  dcf-mechanics.md                 9
  verdict-panel.md                 6
  industry-benchmarks.md           5
  attribution-and-uncertainty.md   7
```

Plus one row in `docs/INDEX.md`, which is the repository's map of documentation.

`verdict-panel` is a family despite sounding like a UI surface: its subject is how
upstream metrics become a composite judgement, and the panel is where that
composition is visible.

Family files are 200–400 lines. A single file would be 1,500–2,500 — long enough
that nobody reads it end to end, and a later change to one metric touches one
enormous file.

---

## 6. What this reference will not do

| Not doing | Why |
| --- | --- |
| Quote a formula it cannot cite in the code | The code is the authority. An uncited formula is a claim about behaviour nobody checked. |
| Quote a coverage figure it did not measure | Same defect class the whole reference exists to prevent, in documentation form. |
| Document a metric that does not exist yet | `/pricing` is unbuilt; it gets no entry until it does. |
| Explain finance from first principles | `docs/dcf-valuation.md` does that for DCF where it earns its space. Entries assume a reader who knows what a P/E is and needs to know what THIS P/E is. |
| Restate the code | If an entry says only what the function name says, the metric did not need an entry. |

---

## 7. Verification

Two mechanical checks, run before the work is called done:

1. **Every `file:line` citation resolves** — the file exists and the line is
   within it. A reference citing a moved function is the documentation form of
   the defect this project keeps recording.
2. **Every metric named in an entry exists in the code** — grep each documented
   symbol and confirm a definition.

Both are scripted, not eyeballed, and the script is part of the deliverable so a
future editor can re-run it.

A third check is deliberately manual: **each entry's "common misreading" must be
a misreading someone could actually have.** A field filled with "a reader might
think this is something else entirely" satisfies the template and teaches
nothing. This one cannot be automated, so the implementation plan makes it a
review step rather than pretending a script covers it.

---

## 8. Out of scope

| Item | Why |
| --- | --- |
| An API/function reference | Documents code rather than meaning, and goes stale on every refactor. 72 public functions in `core_finance` alone. |
| A per-tab user guide | `docs/tabs/` already holds six such files. Different audience, different question. |
| Rewriting `docs/dcf-valuation.md` | It works. `dcf-mechanics.md` links to it rather than duplicating it. |
| Any code change | This is a documentation deliverable. If writing an entry reveals a defect, the entry records it and the fix is its own work. |
