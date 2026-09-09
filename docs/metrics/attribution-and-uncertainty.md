# Attribution and Uncertainty

Seven figures answering what moved a valuation, by how much, and how much
confidence attaches to the answer. Two attribute a difference between two
already-computed valuations — one exactly, in the valuation's own unit
(Shapley), one as a rank-based association with no unit and no summation
(Spearman). Three are epistemic labels and thresholds that gate what a caller
may assert or how much attribution work the engine will attempt (`three_p`,
`REFUSED_FRACTION_CAP`, `SHAPLEY_INPUT_CAP`); one is a second, differently-
defaulted epistemic label on the same narrated overrides (`confidence`); and
one is the Monte Carlo summary itself, computed only over the draws the
pricing engine accepted, never over every draw requested. None of the seven
endpoints these figures come from (`/diff`, `/simulate`) has a web UI —
confirmed by a repo-wide grep of `apps/web` for both routes and for every
field name below, which returns zero matches outside this reference; they are
HTTP-only today.

### Shapley contribution (`contributions`)

Source: `packages/core_finance/shapley.py:22` — `shapley_contributions`

**What it is.** For a forked valuation case, how much of the total change in
`value_per_share_diluted` each individual changed input accounts for, computed
by averaging that input's effect across every possible order the changes
could have been applied.

**Why this metric.** It answers "how much of THIS specific difference is THIS
input responsible for," in the same dollars-per-share unit as the difference
itself, with contributions that sum exactly to it. That distinguishes it from
Spearman association (below), which is unitless, computed independently per
input, and does not sum to anything across inputs — and from the raw
`total_difference` itself, which is undecomposed.

**How it is calculated here.** Weight `s!(n-s-1)!/n!` per coalition of size
`s` among the `n` changed inputs, summed over every coalition each player
could join (`shapley.py:52-63`); the module evaluates `metric()` once per
distinct coalition (`2^n` evaluations, cached) rather than once per
permutation (`n!`). Contributions sum to `metric(changed) - metric(base)` to
floating tolerance — the docstring is explicit there is no residual to
report. The caller, `diff_case` (`apps/api/services/case_diff.py:49-151`),
supplies `metric = run_case_payload(parent, inputs)[METRIC]` where
`METRIC = "value_per_share_diluted"` — the same figure `dcf_gap`
(`verdict-panel.md`) reads from a stored case, so the two layers agree about
what "the valuation" is (case_diff.py's own module docstring says so
explicitly). Three guards precede the computation itself: refuses
`no_parent` if the case has no parent to diff against; refuses
`not_attributable` if a changed field holds `NULL` on either side (there is
no interval to attribute across — `_refuse_unattributable`, lines 154-179);
refuses `too_many_changed_inputs` above `SHAPLEY_INPUT_CAP` (its own entry,
below). During computation, any coalition the engine itself refuses to value
raises `unrunnable_coalition` (lines 99-111) rather than silently dropping
that term, which would break conservation. After computing, `diff_case`
reconstructs the child's value from its own attributed changes and checks it
against the child's actually-stored value with
`math.isclose(rel_tol=1e-7, abs_tol=1e-9)` (lines 120-131); a mismatch raises
`not_a_fork` — the two cases do not share a structure (a dropped or added
segment, most likely) — so a `contributions` array is only ever returned once
verified to reconstruct the exact case it claims to explain.

**What it affects.** Only the `/diff` response's `contributions` array,
alongside `total_difference` (`case_value - parent_value`), which the array
sums to exactly. Nothing further downstream reads these values.

**Where it is shown.** `GET /api/v1/valuation/cases/{case_id}/diff`
(`apps/api/routes/valuation.py:138-161`). HTTP-only, no UI.

**How to read it.** Unit: dollars per share of `value_per_share_diluted`,
signed. A positive contribution means that input's change pushed the metric
up; the contributions across all changed inputs sum exactly to
`total_difference` — there is no residual "everything else" row to account
for the rest.

**Common misreading.** Read as "the effect of changing this input alone,
holding everything else fixed." That is the *sequential* answer: applying
changes one at a time in some order and attributing each step to the input
just changed. It is order-dependent — the module's own docstring gives the
reason Shapley exists at all: "applying changes in sequence gives a different
answer per ordering... 'WACC contributed -12.40' would then be a fact about
the implementation's loop order rather than about WACC." Shapley averages
over every ordering; on the nonlinear engine this attributes over, the
sequential and Shapley answers for the same input differ by half the
interaction term between that input and the others.

**Current state.** (2026-09-08) Measured directly against the live database:
`SELECT COUNT(*) FROM valuation_case WHERE parent_case_id IS NOT NULL` returns
**0 of 31** stored cases. No case in `data/processed/moneyview.db` currently
has a parent, so `/diff` refuses every case presently stored with `no_parent`
— nobody has forked a case in this database yet, and the endpoint's real
behavior today is 100% refusal for a reason that precedes Shapley entirely.
One measured trip of `SHAPLEY_INPUT_CAP` is recorded in the codebase itself —
`apps/api/routes/valuation.py:145-148` states that, as of 2026-09-05, a
seeded SpaceX pair changing 25 inputs was refused with
`too_many_changed_inputs` — cited here as an existing record, not
independently re-run in this pass, since no forked case exists in the live
database to reproduce it against. Re-measure once a fork exists.

### Spearman association (`association_among_accepted_samples`)

Source: `packages/core_finance/rank_correlation.py:36` — `spearman`

**What it is.** A -1..+1 measure of how consistently one sampled input's
drawn value moves together, in rank order, with the simulated
`value_per_share_diluted` outcome.

**Why this metric.** It answers "does this input's value tend to rise and
fall together with a higher or lower valuation across the sampled draws" —
not "how much of the outcome is because of this input," which is what
Shapley contribution (above) answers. Spearman is unitless, computed
independently per input against the outcome, and does not sum to anything
meaningful across inputs, unlike Shapley's per-share contributions that sum
to a difference.

**How it is calculated here.** Ranks of both arrays with average-rank tie
handling (`_average_ranks`, `rank_correlation.py:17-33`) — ties are not an
edge case here: a rounded INTEGER field (`ramp_start_year`,
`wacc_converge_from`) over 10,000 samples across a three-year band produces
thousands of tied draws, and ranking by array position would invent an
ordering the data does not have. Centered ranks, then
`(rx*ry).sum() / sqrt((rx**2).sum() * (ry**2).sum())` — Pearson correlation
of the rank vectors. Returns `None`, not `0.0`, when either array is constant
(zero variance, `denominator == 0`) — deliberately: `0.0` would assert "measured
and found unrelated," which is a different claim from "not measurable" (module
docstring, lines 39-41). Raises rather than silently degrading if either array
holds a non-finite value: `np.argsort` sorts `NaN` to the end and
`np.unique` treats it as its own value, so an unfiltered `NaN` would be
silently folded into the coefficient as a plausible-looking wrong number
(lines 44-54). The caller, `simulate_case` (`apps/api/services/case_simulate.py:305-308`),
computes one `spearman(drawn[key][accepted], observed)` per distributed
input, restricted to `accepted` — the rows the engine actually accepted —
which is exactly the same conditioning `REFUSED_FRACTION_CAP` (below)
governs for the rest of the summary.

**What it affects.** Only the `/simulate` response's
`association_among_accepted_samples` array, one entry per distributed input.
Nothing downstream consumes it.

**Where it is shown.** `POST /api/v1/valuation/cases/{case_id}/simulate`.
HTTP-only, no UI.

**How to read it.** Unit: dimensionless, `-1..+1` or `None`. `+1` means the
accepted draws of this input and the outcome are perfectly rank-concordant;
`-1` perfectly discordant; near `0` means little rank relationship. It says
nothing about magnitude and carries no unit compatible with `contributions`'
dollars-per-share.

**Common misreading.** Read as a contribution — "this input is responsible
for X of the spread." It is not additive across inputs the way Shapley
contributions are (those sum to a difference; these sum to nothing
meaningful), it carries no unit, and a high `spearman` value for two
different inputs does not mean their "shares" of the outcome add to
anything. It is an association, not a decomposition.

**Current state.** (2026-09-08) `spearman` runs per `/simulate` request
against caller-supplied distributions and is never persisted (the module's
own docstring: "Nothing here is persisted"); the live database currently
holds 0 stored simulate runs, so there is no watchlist-wide coverage split to
measure the way there is for `dcf_gap` or the price-signals rows. Its
refusal behavior (raises on a non-finite draw, returns `None` for a constant
input) is exercised per-request, confirmed by reading
`rank_correlation.py:36-65` directly rather than by re-running it against
live data.

### `three_p`

Source: `apps/api/services/case_fork.py:112` — `_unwrap`

**What it is.** A three-valued label (`possible`/`plausible`/`probable`) the
caller must attach to any changed narrated assumption, stating how
epistemically warranted that specific number is believed to be.

**Why this metric.** It distinguishes itself from `confidence` (below), a
different three-valued label on the same narrated override, by never being
defaulted: `confidence` is filled in with `"assumed"` when the caller omits
it, but `three_p` is refused outright when absent, because — per the code's
own comment — "picking one for the caller asserts a confidence nobody
stated" (`case_fork.py:114-115`). It classifies the claim's own epistemic
status, not the evidence source's reliability.

**How it is calculated here.** Not computed — extracted from the request
body's `three_p` field and validated against
`_THREE_P = frozenset({"possible", "plausible", "probable"})`
(`case_fork.py:41`). `_unwrap` (`case_fork.py:91-144`) reads it at line 112
(`three_p = str(raw.get("three_p") or "")`); line 113
(`if three_p not in _THREE_P`) refuses with `narrative_required` if it is
missing, empty, or not one of the three values — there is no branch that
supplies a default. This gates persistence outright: `fork_case`
(`case_fork.py:185-237`) reaches `create_case` only after every narrated
override in the request survives `_unwrap`, so a changed narrated field
cannot be stored without a `three_p`. The identical set, with the identical
"never defaulted" behavior, is re-validated in `case_simulate.py:85` for a
distribution placed over a narrated field — a distribution is itself a
claim about the assumption, so it is held to the same rule.

**What it affects.** Gates whether `fork_case`/`create_case` persists a
narrated override, and whether `simulate_case` accepts a distribution over
one. Nothing downstream aggregates or scores it; it travels with the claim
it labels, not as a number anything computes with.

**Where it is shown.** Written via `POST /api/v1/valuation/cases/{case_id}/fork`
(as part of a narrated override) and read back on subsequent case loads;
accepted, not stored, at `POST /api/v1/valuation/cases/{case_id}/simulate`.
HTTP-only, no UI — confirmed by grep, `apps/web` has no reference to
`three_p`.

**How to read it.** Not a number — a categorical label, one of exactly three
strings. Nothing in this codebase maps the three values to an ordinal scale
(no `1`/`2`/`3`), so there is no implied ordering to sort, subtract, or
average by.

**Common misreading.** Read as a confidence score to be averaged or
compared numerically — treating "probable" as higher than "plausible" as
higher than "possible" on an implicit scale, then averaging across several
changed inputs to produce one number for a fork. The codebase enforces
membership in the three-value set and nothing about relative ordering or
arithmetic between the values; it is a label that gates whether storage is
allowed, not a quantity to summarize.

**Current state.** (2026-09-08) Confirmed by reading both call sites
(`case_fork.py:91-144`, `case_simulate.py:63-110`) that `three_p` is never
defaulted in either — there is no code path in this repository that supplies
a value when one is absent, unlike `confidence` below. No watchlist-wide
coverage figure applies: the field lives on `segment_narrative` rows, and the
live database's 31 stored `valuation_case` rows are all root cases
(`parent_case_id IS NULL` for all 31, measured under Shapley contribution
above), so none currently holds a forked narrative override to inspect.

### `REFUSED_FRACTION_CAP`

Source: `apps/api/services/case_simulate.py:46` — `REFUSED_FRACTION_CAP`

**What it is.** The fraction of Monte Carlo draws the pricing engine is
allowed to refuse before `/simulate` stops reporting summary statistics
(`p10`/`p50`/`p90`/`mean`/`histogram`/`association_among_accepted_samples`)
for that run.

**Why this metric.** It exists because dropping refused draws does not
merely shrink the sample of the same question — it changes which question is
being answered. The module's own docstring: "dropping them does not bias an
estimate of the same quantity -- it changes WHICH quantity is estimated, to
the distribution of the metric CONDITIONAL on the engine accepting the
inputs." Below the cap, that conditioning is judged small enough to leave
implicit; at or above it, the summary is withheld rather than published
looking unconditioned.

**How it is calculated here.** `REFUSED_FRACTION_CAP = 0.10`
(`case_simulate.py:46`), compared via
`_is_suppressed(refused_fraction) -> bool: return refused_fraction >= REFUSED_FRACTION_CAP`
(line 60) — the comparison is `>=`, so a run refusing exactly 10.00% of
draws is suppressed, not the last fraction still summarized.
`refused_fraction = runs_refused / runs` (line 251), where `runs_refused`
counts every draw that either raised a `ValueError` inside
`run_case_payload` (classified via `engine_refusals.classify`) or produced a
non-finite `value_per_share_diluted` — the latter counted under a synthetic
`non_finite_result` code deliberately *not* added to
`engine_refusals.REFUSAL_CODES`, because the engine did not raise in that
case (lines 226-241). When `_is_suppressed` is true, `simulate_case` returns
early (line 270) with only run counts, `refused_fraction`, and the per-code
refusal breakdown — every summary field is *omitted* from the response, not
returned as `null`.

**What it affects.** Whether the `/simulate` response carries any
distributional summary at all. It does not affect `runs_valid`,
`runs_refused`, `refused_fraction`, or `refusals`, which are always reported
regardless of the cap.

**Where it is shown.** `POST /api/v1/valuation/cases/{case_id}/simulate`,
via the presence or absence of a `suppressed` field and the summary fields it
explains the absence of. HTTP-only, no UI.

**How to read it.** A fixed constant (`0.10`), not a per-run figure — the
per-run figure it gates is `refused_fraction`, reported separately alongside
it on every response.

**Common misreading.** Read as a soft warning line drawn on an otherwise-
trustworthy result, rather than a hard withholding. A client that checks
only for the presence of, say, `p50` and otherwise ignores `suppressed`/
`refused_fraction` will read the absence of a value as "the endpoint didn't
return one for some reason," rather than "the engine refused too large a
share of the caller's own stated distributions to answer the question that
was asked."

**Current state.** (2026-09-08) The cap is a fixed constant in source with
no per-ticker coverage figure to measure. No simulate run is persisted (the
module's own docstring: "Nothing here is persisted"), and the live database
holds 0 such runs, so the suppression boundary is exercised per-request
against caller-supplied distributions and runs, not observable as a stored
split — confirmed by reading `case_simulate.py:46-60,250-270` directly.

### `SHAPLEY_INPUT_CAP`

Source: `apps/api/services/case_diff.py:31` — `SHAPLEY_INPUT_CAP`

**What it is.** The largest number of simultaneously changed inputs `/diff`
will attribute with Shapley values before refusing outright, rather than
falling back to a cheaper, order-dependent method.

**Why this metric.** Shapley costs `2^k` engine evaluations for `k` changed
inputs (`shapley.py`'s own module docstring). This cap is the point past
which that cost is judged too high for a synchronous request — and,
critically, the response above it is a refusal, never a degraded
computation: `/diff` does not fall back to a sequential or sampled
approximation, because, per the route's own docstring
(`apps/api/routes/valuation.py:144`), "two responses of identical shape
computed differently cannot be compared."

**How it is calculated here.** `SHAPLEY_INPUT_CAP = 12` (`case_diff.py:31`),
compared with `if len(changes) > SHAPLEY_INPUT_CAP` (line 93) — the
comparison is strict `>`, so exactly 12 changed inputs (4096 coalitions) is
still attributed; 13 is refused with `too_many_changed_inputs`, the message
naming both the actual count and the cap. The comment above the constant
records its cost basis directly: "2^12 = 4096 engine runs, about 16 s at the
measured 3.98 ms per run: the edge of a tolerable synchronous request" — a
latency budget translated into an evaluation-count ceiling, not a
statistical judgment about how many inputs Shapley can meaningfully
attribute across.

**What it affects.** Whether `/diff` computes and returns `contributions` at
all for a given case pair. It is checked *after* `effective_changes` narrows
the override set to genuinely-changed fields (`case.*` excluding `ticker`/
`as_of_date`, plus `segment.*` fields), so a pair whose stored values happen
to touch more than 12 columns without changing any of them does not count
against the cap.

**Where it is shown.** `GET /api/v1/valuation/cases/{case_id}/diff`, via a
422 `too_many_changed_inputs` refusal when tripped. HTTP-only, no UI.

**How to read it.** A fixed constant (`12` changed inputs), compared with
strict `>`. It measures the number of distinct changed dimensions between a
case and its parent (case fields plus segment fields, combined), not the
number of segments in the case and not the number of override keys submitted
in the original fork request.

**Common misreading.** Read as a statement about Shapley's own validity —
"past 12 inputs the attribution stops being meaningful" — when the number is
purely a latency budget. The comment above the constant derives it from
`2^12 = 4096` engine runs at a measured 3.98 ms each, about 16 seconds: the
edge of a tolerable synchronous request. Nothing about Shapley degrades at 13
inputs; the same 13 would attribute exactly as soundly given the time to run
`2^13` evaluations. A second misreading, about what is being counted: the cap
counts changed *dimensions* as `effective_changes` resolves them
(`case_fork.py:147-163` — an override equal to the parent's stored value is
discarded before counting), not override keys in the fork request and not
segments in the case. That function's own docstring says so directly: "the
attribution cap and `changed_input_count` describe changed dimensions, not
request keys." A fork submitting 30 keys of which 8 differ from the parent is
8 against the cap, not 30. Above the cap there is no partial or approximate
result to fall back on — 422, and no `contributions` array at all.

**Current state.** (2026-09-08) Verified: 0 of 31 stored `valuation_case`
rows currently have a `parent_case_id` (same measurement as under Shapley
contribution, above), so no case in the live database is eligible for
`/diff` at all today — the cap has not been exercised against production
data since deployment. The one measured trip recorded in the codebase
(`apps/api/routes/valuation.py:145-148`, 2026-09-05: a seeded SpaceX pair
changing 25 inputs, refused with `too_many_changed_inputs`) predates this
pass and was not independently re-run here, since no forked case exists in
the current database to reproduce it against.

### `confidence` (segment-narrative label)

Source: `apps/api/services/case_fork.py:123` — `_unwrap`

**What it is.** A three-valued label (`confirmed`/`derived`/`assumed`) on a
changed narrated assumption, stating how the evidence behind the claim was
obtained.

**Why this metric.** It sits beside `three_p` on the same narrated override
but classifies a different thing — the evidence source's provenance, not
the claim's epistemic strength — and, unlike `three_p`, it defaults: an
absent `confidence` is filled in as `"assumed"` (`case_fork.py:123`), while
an absent `three_p` is always refused. The code's own comment states the
reasoning for the asymmetry directly: `confidence` "is not itself an
epistemic claim about the assumption" the way `three_p` is
(`case_fork.py:45-49`).

**How it is calculated here.**
`_CONFIDENCE = frozenset({"confirmed", "derived", "assumed"})`
(`case_fork.py:50`), applied at
`confidence = "assumed" if "confidence" not in raw else str(raw["confidence"])`
(line 123). The check is `"confidence" not in raw`, not
`raw.get("confidence") or "assumed"` — deliberately: an absent key defaults,
but a *supplied* empty string, `null`, or `0` is a value the caller typed
and is refused (line 124: `if confidence not in _CONFIDENCE`) rather than
silently replaced. The identical set, with the identical "default only when
the key is absent" behavior, is re-validated in `case_simulate.py:93` for a
distribution placed over a narrated field. This mirrors the sqlite `CHECK`
constraint on `segment_narrative.confidence` (`case_fork.py:43-44`'s
comment), so a value refused here never reaches the database as a raw
constraint failure.

**What it affects.** Stored alongside a segment narrative's claim. Like
`three_p`, it is persisted and read back but not aggregated or scored by
anything downstream.

**Where it is shown.** Written via `POST /api/v1/valuation/cases/{case_id}/fork`
(as part of a narrated override) and read back on subsequent case loads;
accepted, not stored, at `POST /api/v1/valuation/cases/{case_id}/simulate`.
HTTP-only, no UI.

**How to read it.** A categorical label, one of three strings, with no
numeric ordering between them. A caller that omits it is not stating
"assumed" as a judgment — the system supplies that value on their behalf.

**Common misreading.** Read as always caller-supplied, and therefore always
meaningful evidence about provenance. An absent `confidence` silently
becomes `"assumed"`, so a stored `confidence: "assumed"` row can mean either
"the caller stated the evidence was assumed" or "the caller said nothing and
the system filled it in" — the two are indistinguishable in the stored value
alone.

**Current state.** (2026-09-08) Confirmed by reading both call sites
(`case_fork.py:123`, `case_simulate.py:93`) that the default applies only on
an absent key, never on a falsy-but-present one, in both. No watchlist-wide
coverage figure applies — this is a per-narrative-override label, and the
live database's 31 stored cases are all root conservative cases
(`parent_case_id IS NULL`, measured above), so none currently holds a forked
narrative override to inspect.

### Monte Carlo summary (`p10`/`p50`/`p90`/`mean`)

Source: `apps/api/services/case_simulate.py:281` — `simulate_case`

**What it is.** The 10th/50th/90th percentile and mean of
`value_per_share_diluted` across the runs of a Monte Carlo simulation that
the pricing engine accepted, plus a 32-bin histogram of the same accepted
values.

**Why this metric.** Unlike Spearman association (above), which is per-input
and dimensionless, this *is* the distribution of the outcome itself — but a
conditional one, never an unconditional one: it summarizes only the runs
whose stated inputs the engine accepted, never the full `runs_requested`.
That conditioning is the entire reason `REFUSED_FRACTION_CAP` (above) exists
as a gate specifically on this field.

**How it is calculated here.** `np.percentile(observed, 10/50/90)` and
`observed.mean()` over `observed = np.asarray(values, dtype=float)`, where
`values` accumulates only the runs where `run_case_payload` both succeeded
*and* returned a finite `value_per_share_diluted`
(`case_simulate.py:221-249`) — a run whose engine call raised `ValueError`,
or whose result was non-finite, is excluded from `observed` and counted
under `refusals`/`runs_refused` instead. Reached only when
`refused_fraction < REFUSED_FRACTION_CAP`; otherwise the function returns
before this code runs at all. Each of the four figures is kept or dropped
*independently*: every surviving value can be finite while an aggregate of
them still is not — the code's own comment: "966 survivors near 1e306 sum
to inf, so `mean` overflows while every percentile stays finite" (lines
274-279) — so `math.isfinite` is checked per figure (lines 286-289), and a
non-finite one is deleted from the result and named in a `not_finite` field
rather than serialized as JSON `null`, because a reader "cannot tell an
overflowed mean from an unmeasurable one" if it arrives as `null`.

**What it affects.** Nothing further downstream reads these values; they are
the terminal content of the `/simulate` response's summary section,
alongside the histogram bins built from the same `observed` array.

**Where it is shown.** `POST /api/v1/valuation/cases/{case_id}/simulate`.
HTTP-only, no UI.

**How to read it.** Unit: `value_per_share_diluted`'s own unit (dollars per
share). All four describe the distribution *after* conditioning on engine
acceptance — they are not the percentiles or mean of what the caller's
stated distributions alone would produce if every draw were accepted. A
missing field among the four (see `not_finite`) means that specific
aggregate overflowed, not that it is zero or unmeasured for some other
reason.

**Common misreading.** Read as the unconditional spread implied by the
caller's stated input distributions — i.e., assuming every one of
`runs_requested` contributed to `p10`/`p50`/`p90`/`mean`. In fact only the
accepted subset (`runs_valid` of `runs_requested`) contributes, and the gap
between the two is exactly what `refused_fraction` and
`REFUSED_FRACTION_CAP` govern; at the cap, the whole summary is withheld
rather than published as an understated-conditioning number.

**Current state.** (2026-09-08) Verified by reading
`case_simulate.py:280-295` that each of the four figures is independently
finite-checked and independently omittable, and that the function returns
before computing any of them when `_is_suppressed` is true. No live-database
coverage figure applies: `/simulate` runs are never persisted (the module's
own docstring), and the live database holds 0 stored simulation results to
summarize a hit rate over.
