Here's the summary formatted as a clean English markdown code block:

````markdown
# Product Decision Analysis: Three Key Decisions

## Context
Previous decision: **Persisted snapshots (default) + Partial weights with implied cash**
- Portfolio View → actual investment testing & tracking
- Watchlist View → simple comparison of stocks of interest

All three new decisions align with the above architecture. Recommendation: **proceed with "Yes" on all three**.

---

## Decision 1 — Comparison Universe: Watchlist only vs. Expanded

**Recommendation: Expand beyond current watchlist holdings**

Proposed universe: `Watchlist + Portfolio + Benchmark (market index / sector / full ticker)`

**Why expand:**
- Comparing expected return vs. market return requires benchmarks (e.g., KOSPI, S&P 500, sector ETFs) — watchlist alone is insufficient
- Portfolio View default: `my portfolio + benchmark`
- Watchlist View default: `watchlist + selected benchmark`
- Historical snapshots gain value: "my portfolio vs. market on that date" comparisons become possible

**Risk of limiting to watchlist only:**
- Cannot answer the core question: "How does my portfolio perform vs. the market?"
- Undermines the "market risk consideration" goal

**Follow-up implementation:**
1. Universe selector UI (dropdown/toggle):
   - My Portfolio only
   - Portfolio + Benchmark *(recommended default)*
   - Watchlist + Benchmark
   - Custom universe (manual ticker input)
2. Default benchmarks for Korean users: KOSPI + KOSDAQ + 3–4 sector ETFs
3. Add `comparison_universe` field to daily snapshots for reproducible historical comparisons

---

## Decision 2 — Deterministic E2E Mocking: High-churn pages only vs. All pages

**Recommendation: Extend to all major pages**

**Why extend:**
- The Portfolio page now has complex logic: snapshot + partial weights + daily metric refresh → flaky tests will multiply without deterministic mocking
- Expanding Portfolio View / Watchlist View separation naturally widens the test surface
- Establishing coverage now reduces long-term maintenance cost

**Risk of limiting to high-churn pages only:**
- Bugs in Dashboard, Comparison Report, History pages go undetected
- Lower CI/CD reliability → higher risk of post-deployment UX issues

**Follow-up implementation:**
1. Shared core fixtures:
   - `snapshot_2026-04-10.json`
   - `portfolio_partial_weights.json`
   - `benchmark_universe.json`
2. Per-page mock files: `portfolio_page.mock.ts`, `watchlist_page.mock.ts`, etc.
3. Enforce `cy.useDeterministicMock()` custom command across all e2e tests
4. Rollout priority:
   1. Portfolio page
   2. Dashboard
   3. History / Snapshot timeline
   4. Watchlist page

---

## Decision 3 — Portfolio Page: Surface Latest Comparison Snapshot vs. Separate Page/Modal

**Recommendation: Surface directly on the Portfolio page**

Proposed placement: **"Latest Snapshot Summary" card at the top of the Portfolio page**

**Why surface directly:**
- Matches the core goal: "see everything at a glance"
- Users need ROIC-WACC, DCF, and expected return vs. market immediately upon landing — no extra clicks
- With persisted snapshots as the default, the latest snapshot *is* the official daily record → surfacing it immediately is the most natural UX

**Risk of moving to a separate page:**
- Users cannot see "today's portfolio status" at a glance → extra clicks degrade UX
- Snapshot record and current portfolio state feel disconnected

**Follow-up implementation:**
1. UI layout:
   - Top: Latest Snapshot Summary card (date + Total Expected Return vs. Market + avg ROIC-WACC + avg DCF)
   - Top-right: "Switch to Live mode" button + "Save current as snapshot" button
   - Below: Partial weights table (including cash)
2. Click actions:
   - Click summary card → open Snapshot History timeline modal
   - "View full comparison" button → detailed comparison table (with expanded universe)
3. Performance: latest snapshot served via Redis or indexed DB view (target: <1s load)

---

## Summary Table

| Decision | Recommendation | User Preference | Architectural Fit |
|---|---|---|---|
| Comparison universe | Expand beyond watchlist | Yes | Extends Portfolio View default universe |
| Deterministic e2e mocking | Extend to all pages | Yes | Handles snapshot + weights complexity |
| Portfolio snapshot summary | Surface directly on page | Yes | Core to daily metric testing workflow |

## Implementation Priority

1. **This sprint:** Decision 3 (snapshot surface) + Decision 1 (universe UI)
2. **Next sprint:** Decision 2 (e2e mocking expansion) — test stability should be established before shipping more features
````