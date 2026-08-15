# Sales-to-Capital Late-Ratio Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the pre-prospectus seed from lowering a sales-to-capital ratio the source never says was lowered, and record — quantitatively — why the pre/post enterprise-value direction cannot be corrected within the source's own confirmed constraints.

**Architecture:** A seed-data and documentation change. No engine logic, no schema, no API. The pre-case `sales_to_capital_late` for launch and connectivity moves from `1.6` to `1.5`, matching the post case, because `guideline/sop/todo3.md:82` restricts the confirmed lowering to years 1–5. Two test files carry the same values independently and must move together.

**Tech Stack:** Python 3, pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-11-sales-to-capital-late-scope-design.md`
**Branch:** `feat-statements-acquisition` — updates PR #4 in place.

## Global Constraints

- **Only the pre-case late ratio for launch and connectivity changes.** Early ratios stay (pre `1.5/1.5/0.8` vs post `1.0/1.0/0.6` is the confirmed years-1–5 lowering). AI's late ratio stays `1.05 → 1.0` — `todo3.md:129` places no year restriction on AI. Expansion stays `1.5` in both.
- **The sign does not flip and this plan does not try to flip it.** Post stays below pre (−10.94 after the change). Anything that reduces the gap further by touching an unconstrained input is out of scope.
- **Do NOT modify** `packages/core_finance/**`, `apps/api/services/db.py`, `apps/api/routes/**`, `apps/api/models/**`, or `packages/shared-types`. No schema change, no engine change.
- **Do not change any other seeded input** — no TAM, market share, margin, base revenue, early ratio, rate, `roic_stable`, `initial_growth` or share count.
- **Seeded target-year totals must not move:** 400.0 / 158.5 post, 320.0 / 151.0 pre. Sales-to-capital drives reinvestment only, never the revenue or margin paths. If one moves, stop and report.
- **Post-case enterprise value must not move** (1309.85). This touches the pre case only.
- Tests may not make network calls or open `data/processed/moneyview.db`.
- **Known pre-existing flake:** `test_persistence_failure_self_disables_logs_once_and_keeps_ring_buffer` in `tests/api/test_perf_capture.py` is order-dependent. Note if hit; do not fix.
- **Baseline before this work: 653 tests passing.** Run from the repo root with `python -m pytest tests -q`.

## File Structure

| File | Change |
| --- | --- |
| `apps/api/services/valuation_seed.py` | **Modify.** Pre-case `s2c_late` for launch and connectivity `1.6 → 1.5`; replace the single shared `_PRE_S2C_LATE_CLAIM` with per-segment claims, since the three segments now have three different justifications. |
| `tests/core_finance/test_segment_valuation_spacex.py` | **Modify.** Same two values in the independent builder; the `marginal_roic` gate's literals and hand-computed docstring; the pinned pre enterprise value. |
| `tests/api/test_valuation_seed.py` | **Modify.** New tests pinning the scope correction. |
| `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md` | **Modify.** Four stale figures. |
| `guideline/sop/todo.md` | **Modify.** Add the pre/post direction as a divergence entry; fix a dangling workspace path. |

---

## Task 1: Restore the source's scope and record the incompatibility

**Files:**
- Modify: `apps/api/services/valuation_seed.py`
- Modify: `tests/core_finance/test_segment_valuation_spacex.py`
- Modify: `tests/api/test_valuation_seed.py`
- Modify: `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`
- Modify: `guideline/sop/todo.md`

**Interfaces:**
- Consumes: `marginal_roic(segments, marginal_tax_rate) -> float` and `run_case(case, segments) -> CaseResult` from `packages/core_finance/segment_valuation.py`, both unchanged by this task.
- Produces: no new names.

**Background — what the source actually says, and what the seed does.**

`guideline/sop/todo3.md:82` is formula I2, tagged **`[C]` confirmed**:

> In S2 he **lowered** sales-to-capital for **yrs 1–5** (launch + connectivity) after seeing actual capex, and again for AI.

§3 repeats the year restriction per segment — "Sales-to-capital **yrs 1–5** — lowered" at line 121 (launch) and line 126 (connectivity). AI's row at line 129 carries **no** year restriction: "already low → lower still".

The seed lowers both ratios for launch and connectivity:

| segment | early | late | supported? |
| --- | --- | --- | --- |
| launch | 1.5 → 1.0 | **1.6 → 1.5** | early yes; **late is invented** |
| connectivity | 1.5 → 1.0 | **1.6 → 1.5** | early yes; **late is invented** |
| ai | 0.8 → 0.6 | 1.05 → 1.0 | both supported, no year restriction |
| expansion | 1.0 → 1.0 | 1.5 → 1.5 | unchanged, per §3's `[V]` "assumed unchanged" |

This is not cosmetic. `marginal_roic` — the anchor for the whole terminal block and the quantity the two-sided `roic_stable` guard is measured against — reads `sales_to_capital_late` **only**.

**Why the pre/post direction is not being fixed.** The investigation that found this asked whether an input error explained the model producing a *falling* enterprise value where the source records a slight *rise*. It does not. Sweeping the pre-case ratios as a multiple of the post values shows the sign flips at roughly a 6% lowering: at 1.00 (no lowering at all) the gap is +8.07; at the seeded 1.067 it is −13.5. Since `[C]` confirms he *did* lower them, **any consistent value gives a falling EV**, and reproducing the source's +10 would require he *raised* them. The source's own move is +0.8%, smaller than the uncertainty on any single `[V]` input. That incompatibility gets recorded, not fitted.

- [ ] **Step 1: Write the failing tests**

Append to `tests/api/test_valuation_seed.py`:

```python
def test_late_sales_to_capital_is_unchanged_where_todo3_restricts_the_lowering():
    """todo3.md:82 (formula I2, tagged [C]) says he lowered sales-to-capital
    "for yrs 1-5 (launch + connectivity)". Section 3 repeats the year restriction
    in both segments' rows. So the LATE ratio for those two is not something the
    source says moved, and the seed must not move it.

    This matters more than its size: marginal_roic reads sales_to_capital_late
    only, so an invented value here anchors the entire terminal block.
    """
    ensure_valuation_cases_seeded()
    pre = {s["name"]: s for s in load_case(_case_id(PRE_CASE_NAME))["segments"]}
    post = {s["name"]: s for s in load_case(_case_id(POST_CASE_NAME))["segments"]}
    for name in ("launch", "connectivity"):
        assert pre[name]["sales_to_capital_late"] == post[name]["sales_to_capital_late"], name
        assert pre[name]["sales_to_capital_late"] == pytest.approx(1.5), name


def test_early_sales_to_capital_still_carries_the_confirmed_lowering():
    """The correction above must not overshoot. todo3 confirms the years-1-5
    lowering; removing it too would be a different error in the other direction."""
    ensure_valuation_cases_seeded()
    pre = {s["name"]: s for s in load_case(_case_id(PRE_CASE_NAME))["segments"]}
    post = {s["name"]: s for s in load_case(_case_id(POST_CASE_NAME))["segments"]}
    for name in ("launch", "connectivity", "ai"):
        assert pre[name]["sales_to_capital_early"] > post[name]["sales_to_capital_early"], name


def test_ai_late_sales_to_capital_is_still_lowered():
    """todo3.md:129 places no year restriction on AI -- "already low, lower
    still" -- so lowering AI's late ratio IS supported and must survive."""
    ensure_valuation_cases_seeded()
    pre = {s["name"]: s for s in load_case(_case_id(PRE_CASE_NAME))["segments"]}
    post = {s["name"]: s for s in load_case(_case_id(POST_CASE_NAME))["segments"]}
    assert pre["ai"]["sales_to_capital_late"] == pytest.approx(1.05)
    assert post["ai"]["sales_to_capital_late"] == pytest.approx(1.0)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/api/test_valuation_seed.py -v`
Expected: `test_late_sales_to_capital_is_unchanged_where_todo3_restricts_the_lowering` FAILS (pre is 1.6, post is 1.5). The other two should already pass — they pin behaviour that must survive the change.

- [ ] **Step 3: Correct the seeded values**

In `apps/api/services/valuation_seed.py`'s pre-prospectus payload, change `s2c_late=1.6` to `s2c_late=1.5` for **launch** and **connectivity** only. Leave `s2c_early` alone in both. Leave AI (`s2c_early=0.8, s2c_late=1.05`) and expansion (`s2c_early=1.0, s2c_late=1.5`) untouched.

- [ ] **Step 4: Replace the shared claim with per-segment claims**

`_PRE_S2C_LATE_CLAIM` is currently one string passed to all four pre-case segments. The three segments now have three different justifications, so one string can no longer be truthful for all of them. Replace it with three constants and pass the right one at each call site:

```python
_PRE_S2C_LATE_UNCHANGED = (
    "Unchanged from the post-prospectus case. todo3 I2 (line 82, tagged [C]) "
    "restricts the confirmed lowering to years 1-5 for launch and connectivity, "
    "and section 3 repeats the year restriction in both rows -- so the source "
    "says nothing about this segment's late-years ratio moving. The level "
    "itself remains a guess: what the source settles is whether it changed, "
    "not what it is. Calibrate against SpaceX2026IPOUpdated.xlsx."
)

_PRE_S2C_LATE_AI = (
    "Lowered to 1.0 post-prospectus. Unlike launch and connectivity, todo3 "
    "section 3 (line 129) places no year restriction on AI -- \"already low, "
    "lower still\" -- so lowering the late-years ratio is supported here. The "
    "level is still a guess. Calibrate against SpaceX2026IPOUpdated.xlsx."
)

_PRE_S2C_LATE_EXPANSION = (
    "Unchanged from the post-prospectus case, per todo3 section 3, which tags "
    "the expansion segment's inputs [V] \"assumed unchanged\". The level is a "
    "guess for a segment that is itself a placeholder for optionality."
)
```

Pass `_PRE_S2C_LATE_UNCHANGED` for launch and connectivity, `_PRE_S2C_LATE_AI` for ai, `_PRE_S2C_LATE_EXPANSION` for expansion. Delete `_PRE_S2C_LATE_CLAIM` once nothing references it.

Tags stay `confidence="assumed"`, `three_p="plausible"` — unchanged. The source now answers *whether* the ratio moved; it still says nothing about what level it takes, and promoting the tag would repeat the overclaim corrected in the `initial_growth` retagging.

- [ ] **Step 5: Update the independent builder in the engine tests**

`tests/core_finance/test_segment_valuation_spacex.py` builds both cases directly, independently of the seed. In its **pre-prospectus** builder change `s2c_late=1.6` to `s2c_late=1.5` for launch and connectivity. Leave ai (`1.05`) and expansion (`1.5`) alone.

Then update `test_pre_prospectus_marginal_roic`. Its expected value is computed inline from hardcoded ratios, which is what makes it an independent oracle — so the literals must move with the data:

```python
    expected = (70 * 0.40 * 0.75 + 120 * 0.60 * 0.75 + 80 * 0.45 * 0.75 + 50 * 0.30 * 0.75) / (
        70 / 1.5 + 120 / 1.5 + 80 / 1.05 + 50 / 1.5
    )
```

Update that test's docstring arithmetic to match — it currently shows `capital = 70/1.6 = 43.75` and `120/1.6 = 75.0` and a total of `228.273809523...` giving `0.496114732...`. The new figures are `70/1.5 = 46.666...`, `120/1.5 = 80.0`, total `236.190476...`, giving **`0.479486...`**. Also update the docstring sentence claiming the pre-case values "remain strictly above the post-case ones" — after this change they are *equal* for launch and connectivity and strictly above only for ai.

- [ ] **Step 6: Run and measure**

Run: `python -m pytest tests/core_finance/ tests/api/test_valuation_seed.py -v`

Then capture the new figures. This is read-only and touches no database:

```bash
python -c "
from tests.core_finance.test_segment_valuation_spacex import pre_prospectus, post_prospectus
from packages.core_finance.segment_valuation import run_case, marginal_roic
for nm, build in (('pre', pre_prospectus), ('post', post_prospectus)):
    c, s = build(); r = run_case(c, s)
    m = marginal_roic(s, c.marginal_tax_rate)
    print(f'{nm}: EV={r.enterprise_value:8.2f}  marginal_roic={m:.6f}  intensity_vs_roic_stable={m/c.roic_stable-1:+.1%}  rev10={r.revenue[-1]:.1f} ebit10={r.ebit[-1]:.1f}')
"
```

Expected: pre EV **1320.79**, pre `marginal_roic` **0.479486**, pre intensity **+45.3%** (inside the engine's 60% tolerance). Post unchanged at EV **1309.85**, `marginal_roic` **0.371484**. **`rev10` must read 320.0 / 400.0 and `ebit10` 151.0 / 158.5** — if any of the four moved, stop and report, because sales-to-capital must not touch the revenue or margin paths.

- [ ] **Step 7: Update the pinned enterprise values**

In `tests/core_finance/test_segment_valuation_spacex.py`, `test_seeded_pair_enterprise_values` asserts `pre.enterprise_value == pytest.approx(1323.37, abs=0.5)`. Change it to the measured **1320.79**. Leave the post assertion at 1309.85.

Update that test's docstring: it currently reads "post (1309.85) < pre (1323.37)". Change the pre figure, keep the statement that the model produces the direction **opposite** to the source, and add one sentence recording that removing the unsupported late-ratio lowering narrowed the gap from −13.5 to −10.9 without flipping it — so a reader does not mistake the change for an attempt at the sign.

- [ ] **Step 8: Update the terminal-ROIC spec's stale figures**

In `docs/superpowers/specs/2026-08-10-terminal-roic-consistency-design.md`, four figures move. Replace them with the measured values and mark the change dated 2026-08-11:

- line ~215, the §2.5 table row: `| pre-prospectus | 0.4961 | **0.33** | +50.3% | **1323.37** | 1210 |` → marginal ROIC **0.4795**, intensity **+45.3%**, EV **1320.79**.
- line ~228: `1323.37 → 1309.85` → `1320.79 → 1309.85`.
- line ~235: the parenthetical `1323.7 → 1323.37, post 1295.9 → 1309.85` → pre now `1320.79`.
- line ~298: "the pre-prospectus **1323.37** against 1210" → **1320.79**.

- [ ] **Step 9: Record the incompatibility and fix a dangling path**

Two edits to `guideline/sop/todo.md`.

**First**, `guideline/sop/todo.md:426` points at `.superpowers/sdd/2026-08-11-growth-curve-near-term/` for the growth-curve plan and design. That directory is deleted — it was scratch, removed when the plan closed. Repoint it at the durable locations: `docs/superpowers/specs/2026-08-10-growth-curve-near-term-design.md` and `docs/superpowers/plans/2026-08-11-growth-curve-near-term.md`.

**Second**, the "Known divergences from the source" section lists three items and does **not** include the pre/post enterprise-value direction, which currently lives only in a test docstring. Add it as item 4, with the quantitative finding rather than a bare statement of disagreement:

```markdown
4. **The pre/post enterprise-value direction runs opposite to the source, and
   cannot be corrected within the source's own confirmed constraints.** todo3
   section 3 records enterprise value rising slightly, $1.21T -> $1.22T. The
   model has it falling: pre 1320.79, post 1309.85.

   Investigated 2026-08-11 rather than assumed. An input-by-input attribution
   from pre to post shows the individual effects summing to +154 against an
   actual move of -13.5, so interactions dominate: doubling AI's revenue target
   while halving its margin leaves target-year AI EBIT nearly unchanged
   (36 -> 40) but roughly doubles the capital needed to reach it from a 0.1
   base, and that does not cancel.

   The sign turns on one input. Sweeping the pre-case sales-to-capital ratios
   as a multiple of the post values: 1.00 (no lowering at all) gives +8.07,
   1.05 gives +0.83, the seeded values give -13.5, 1.10 gives -5.74. The sign
   flips at roughly a 6% lowering -- and todo3 I2 confirms `[C]` that he DID
   lower them, so any consistent value produces a falling EV. Reproducing the
   source's +10 would require he raised them.

   So the source's confirmed input and its reported outcome are mutually
   inconsistent under this template. Note also that the source's own move is
   +0.8%, smaller than the uncertainty on any single `[V]` input -- the
   sales-to-capital sweep alone spans 22 points of enterprise value. No
   reconstruction at this fidelity can meaningfully reproduce the sign of a
   move that small, so this is recorded rather than fitted.

   Two hypotheses were tested and rejected: raising AI's base revenue (holding
   the corroborated 15.6 total) makes the gap *worse*, -13.5 -> -26.8 at a base
   of 3.0, because base revenue moved into the low-return segment comes out of
   the high-return ones; and a per-case terminal-ROIC policy was already known
   worse for this metric, giving a pre/post ratio of 0.908 against a shared
   value's 0.978.

   Design: `docs/superpowers/specs/2026-08-11-sales-to-capital-late-scope-design.md`.
```

Also amend divergence item 1's closing note if it claims the growth-curve work addressed the direction — it did not; it narrowed the gap from −27.8 to −13.5 as a side effect.

- [ ] **Step 10: Run the full suite**

Run: `python -m pytest tests -q`
Expected: **656 passing** (653 baseline plus 3 new). No failures.

- [ ] **Step 11: Commit**

```bash
git add apps/api/services/valuation_seed.py tests/core_finance/test_segment_valuation_spacex.py tests/api/test_valuation_seed.py docs/superpowers/specs/ guideline/sop/todo.md
git commit -m "fix: stop lowering a sales-to-capital ratio todo3 never says was lowered"
```

---

## Self-Review Notes

**Spec coverage.** §2.1 (the correction, with AI and expansion explicitly excluded) → Steps 3 and 5, gated by all three tests in Step 1. §2.2 (per-segment narrative text, tags unchanged) → Step 4. §2.3 (record the incompatibility) → Step 9. §2.4 (measured effects) → Steps 6, 7, 8. §3 gates map to: 1 → `test_late_sales_to_capital_is_unchanged...`; 2 → `test_early_sales_to_capital_still_carries_the_confirmed_lowering`; 3 → `test_ai_late_sales_to_capital_is_still_lowered`; 4 → the `marginal_roic` gate updated in Step 5; 5 → both cases running at all in Step 6; 6 and 7 → Step 6's explicit check; 8 → the seed's own narrative-rule test, which fails if a claim goes missing.

**Two defects this plan fixes that the spec did not name**, both found while locating exact edit sites: the dangling `.superpowers/sdd/` path at `todo.md:426`, and the fact that the pre/post direction was never actually in `todo.md`'s divergences list despite being described as recorded there. Both in Step 9.

**Type consistency.** No new names are introduced. The three replacement claim constants (`_PRE_S2C_LATE_UNCHANGED`, `_PRE_S2C_LATE_AI`, `_PRE_S2C_LATE_EXPANSION`) are referenced only in Step 4, where they are defined and wired at the same time.

**One thing a reviewer should NOT flag.** The gap remains negative (−10.94) and the sign does not flip. That is the spec's stated outcome, not an incomplete fix — §1.1 establishes the sign cannot be corrected without contradicting a `[C]` input.
