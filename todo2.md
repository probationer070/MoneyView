# todo2 — open work only

Session-start index for branch `feat-statements-acquisition`. Last updated 2026-08-06.

Everything here is **unfinished**. Completed work is not recorded here — `guideline/sop/todo.md`
stays the durable record, `ERROR-LOG.md` the defect record, and `.superpowers/sdd/*/progress.md`
the per-project ledgers. This file only points at those; it deliberately copies nothing from
them, so it cannot go stale by contradiction.

Read this first, pick a section, then open the one file it points you at.

---

## 1. In flight — uncommitted, finish this first

**Removing the Success Probability score and the Minard segment model.** Started in `952d487`;
the working tree carries the rest. Almost pure deletion: 11 files, ~170 deletions to ~11
insertions, `CompanyStatusGraph.tsx` staged for deletion, plus one untracked new spec
`apps/web/tests/e2e/corporate-composite-score.spec.ts` (66 lines).

**No plan or spec exists for this one** — it is an ad-hoc continuation, not an SDD run. Don't go
looking for a brief.

Not done yet: five files still reference the removed model.

```
apps/web/app/corporate/buildCalculationDetails.ts
apps/web/app/corporate/components/CorporateComparisonTable.tsx
apps/web/app/corporate/components/CorporateDiagnosticsSection.tsx
apps/web/app/corporate/components/graphs/HurdleRateDecompositionGraph.tsx
apps/web/app/corporate/corporateDerivedViews.ts
```

State check:

```bash
git status --short
grep -rln "Minard\|successProbability\|success_probability" apps/web/app/corporate/
cd apps/web && npx tsc --noEmit          # passed as of 2026-08-06
python -m pytest tests/core_finance/ tests/api/ -q   # from repo root
cd apps/web && npx playwright test --project=chromium   # NOT run against this tree
```

The e2e suite has **not** been run against these changes. Four e2e specs are modified in the
working tree, so treat their status as unknown, not passing.

---

## 2. Unpushed — 66 commits, no PR

93 commits ahead of `renewal`, 66 never pushed. The portfolio tile-grid + news-acquisition
sub-project is complete and reviewed but was never pushed or PR'd; that step is still open.

```bash
git log --oneline origin/feat-statements-acquisition..HEAD | wc -l
git push -u origin feat-statements-acquisition
gh pr create --base renewal --head feat-statements-acquisition
```

Two things that bit before:

- **Push to `origin` only.** The `gitea` remote's URL carries a credential token in cleartext in
  `.git/config`. Worth raising with the repo owner separately; don't exercise it.
- **Playwright ports collide across sessions.** `apps/web/playwright.config.ts` sets
  `reuseExistingServer: false` for both web (3101) and API (8110), so two sessions running the
  suite kill each other's servers — a run dies mid-flight with `ERR_CONNECTION_REFUSED` and
  looks like a code failure. Check the ports are free before starting, and don't run the suite
  while another session is running one.

```bash
netstat -ano | grep -E ":3101 |:8110 " | grep LISTENING
```

Ledger for that sub-project: `.superpowers/sdd/2026-07-31-portfolio-tile-grid-and-news-acquisition/progress.md`

---

## 3. Deferred — known, consciously not done

None of these block anything. Each is already written up where it belongs; listed here only so
they are not rediscovered from scratch.

**From `.superpowers/sdd/2026-08-03-dcf-data-completeness/progress.md` (see its "Open, surfaced
to the user, NOT fixed"):**

- `dcf_value` changed units mid-series — a resolved row stores per-share where the same ticker
  previously stored enterprise value, and `CorporateComparisonHistoryPoint` carries no
  `metric_schema_version`, so the history chart draws the discontinuity as a valuation move.
- `bridge_quality` is persisted and returned but no comparison-table frontend type declares it,
  so the spec's own mitigation — a flag saying the number is not comparable — is unwired.
- `packages/shared-types/generated/portfolio.ts` is stale on the new nullability. Inert;
  regenerating needs network.

**From `.superpowers/sdd/2026-08-03-comparison-value-honesty/progress.md`:**

- The notice reads "Metric definition changed" where the honest claim at a 0-edge is "provenance
  unknown". A second notice variant plus its test was judged more churn than the over-claim
  costs. Open, deliberately.

**From `guideline/sop/todo.md` (Follow-ups — Portfolio Tile Grid section):**

- `StockTile` still nests `<div>`s inside its `<button>` via `DeltaBadge` and the chart wrapper.
  Browsers don't auto-correct it, so nothing renders wrong; fixing it means letting those shared
  components render a `<span>`.
- `PortfolioAllocationEditor.tsx` clones the `PortfolioStock` type instead of importing it.

---

## Conventions worth knowing before you start

- `CLAUDE.md` §5 — consult the matching SOP in `guideline/sop/` before and after a change.
- `CLAUDE.md` §7 — a confirmed bug gets an `ERROR-LOG.md` entry, silent failures included.
- No frontend unit-test runner exists. `apps/web/package.json` defines only `test:e2e`
  (Playwright). Don't add Jest or Vitest.
- `tests/conftest.py::_forbid_network` fails any backend test that reaches the network.
- Missing values stay missing — `guideline/sop/finance-logic.md` prohibits substituting `0.0`
  or `""` for an absent figure.
