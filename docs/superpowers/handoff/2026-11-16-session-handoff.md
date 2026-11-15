# Session handoff — 2026-11-16

Read this first when continuing in a new session. Branch `renewal`, last commit at writing
`878e468`, working tree clean. Owner language: Korean (reply in Korean; repo docs stay English).

## 1. State

All work below is committed. The last full runs, after S3d (2026-11-16):
- **Full pytest:** 2806 passed, 0 failed.
- **Full Playwright:** 1031 passed, 0 failed, 26 skipped.

**Done this session.** Details and commit hashes are in [`guideline/sop/todo.md`](../../../guideline/sop/todo.md), Track N.

**Top nav and portfolio redesign.** Plan `docs/superpowers/plans/2026-11-15-nav-portfolio-redesign.md`, owner decisions D1-D17.
- **Nav:** labels slide out on hover; ☰ opens a 4-group panel.
- **Portfolio page:**
  - two tabs, Stocks and Weights;
  - a card/table toggle and an add-stock modal;
  - an export menu, holdings as CSV or print;
  - fits one screen.
- **Removed:**
  - the Attribution tab (D16);
  - the snapshot features;
  - the right rail.

**Translation (i18n).** Most English copy now has en/ko catalog entries. Covered:
- the cases, decisions and corporate pages;
- the corporate calculation details;
- the portfolio page and its helpers.

**WACC/Ke live premia, S1-S4 (+S3c, S3d), complete.**
- **Design:** `docs/superpowers/specs/2026-11-16-wacc-ke-live-premia-design.md` (§6 has the owner answers).
- **Plan:** `docs/superpowers/plans/2026-11-16-wacc-ke-live-premia.md`, which includes the owner approvals.
- **What it does:**
  - **Inputs:** rf, ERP and CRP come from `apps/api/services/market_assumptions.py`, which reads the `market_assumptions` table and DGS10 from `fred_cache`. A DGS10 value older than 7 days falls back to the owner value.
  - **One formula:** Ke is a single CAPM function used everywhere.
  - **Refusal:** with no rf or ERP available, the response is `assumptions_missing` (`wacc: null`).
  - **UI:** shows source and as-of, a stale badge, and the refusal reason.
  - **Owner routes:** `GET/PUT /api/v1/market-assumptions` (append-only).
  - **Drift report:** `scripts/report_wacc_drift.py`, read-only.

**Other changes:**
- **Valuation case delete:** cases can be deleted with a sync tombstone (`DELETE /api/v1/valuation/cases/{id}`, 409 for a fork parent). The 31 identical "(from DESKTOP-7KFUBM2-b6cd)" duplicate cases were deleted (owner-approved).
- **Bugs fixed** (ERROR-LOG 2026-11-16):
  - Normalize was undone by a stale debounced draft.
  - A CRP `None` was re-resolved in metric history.
  - The nav underline was drawn as a box-shadow.
  - The refusal test fixture.
  - The `font.spec` sample.

## 2. Waiting on the owner

1. **`config/.env` must be fixed by the owner.**
   - **Required line:** `MONEYVIEW_SYNC_DIR=C:\Users\VIP\OneDrive\MoneyView-sync`.
   - **Why:** this PC's `.env` held the other PC's path (`C:\Users\eajwa\...`), so sync silently failed.
   - **Current workaround:** the app was started with the env var set for that one launch only:
     `$env:MONEYVIEW_SYNC_DIR='C:\Users\VIP\OneDrive\MoneyView-sync'; .\scripts\start_local.ps1`.
     A normal restart goes back to the wrong path until `.env` is fixed.
   - **Never read or edit `config/.env` yourself.** Ask the owner.
2. **FX conversion design:** `docs/superpowers/specs/2026-11-16-fx-conversion-design.md` (2c804ca). It covers 13 tickers refused with `currency_mismatch`: 10 CAD, plus ASML (EUR), KEP (KRW) and TSM (TWD). Nine open questions in §6 await answers; the recommended answers were presented on 2026-11-16 with no reply yet. If the owner says "추천대로" (go with the recommendations):
   - record the answers in the spec §6;
   - write the plan (HARNESS stage 2, with output contracts and a stage-3 existing-test inventory);
   - get the inventory approved;
   - implement S1-S4 as the spec §6 item 8 slices them.
   - Note: the FRED FX series IDs in the spec were written from memory. Verify each with one live fetch before adding it to `KNOWN_SERIES`.
3. **Owner actions:**
   - Run `python scripts/report_wacc_drift.py` on each PC and re-save the WACC rows it lists.
   - Enter a dated ERP via `PUT /api/v1/market-assumptions` when it changes. This table is not synced (owner O1), so do it on each PC.

## 3. Next work after FX

- **Revenue history.** The CAGR window has only 4 annual revenue points. Research a longer source (e.g. SEC EDGAR companyfacts) and write a design draft, the same way as for FX.
- **Deferred owner decisions** (`todo.md`):
  - the cases `fmtMoney` exceptions are done;
  - fair-value rule changes (N4) are decided by the owner one at a time.
- **Offered but not requested:**
  - a manual refresh button for the comparison metrics (removed together with the Attribution tab);
  - auto-refresh of an open page after a sync;
  - a WAL checkpoint after each save;
  - a more visible sync-error warning. Today the status line says only "Sync unavailable" in English, with no reason; the owner did not decide.

## 4. How to work here (owner rules, learned this session)

**HARNESS:** [`guideline/HARNESS.md`](../../../guideline/HARNESS.md).
- Opus is the controller. Code goes to Haiku/Sonnet subagents, one task at a time.
- **Existing test assertions change only with owner approval.** Show an inventory first, as file:line | old | new.
- After each task the controller re-runs one mutation itself, applied in memory or by a python byte replace plus a `cmp` restore. Never use `git checkout` or `git stash`.

**Agent budget** (HARNESS "Subagent token budget"):
- Size each task at about 100k tokens.
- Stop an agent over 150k tokens or past 20 minutes, using a `sleep 1200` background timer.
- Never continue an over-budget agent with SendMessage.
- Report hand-backs over 70k.

**Tests are run by the controller:**
- Agents run only their own specs, with `--timeout=30000`.
- The controller runs the full suites in the background.
  - **pytest:** `CONDA_NO_PLUGINS=true conda run --no-capture-output -n moneyview python -m pytest -q -p no:cacheprovider`, about 9 minutes.
  - **Playwright:** `cd apps/web && npx playwright test --workers=1 --timeout=45000`, about 21 minutes.

**Pitfalls seen this session:**
- **Playwright cannot run while the owner's app is up.** `next dev` from the same directory refuses a second server, and every test then fails in about 3 seconds. Ask before stopping the app (`scripts/stop_local.ps1`). Restart it afterwards with the sync env var (see §2.1).
- **Git Bash `sed -i` can rewrite CRLF line endings**, which invalidates a mutation. Use a python byte replace.
- **`conda run ... python -c` rejects multi-line scripts.** Write the script to the scratchpad and run the file.
- **`waitForTimeout` is forbidden,** except in a test asserting that something does NOT happen within a window. That needs a comment (HARNESS fixed rules).
- **Korean UI copy uses the formal register** (합니다체/십시오체). Design tokens only. Figures via `formatNumber` / `type-mono`.

## 5. Two-PC sync facts

[`docs/local-run-resources.md`](../../local-run-resources.md), "How sync behaves between two PCs".
- **PCs:** this PC is `DESKTOP-CGQOHT6-ba49` (Windows user `VIP`); the other is `DESKTOP-7KFUBM2-b6cd` (user `eajwa`).
- **The two PCs need not be on together.** The PC with a change must stay on until OneDrive uploads it.
- **What syncs:** user events, categories, decisions, valuation cases, preferences, corporate metrics and the watchlist.
- **What does not sync:** news, prices and `market_assumptions`.
- **The database stays local.** Never put `moneyview.db` in OneDrive. `OneDrive\MoneyView-transfer` holds a manual DB copy only.
- **Check sync with** `GET http://127.0.0.1:8000/api/v1/sync/status`, which reports `last_error` and `peers`.
