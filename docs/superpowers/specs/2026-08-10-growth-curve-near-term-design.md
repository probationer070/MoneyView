# Near-Term Growth Curve — Design

Date: 2026-08-10
Status: draft, pending review
Closes: the "near-term growth runs the wrong way" divergence recorded in
`guideline/sop/todo.md` under the Segment Build-Up Valuation track.
Branch: `feat-statements-acquisition` (updates PR #4 in place).

---

## 1. Problem

`guideline/sop/todo3.md` R3 tags as **`[C]` confirmed** that Damodaran's headline
revision between the April and June valuations was to **slow near-term growth** for
launch and connectivity. §4 supplies the confirmed 2025 actuals that drove it:

| Segment | confirmed 2025 growth |
| --- | --- |
| launch | **+7.64%** |
| connectivity | **~+50%** |
| ai | **~+22%** |
| *total* | ***+33%*** |

The engine contradicts every one of them. Its revenue path is

```
g_t = g₁ − (g₁ − g_stable)·(t−1)/(n−1)
```

with `g₁` solved by bisection to hit the target-year revenue. That is **one free
parameter fixed by one condition**, so year-1 growth is entirely determined by the
endpoint — it cannot also be set. The arithmetic consequence is that year 1 is
*structurally* the fastest year of every segment, forever. Measured: launch grows
**+63.8%** in year 1 against a confirmed **+7.64%** actual, and the consolidated path
runs **+55%** against a confirmed **+33%**.

So the model does not merely fail to slow near-term growth. It accelerates it, in a
reconstruction whose confirmed headline behaviour is the opposite, and it discards
four confirmed data points to do so.

Slowing the near term requires a **two-parameter** growth family: one parameter to
hit the target, one to set the start.

---

## 2. Design

### 2.1 Why not a logistic, despite the source recommending one

todo3 §2.1 lists three interpolation options and says of the third — *"Logistic /
S-curve on market share … this is the one I'd build."* Two reasons it is not what
gets built here, the second decisive.

**Coverage.** A logistic on *market share* needs an exogenous TAM path. todo3 §3
gives TAM at two endpoints for launch and connectivity only; `ai` and `expansion`
carry `revenue_target` directly and have no TAM at all. The recommendation covers two
of four segments.

**It reintroduces the defect this codebase just spent three review rounds removing.**
A logistic on revenue, normalized to hit the target and steepened until year-1 growth
matches the observed actual, **saturates**. Measured on the launch segment at the
steepness that yields ~7.64% in year 1:

| steepness `k` | year-1 growth | peak growth | **year-10 growth** |
| --- | --- | --- | --- |
| 0.6 | 63.48% | 63.74% | 3.86% |
| 0.9 | 25.65% | 76.78% | 1.53% |
| **1.2** | **9.19%** | 103.99% | **0.54%** |
| 1.6 | 2.13% | 144.47% | 0.12% |

The explicit period would end at **0.54%** growth while the terminal value assumes
`g_stable = 4.56%` in perpetuity — an unmodelled discontinuity at the year-10
boundary, structurally identical to the terminal-ROIC defect corrected in
`2026-08-10-terminal-roic-consistency-design.md`. A curve that pins only one endpoint
cannot be used with a perpetuity that assumes the other.

### 2.2 The curve

A linear ramp between **two pinned endpoints**, plus a hump with one solved amplitude:

```
g_t = g_init + (g_stable − g_init)·(t−1)/(n−1) + a · sin(π·(t−1)/(n−1))
```

- `g(1) = g_init` and `g(n) = g_stable` hold **by construction** — `sin` vanishes at
  both ends, so neither endpoint depends on `a`.
- `a` is solved by bisection so `Π_t (1 + g_t) = target_revenue / base_revenue`.

Three conditions, three satisfied: start, end, and endpoint revenue.

**Why bisection still works.** `sin(π·(t−1)/(n−1)) ≥ 0` across the interval, so
`d/da Π(1+g_t) = Σ_t [ sin_t · Π_{s≠t}(1+g_s) ] ≥ 0` — the product is monotone in `a`.
Same technique, same argument and same 200-step loop as the existing
`_solve_first_year_growth`. No new dependency.

That derivative argument holds **only while every factor `(1 + g_t)` stays positive**,
so the bisection bracket must be chosen to guarantee it rather than assumed.

The linear term never falls below `min(g_init, g_stable)`, and `sin ≤ 1`, so for
`a < 0` the deepest point satisfies `g_t ≥ min(g_init, g_stable) + a`. Keeping that
above `−1` requires

```
a_low = −0.99 − min(g_init, g_stable)
```

which pins the trough at exactly `−0.99` for any `min`. The implementation must
compute this rather than hardcode `−0.99`.

*(Corrected during planning. This section first gave `−0.99 + min(g_init, g_stable)`,
which is safe only for non-negative growth: at `min = −0.5` it yields a trough of
`−1.99`, a negative growth factor, and a solver whose monotonicity precondition no
longer holds. `initial_growth ≤ −1` must also be rejected outright.)*

**Negative `a` is allowed and is not an error.** A segment whose observed growth
already overshoots what the endpoint needs gets a dip rather than a hump. The
existing "unreachable ratio" error still fires when no `a` in the bracket works.

### 2.3 What the curve does on the seeded data

| Segment | base → target | geometric mean | `g_init` | solved `a` | peak | year 10 |
| --- | --- | --- | --- | --- | --- | --- |
| launch | 4.1 → 70 | 32.8% | 7.64% | 0.493 | 54.8% | 4.56% |
| connectivity | 11.4 → 120 | 26.5% | 50.00% | **0.002** | 50.0% | 4.56% |
| ai | 0.1 → 160 | 109.1% | 22.00% | 1.911 | **202.4%** | 4.56% |

Two things worth reading off that table.

**Connectivity's hump solves to ~zero.** A linear decay from its observed 50% to
`g_stable` already compounds to its target, so the new machinery does nothing there.
A curve family that intervenes only where the data does not already fit is behaving
like a model rather than a fit.

**AI's hump peaks at 202%.** That is not a flaw in the curve; it is the arithmetic of
a base of `0.1` growing to `160`, which demands a 109% geometric mean. The smooth
decay concealed it inside a monotone path. `0.1` is the seed's weakest input — the one
todo3 §4's own evidence contradicts, since that segment reinvested `$14.2bn` in 2025
against `$0.1bn` of revenue. **Reported, not guarded against**: an arbitrary
plausibility ceiling would suppress exactly the signal this makes visible. The
per-segment revenue path is already exposed through `/run`, so peak growth is
derivable by any consumer.

### 2.4 Inputs

One nullable field, `initial_growth`, on `SegmentSpec` and one nullable `REAL` column
on `segment`.

- `None` → the existing decaying curve runs **unchanged**. Every current test, and any
  case already stored, keeps its exact behaviour. This is the backward-compatibility
  guarantee, and §3 gates it.
- Set on a segment with `base_revenue = 0` (a ramp) → **raises**. The two path shapes
  are mutually exclusive; a ramped segment has no year-1 growth rate to pin.

`initial_growth` joins `NARRATED_FIELDS`, so it requires a narrative row. That is the
point rather than an obligation: these are todo3 §4's confirmed actuals, so they seed
as `confidence='confirmed'`, `three_p='probable'` — the **first confirmed
segment-level inputs in the seed besides TAM and market share**.

### 2.5 Seeded values

| Segment | `initial_growth` | source |
| --- | --- | --- |
| launch | `0.0764` | todo3 §4, confirmed |
| connectivity | `0.50` | todo3 §4, confirmed ("~+50%") |
| ai | `0.22` | todo3 §4, confirmed ("~+22%") |
| expansion | `NULL` | ramped segment, no year-1 growth |

Both cases take the same values — these are FY2025 actuals and do not differ between
the April and June valuations.

Consolidated year-1 growth becomes **+38.7%**
(`(4.1×1.0764 + 11.4×1.50 + 0.1×1.22) / 15.6 − 1`), against **+55%** today and todo3's
confirmed **+33%**. Closer but not equal, and the residual is diagnostic rather than
noise: it comes from the base-revenue *split* across segments, which
`2026-08-10-terminal-roic-consistency-design.md` and the seed's own narratives already
record as an assumption. Only the ~15.6 total is derived; 4.1 / 11.4 / 0.1 is not.

---

## 3. Verification

**Gated:**

1. `revenue_path` with `initial_growth` set produces year-1 growth equal to it
   exactly, and year-n growth equal to `g_stable` exactly. Both to `1e-12` — they hold
   by construction, so a loose tolerance would hide an implementation that only
   approximates them.
2. The path still compounds to `target_revenue` within `1e-9`, for both curve shapes.
3. **Backward compatibility:** `initial_growth = None` reproduces the current path
   element-for-element. Assert against the existing decaying curve's output, not
   against hardcoded numbers.
4. `initial_growth` set on a segment with `base_revenue = 0` raises, with a message
   naming the segment and both values.
5. A segment whose observed growth overshoots its endpoint solves to a **negative**
   `a` and still hits the target — the dip case, so the sign is not accidentally
   constrained.
6. Seeded target-year totals unmoved: **400.0 / 158.5** post, **320.0 / 151.0** pre.
   These depend only on the endpoint, which both curves hit by construction.
7. The narrative rule rejects a seeded case that sets `initial_growth` without a claim.
8. Consolidated year-1 growth on the post case is **+38.7%** (±0.1pp), pinned so a
   regression toward the old +55% fails loudly.

**Recorded, not gated:** the new enterprise values, per-share figures and terminal-value
shares for both seeded cases, and the per-segment solved `a` and peak growth. Every
seeded valuation figure moves — this is the fourth revision of those numbers — and the
figures in `guideline/sop/todo.md` and the two prior specs must be updated to match
rather than left stale.

---

## 4. Out of scope

**The pre/post EV direction.** The model produces enterprise value *falling* from the
pre- to the post-prospectus case where todo3 §3 records it rising slightly
($1.21T → $1.22T). This change alters both numbers and may or may not alter the sign;
it is not aimed at that discrepancy, which stays recorded in `guideline/sop/todo.md`.

**The base-revenue split.** 4.1 / 11.4 / 0.1 remains an assumption. This design makes
its consequences more visible (§2.3) but does not correct it, and correcting it would
mean inventing a different split with no better support.

**`base_margin`'s R&D-basis contradiction**, case-level narratives, and API
update/delete endpoints — all unchanged and still recorded.
