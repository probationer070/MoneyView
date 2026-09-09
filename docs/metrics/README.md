# Metric Reference

MoneyView reports numbers. This is where each one that a reader could
misunderstand is explained: what it is, what question it answers, exactly how
this codebase computes it, and the specific wrong belief a reader could form
about it.

Every entry cites the code it describes (`file:line` and a symbol that must be
defined in that file). `scripts/check_metric_docs.py` enforces the citation and
the presence of all eight fields on every commit; it does not and cannot judge
whether a "common misreading" is one a person could actually have — that stays
a human review step.

## Families

| Family | Entries | Covers |
| --- | --- | --- |
| [`price-signals`](price-signals.md) | 3 | Raw reads off a ticker's own price and volume history. |
| [`discount-rates-and-returns`](discount-rates-and-returns.md) | 4 | What return the market is pricing in, versus what return is required. |
| [`fundamental-quality`](fundamental-quality.md) | 7 | Return on capital, growth, and the tax rate — and whether each is trustworthy. |
| [`dcf-mechanics`](dcf-mechanics.md) | 8 | The discounted-cash-flow build itself: terminal value, net debt, per-share value. |
| `verdict-panel` | 3 | How price and value signals are framed and gapped into the read-only evidence panel. |
| [`industry-benchmarks`](industry-benchmarks.md) | 5 | Sector reference values and how a subject's own figure is normalised against them. |
| `attribution-and-uncertainty` | 7 | What moved a valuation, by how much, and how much confidence attaches to the answer. |

All seven families are written. Their counts above are the
source-backed totals confirmed in
[`inventory.md`](inventory.md), not the original spec's candidate counts —
where the two disagreed, the inventory won. `price-signals` itself is written
at 3 entries rather than the inventory's 4: `pe_change` was found to have zero
callers anywhere under `apps/` while writing this file, the same "not present"
test the inventory already applies to `packages/core_finance/hurdle_rate.py`
and `risk_analysis.py`. See the note at the top of `price-signals.md`.

`verdict-panel` is written at 3 entries, not the 6 both
`docs/superpowers/specs/2026-09-08-metric-reference-design.md`'s §5 structure
table and `docs/superpowers/plans/2026-09-08-metric-reference.md` still list
it at. Both of those were written as part of the original 50-candidate
enumeration, before Task 1 confirmed each family's candidates against the
actual source; `inventory.md` is that later, source-backed confirmation, and
per the override rule above it wins where the two disagree. `inventory.md`
lists exactly three `verdict-panel` rows as distinct — `dcf_gap`,
`direction`, `price_move_pct` — with no fourth candidate anywhere in its
distinct, duplicate, or not-present accounting. Neither the design spec nor
the plan is corrected here; they are historical planning documents outside
this reference's own file list. See the note at the top of `verdict-panel.md`.

`discount-rates-and-returns` is written at 4 entries, not the 11 both the
design spec's §5 structure table and the plan still list it at, for the same
reason: `inventory.md` lists exactly four rows as distinct for this family —
`market_expected_return`, `capm_expected_return`, `dcf_implied_return`,
`expected_return_spread` — and moves the plan's other seven candidates to
"not present". All seven are the combined functions of
`packages/core_finance/hurdle_rate.py` and `packages/core_finance/beta.py`,
neither of which has a single caller anywhere under `apps/`. This does not
mean the codebase reports no WACC or beta at all — the WACC and beta a
reader actually sees (`apps/api/services/corporate_dcf.py:132,309`) are a
clamped input and a stored passthrough, not those two modules' formulas, and
are recorded in `inventory.md`'s "Follow-up candidates" table rather than
dropped outright. See the note at the top of
`discount-rates-and-returns.md`.

`dcf-mechanics` is written at 8 entries, not the 9 both
`.superpowers/sdd/2026-09-08-metric-reference/task-6-brief.md` and the original
50-candidate enumeration list it at. `inventory.md:99,117` moved
`calculate_fcff` (`packages/core_finance/dcf.py:13`) to "not present": a
repo-wide grep for it under `apps/` returns zero matches, and it is unreachable
even from `packages/core_finance` itself — both `multi_stage_dcf` and
`sensitivity_grid` take a pre-computed FCFF list as an argument rather than
deriving one. The confirmed eight are at `inventory.md:58-65`. See the note at
the top of `dcf-mechanics.md`.

## Entry template

Every entry in every family file uses exactly this shape. The checker parses
it, so the field names and the `Source:` line are load-bearing, not
decoration.

**The `Source:` line's two parts answer two different questions.** The line
number points at **where the metric is computed**. The symbol names the
**enclosing definition** — the function or class the computation lives
inside — which for an inline calculation (`price / eps` written directly in
a branch of `build_verdict`, say, rather than in its own function) is not
defined at that line; it is defined wherever `def`/`class` for that name
appears in the file. The checker verifies the symbol is defined *somewhere*
in the cited file, deliberately not at the cited line, because pinning the
line would break every entry on any edit above it. `docs/metrics/price-signals.md`'s
`trailing_pe` entry is the worked example: `valuation_verdict.py:446` is
where `price / eps` is written; `build_verdict` (defined at line 238) is the
function it's written inside.

**The `Current state` field carries its date immediately after the label,
not inside it** — `**Current state.** (YYYY-MM-DD) ...` — because the checker
matches the literal substring `**Current state.` and a date placed *inside*
the bold span (`**Current state (YYYY-MM-DD).**`) breaks that match: nothing
in the required text is exactly `**Current state.` when a parenthetical sits
between "state" and the period. The form below is checker-verified, not
merely styled to look that way, and still puts the staleness marker before
the sentence for a skimming reader.

```markdown
### `metric_name`

Source: `packages/core_finance/price_signals.py:19` — `drawdown_from_peak`

**What it is.** One sentence a non-specialist can hold.

**Why this metric.** What it answers that a neighbouring metric does not.

**How it is calculated here.** The implementation's semantics: sign convention,
denominator and window, annualisation, fallback, guards.

**What it affects.** What downstream consumes it.

**Where it is shown.** Endpoint and screen, or "HTTP-only, no UI".

**How to read it.** Unit, direction and sign, and the reading NOT to make.

**Common misreading.** The plausible wrong reading, stated as a wrong reading.

**Current state.** (YYYY-MM-DD) What it does today; what it refuses and why.
```

## What earns an entry

A field earns an entry when it carries **material interpretive ambiguity** --
when a competent reader could form a wrong belief about what the number means.
That is broader than "the calculation had a defensible alternative", which would
drop three classes: thresholds (no competing formula, the question is what the
threshold does), normalisations (uncontroversial formula, contested denominator),
and association measures (trivial to compute, easy to read as a contribution).

Identifiers, names, dates, sources, counts and raw statement passthroughs get no
entry: there is no method to explain.
