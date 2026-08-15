# todo2 — open work only

Session-start index for branch `feat-statements-acquisition`. Last updated 2026-08-09.

Everything here is meant to be **unfinished**. Completed work belongs elsewhere —
`guideline/sop/todo.md` is the durable record, `ERROR-LOG.md` the defect record, and
`.superpowers/sdd/*/progress.md` the per-project ledgers.

This file used to claim it "copies nothing from them, so it cannot go stale by contradiction."
That was wrong, and worth keeping the correction visible: on 2026-08-06 four of the six items
in section 3 were already fixed. It had copied their *conclusions* rather than their text,
which stales exactly the same way — the sdd ledgers record what was true when a sub-project
closed and are never revisited. **Check the code before believing any line here.**

Read this first, pick a section, then open the one file it points you at.

---

## 1. Nothing in flight

Everything this file used to track as in-progress is merged. `origin/renewal` is at
`ad23238` and `git log origin/renewal..HEAD` is empty; the working tree is clean.

Merged 2026-08-06 via PR #2 (`8c37139`) and PR #3 (`ad23238`):

- Removal of the Success Probability score, the Minard segment model, the composite Health
  Score and the Company Status radar, closing the last Phase 3 item.
- Non-finite floats render as `null` at the web boundary instead of 500ing
  (`apps/api/core/responses.py`).
- `external.*` span time split into CPU and wait, closing the perf-instrumentation track at
  74 of 74.
- All eight Task 11 findings that had been deferred to a whole-branch review: seven fixed,
  one (`selectVisibleStocks` call count) closed as won't-do.
- README restructured.

Last verified: 504 backend tests, 99 Playwright chromium, `tsc` exit 0.

---

## 2. Things that bit before, worth knowing before you start

- **Push to `origin` only.** The `gitea` remote's URL carries a credential token in cleartext in
  `.git/config`. Worth raising with the repo owner separately; don't exercise it.
- **Playwright ports collide across sessions.** `apps/web/playwright.config.ts` sets
  `reuseExistingServer: false` for both web (3101) and API (8110), so two sessions running the
  suite kill each other's servers — a run dies mid-flight with `ERR_CONNECTION_REFUSED` and
  looks like a code failure. Check the ports are free before starting.

```bash
netstat -ano | grep -E ":3101 |:8110 " | grep LISTENING
```

- **A backgrounded `playwright | tail` reports the exit code of `tail`, not Playwright.** One run
  this session reported "exit code 0" with an empty output file, which is no evidence at all.
  Redirect to a file and record `$?` from Playwright itself.
- **Trackers in this repo go stale silently.** Four separate times on 2026-08-06 a tracker
  claimed work was outstanding when the code said otherwise — four items in section 3 below,
  and three `ERROR-LOG.md` entries whose `Fix:` line still read "Not fixed" long after the fix
  landed under a different task. Check the code before believing any of them, including this
  file.

Ledger for the tile-grid sub-project (gitignored, local only):
`.superpowers/sdd/2026-07-31-portfolio-tile-grid-and-news-acquisition/progress.md`

---

## 3. Deferred — known, consciously not done

Re-verified against the code 2026-08-06, and again on 2026-08-09. **Five of the six items this
section used to list were already fixed.** One remains, and it is cosmetic:

- `packages/shared-types/generated/portfolio.ts` is still stale — last regenerated `eb46613`
  (2026-04-12). **The dangerous half of this was fixed in `1c4882f`**: it declared
  `CorporateComparisonHistoryPoint`, the barrel re-exported it, and it silently shadowed the
  correct hand-written type. That definition now lives once in `packages/shared-types/portfolio.ts`
  and is pinned by an explicit re-export, guarded by
  `apps/web/tests/types/shared-types-contract.ts`.

  What remains is cosmetic: other interfaces in the generated file may also lag the backend
  models. Regenerating needs network — `scripts/export_schema.py` runs offline but the
  `npx json2ts` half does not, and `json2ts` is installed in neither `node_modules` tree.
  The root cause is that nothing enforces regeneration: no CI, no hook, and the drift check
  the README documents (`git diff --exit-code packages/shared-types`) is never run.

Closed since the ledgers were written, with where to see it:

- `metric_schema_version` on the history point — `corporate.py:354` carries it with the
  enterprise-value/per-share boundary documented in place, `packages/shared-types/portfolio.ts`
  declares it on the frontend side (moved there from `portfolio/page.tsx` in `1c4882f`),
  `SnapshotHistoryModal.tsx` renders the boundary notice and a version badge, and
  `snapshot-history-metric-version.spec.ts` pins both directions.
- `bridge_quality` wired into the frontend — declared in `CorporateComparisonTable.tsx:20`,
  `graphs/shared.ts:60`, `TargetStockComparisonSection.tsx:33`, `corporateTypes.ts:144`, with
  `apps/web/lib/bridgeQuality.ts` as the single discriminator.
- `StockTile` content model — the button is all `<span>`, no flow content (`bc5e06a`, `c7da4e8`).
- `PortfolioAllocationEditor.tsx` imports `PortfolioStock` instead of cloning it (`83d74b5`).
- The 0-edge notice over-claim — fixed in `7617360`. `SnapshotHistoryModal.tsx` carries both
  variants: "Metric definition changed…" for a real version change, and "Metric definition
  before this point was not recorded, so whether values are comparable across it is unknown."
  when the earlier side is version 0. `snapshot-history-metric-version.spec.ts:133-140` pins
  each literally and asserts placement, so neither can stand in for the other.

  This one was listed as open until 2026-08-09 because of a bad check, not a stale ledger:
  `grep -c "Metric definition changed"` returned 1, which was read as "only one variant
  exists". The count of one string says nothing about whether a differently-worded second
  variant exists — and it did, eight lines away. Counting a string is not the same as
  checking a behaviour.

---

## Conventions worth knowing before you start

- `CLAUDE.md` §5 — consult the matching SOP in `guideline/sop/` before and after a change.
- `CLAUDE.md` §7 — a confirmed bug gets an `ERROR-LOG.md` entry, silent failures included.
- No frontend unit-test runner exists. `apps/web/package.json` defines only `test:e2e`
  (Playwright). Don't add Jest or Vitest.
- `tests/conftest.py::_forbid_network` fails any backend test that reaches the network.
- Missing values stay missing — `guideline/sop/finance-logic.md` prohibits substituting `0.0`
  or `""` for an absent figure.
