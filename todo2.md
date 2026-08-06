# todo2 — open work only

Session-start index for branch `feat-statements-acquisition`. Last updated 2026-08-06.

Everything here is **unfinished**. Completed work is not recorded here — `guideline/sop/todo.md`
stays the durable record, `ERROR-LOG.md` the defect record, and `.superpowers/sdd/*/progress.md`
the per-project ledgers. This file only points at those; it deliberately copies nothing from
them, so it cannot go stale by contradiction.

Read this first, pick a section, then open the one file it points you at.

---

## 1. In flight — complete and verified, not yet committed

**Removing the composite Health Score and the Company Status radar.** Started in `952d487`
(which removed the Success Probability score and the Minard segment model); the working tree
carries the second removal. This closes the last open Phase 3 item in `guideline/sop/todo.md`.

**No plan or spec exists for this one** — it is an ad-hoc continuation, not an SDD run. Don't go
looking for a brief.

Finished 2026-08-06. Code, docs and records are all done; the only open step is the commit.

```bash
git status --short
cd apps/web && npx tsc --noEmit                        # clean
python -m pytest tests/core_finance/ tests/api/ -q     # 491 passed
cd apps/web && npx playwright test --project=chromium  # 91 passed
```

Two things worth knowing if you revisit it:

- Two `refresh-idle-state.spec.ts` tests failed on the first real suite run. Not a product bug:
  they used `/Microsoft: life cycle/i` as a "MSFT is selected" marker, borrowing wording from
  the page subtitle that this removal rewrote. Marker now matches the current subtitle.
  `952d487` was committed with `tsc` green and Playwright never run, which is how a UI-string
  change got past.
- `Minard` survives in exactly one place on purpose —
  `CorporateComparisonTable.tsx:115`, a comment explaining why that cell is now plain text —
  plus the `FORBIDDEN_LABELS` guards in the two absence specs. Those are the record, not
  leftovers. `regionalMinard` was renamed to `regionalHurdle`; it was the Hurdle Rate
  Decomposition dataset wearing a deleted model's name.

---

## 2. PR #2 open, awaiting review

Pushed and PR'd 2026-08-06: https://github.com/probationer070/MoneyView/pull/2
(`feat-statements-acquisition` → `renewal`, 99 commits, 124 files, +17.4k/−2.2k).
Nothing left to do here but get it reviewed.

**Local `renewal` is 4 commits ahead of `origin/renewal`** and was never pushed —
`c4bfe5b`, `7c4be80`, `71ce96c` (the statements-acquisition design and plan docs) and `0e4a3c1`
(statement cache TTL/maxsize, with a test and an ERROR-LOG entry). They are ancestors of this
branch, so PR #2 carries them in on merge; nothing is lost if you leave them. But anyone
pulling `renewal` today does not have that fix.

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

Re-verified against the code 2026-08-06. **Four of the six items this section used to list were
already fixed** — the sdd progress ledgers they were copied from had gone stale, which is the
failure mode this file exists to avoid. Two remain, neither blocking:

- `packages/shared-types/generated/portfolio.ts` is stale — last regenerated `eb46613`
  (2026-04-12), so it is missing `metric_schema_version` and the new nullability. Inert: nothing
  imports it on the paths that changed, and the hand-written types carry the fields. Regenerating
  needs network.
- The snapshot-history notice reads "Metric definition changed" where the honest claim at a
  0-edge is "provenance unknown" (`SnapshotHistoryModal.tsx:67-72`). A second notice variant plus
  its test was judged more churn than the over-claim costs. Open, deliberately.

Closed since the ledgers were written, with where to see it:

- `metric_schema_version` on the history point — `corporate.py:354` carries it with the
  enterprise-value/per-share boundary documented in place, `portfolio/page.tsx:195` declares it,
  `SnapshotHistoryModal.tsx` renders the boundary notice and a version badge, and
  `snapshot-history-metric-version.spec.ts` pins both directions.
- `bridge_quality` wired into the frontend — declared in `CorporateComparisonTable.tsx:20`,
  `graphs/shared.ts:60`, `TargetStockComparisonSection.tsx:33`, `corporateTypes.ts:144`, with
  `apps/web/lib/bridgeQuality.ts` as the single discriminator.
- `StockTile` content model — the button is all `<span>`, no flow content (`bc5e06a`, `c7da4e8`).
- `PortfolioAllocationEditor.tsx` imports `PortfolioStock` instead of cloning it (`83d74b5`).

---

## Conventions worth knowing before you start

- `CLAUDE.md` §5 — consult the matching SOP in `guideline/sop/` before and after a change.
- `CLAUDE.md` §7 — a confirmed bug gets an `ERROR-LOG.md` entry, silent failures included.
- No frontend unit-test runner exists. `apps/web/package.json` defines only `test:e2e`
  (Playwright). Don't add Jest or Vitest.
- `tests/conftest.py::_forbid_network` fails any backend test that reaches the network.
- Missing values stay missing — `guideline/sop/finance-logic.md` prohibits substituting `0.0`
  or `""` for an absent figure.
