# Watchlist Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every watchlist row carries a theme id from a checked-in list. The theme syncs between PCs as an optional field, can be edited in the stock modal, and is filled for all 250 rows from the approved draft.

**Architecture:**
- A YAML theme list with a loader, plus `GET /portfolio/watchlist/themes`.
- A `theme` column on `watchlist`, written only by a dedicated `POST /portfolio/watchlist/{ticker}/theme`. Every other write path preserves it.
- `SyncRow.theme` defaults to `""` so files from PCs that have not updated still read.
- A theme `<select>` in `StockDetailModal`.
- A one-off apply script.

**Tech Stack:** FastAPI, SQLite, pydantic, PyYAML, Next.js/React, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-10-18-risk-signal-design.md` §1, plus decisions R-D9, R-D10, R-D17 and R-B1. The draft is `docs/superpowers/specs/2026-10-18-risk-signal-evidence/themes-draft.csv`, 250 rows; its `proposed_theme` column holds Korean labels.

## Global Constraints

- **The owner's `sector` value is never overwritten** by any theme path (R-D9).
- **New sync fields are optional.** A peer file row without `"theme"` reads as `theme=""`. `FORMAT_VERSION` does not change.
- **Theme ids:** the DB stores the stable ASCII id, never the Korean label. Labels come from the YAML.
- **Unknown theme ids are kept, not erased.** A newer PC may know more themes. The UI shows them as `Other` / `기타`.
- **Design tokens only** (CLAUDE.md §10). No raw colours or sizes in TSX.
- **Every new test is mutation-checked** (CLAUDE.md §8). Each test's docstring or comment names the mutation it catches.
- **Test scope:** each task runs its affected tests. At plan end, run full pytest plus the full Playwright suite. Playwright runs one at a time, only once ports 3101 and 8110 are free.
- **Commits end with** `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use `git stash`, `git checkout --`, or `--no-verify`.
- **Running the apply script against the real DB** (Task 5, Step 4) needs explicit owner OK in chat.

**Theme ids (exact; order = display order):**

| id | ko | en |
|---|---|---|
| ai_semis | AI 반도체 | AI semiconductors |
| optical_connectivity | 광통신·연결 칩 | Optical & connectivity chips |
| memory_storage | 메모리·스토리지 | Memory & storage |
| chip_equipment_design | 반도체 장비·설계 | Chip equipment & design |
| analog_power_chips | 아날로그·전력 반도체 | Analog & power chips |
| ai_servers_network | AI 서버·네트워크 | AI servers & networking |
| ai_cloud_datacenter | AI 클라우드·데이터센터 | AI cloud & data centers |
| big_tech | 빅테크 | Big tech |
| software_internet | 소프트웨어·인터넷 | Software & internet |
| cybersecurity | 사이버보안 | Cybersecurity |
| power_equipment | 전력 장비·저장 | Power equipment & storage |
| nuclear_uranium | 원전·우라늄 | Nuclear & uranium |
| power_producers | 발전사 | Power producers |
| regulated_utilities | 규제 유틸리티 | Regulated utilities |
| oil_gas | 석유·가스 | Oil & gas |
| gold_silver | 금·은 | Gold & silver |
| copper_metals | 구리·산업금속 | Copper & industrial metals |
| battery_rare_earth | 배터리·희토류 소재 | Battery & rare-earth materials |
| quantum | 양자컴퓨팅 | Quantum computing |
| crypto | 크립토 | Crypto |
| defense_aerospace | 방산·항공 | Defense & aerospace |
| space_comms | 우주·통신 | Space & communications |
| financials_payments | 금융·결제 | Financials & payments |
| defensives_other | 경기방어·기타 | Defensives & other |

## Review Focus

1. **A full-row `POST /portfolio/watchlist` that omits `theme` must not erase it.** The sector save, the allocation auto-save and "normalize allocations" all use this path. Owned by Task 2.
2. **A peer file written by a PC that has not updated has no `"theme"` key.** It must merge without being skipped, and without wiping a theme this PC already has when the peer's row is older. Owned by Task 3.
3. **Two rows with the same `(updated_at, updated_by)` that differ only in theme** must merge the same way whatever order they are read in. Owned by Task 3.
4. **The group toggle must keep the theme**, since it is clicked casually. Owned by Task 2.
5. **Draft tickers that are not on the watchlist** (deleted since, or typos) are reported by the apply script and never created. Running the script twice changes nothing the second time. Owned by Task 5.

---

### Task 1: Theme list and `GET /portfolio/watchlist/themes`

**Files:**
- Create: `apps/api/services/watchlist_themes.yaml`
- Create: `apps/api/services/watchlist_themes.py`
- Modify: `apps/api/routes/portfolio.py` (new route; declare it **before** `/watchlist/{ticker}` routes)
- Modify: `apps/api/models/schema_parts/watchlist.py` (`WatchlistTheme`)
- Test: `tests/api/test_watchlist_themes.py`

**Interfaces:**
- Produces: `WatchlistTheme(BaseModel)` with `id: str`, `ko: str`, `en: str`.
- Produces: `load_themes(path: Path | None = None) -> list[WatchlistTheme]`, cached for the default path, in YAML order.
- Produces: `theme_ids() -> frozenset[str]`.
- Produces: `GET /api/v1/portfolio/watchlist/themes` returning `list[WatchlistTheme]`, 24 items in the table's order, with no envelope (matching the other watchlist routes).
- YAML shape: `themes: [{id, ko, en}, ...]`.
- The loader raises `ValueError` on a duplicate id, or on an id that does not match `^[a-z][a-z0-9_]*$`.

- [ ] **Step 1: Write the failing tests**
  - `test_themes_endpoint_lists_24_in_order`: status 200; `[t["id"] for t in body]` equals the 24 ids above, in order; `body[0] == {"id": "ai_semis", "ko": "AI 반도체", "en": "AI semiconductors"}`.
  - `test_loader_rejects_duplicate_ids(tmp_path)`: a YAML with two `quantum` entries raises `ValueError` mentioning `quantum`.
  - `test_loader_rejects_non_slug_id(tmp_path)`: id `"AI 반도체"` raises `ValueError`.
- [ ] **Step 2:** Run `pytest tests/api/test_watchlist_themes.py -v`. Expected: FAIL (404 / ImportError).
- [ ] **Step 3:** Write the YAML from the table and implement the loader and route. Use `yaml.safe_load`, as `apps/api/services/signals/models.py` does.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Mutation check. Swap two YAML entries: the order test fails. Drop the duplicate check: the duplicate test fails. Record both in the test docstrings.
- [ ] **Step 6: Commit** `feat(api): watchlist theme list and themes endpoint`

### Task 2: `theme` column, dedicated theme endpoint, preserved by every other write

**Files:**
- Modify: `apps/api/services/db.py`
  - Add `theme TEXT DEFAULT ''` to the `CREATE TABLE watchlist` at line ~333.
  - Add an `ALTER TABLE watchlist ADD COLUMN theme TEXT DEFAULT ''` migration next to the `updated_by` one at line ~1003.
- Modify: `apps/api/models/schema_parts/watchlist.py`
  - Add `theme: str = ""` to `PortfolioStock`.
  - Add `WatchlistThemeUpdate(BaseModel)` with `theme: str`.
  - `WatchlistItem` gains `theme: Optional[str] = None` for **responses only**: the upsert ignores an incoming value.
- Modify: `apps/api/routes/portfolio.py`
  - The list route (`SELECT *` at :72) maps `theme` into `PortfolioStock`.
  - The upsert at :176 neither writes nor clears `theme`. The `INSERT OR REPLACE` must become an `INSERT ... ON CONFLICT(ticker) DO UPDATE` that leaves `theme` alone. `INSERT OR REPLACE` deletes the row, which would reset `theme` to `''` and change `id`.
  - The upsert and group responses include the stored `theme`.
  - New route `POST /watchlist/{ticker}/theme`.
- Test: `tests/api/test_watchlist_theme_column.py`

**Interfaces:**
- Consumes: `theme_ids()` (Task 1).
- Produces: `POST /api/v1/portfolio/watchlist/{ticker}/theme` with body `WatchlistThemeUpdate`. It returns `WatchlistItem`, with `theme` set.
  - `theme` must be `""` or one of `theme_ids()`; anything else is a 422 with detail starting `unknown_theme:`.
  - An unknown ticker is a 404 `unknown_ticker:`.
  - It writes only `theme`. When the value changes, it calls `watchlist_sync_store.stamp_row(conn, ticker, local_pc_id)`, then `mark_watchlist_state("user_mutation")` and `watchlist_sync.run_sync("mutation")`. This is the same sequence as the group route at :230.
- Produces: `GET /portfolio/watchlist` items carry `theme: str`.

- [ ] **Step 1: Write the failing tests.** Seed the way `tests/api/test_watchlist_group.py` does, with an extra `theme` column value `"ai_semis"`.
  - `test_setting_a_theme_writes_only_the_theme`: POST `{"theme": "memory_storage"}`, then check the row: theme is `memory_storage`; name, sector, group and weight are unchanged.
  - `test_an_unknown_theme_is_rejected`: `{"theme": "AI 반도체"}` returns 422 and the row is unchanged.
  - `test_empty_theme_clears_it`: `{"theme": ""}` returns 200 and the stored value is `""`.
  - `test_full_row_upsert_keeps_the_theme`: POST `/watchlist` with `{ticker, name, sector: "Chips", group_name, weight}` and no theme. Theme is still `ai_semis`, and sector is `Chips`. (Review Focus 1.)
  - `test_upsert_keeps_the_row_id`: the `id` before and after the upsert is equal. This catches `INSERT OR REPLACE`.
  - `test_group_toggle_keeps_the_theme`. (Review Focus 4.)
  - `test_list_returns_theme`: `GET /watchlist` includes `"theme": "ai_semis"` for the seeded row.
  - `test_theme_change_restamps_the_row`: `updated_at` differs after a changing POST, and is unchanged after a same-value POST.
- [ ] **Step 2:** Run `pytest tests/api/test_watchlist_theme_column.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the changes in the files listed above.
- [ ] **Step 4:** Run the new file plus `tests/api/test_watchlist_group.py`, `tests/api/test_watchlist_id.py`, `tests/api/test_watchlist_merge.py` and `tests/api/watchlist_sync/test_routes.py`. Expected: all PASS.
- [ ] **Step 5:** Mutation check. Restore `INSERT OR REPLACE`: the id and full-row tests fail. Write `theme=''` in the group route: the group test fails. Drop the id validation: the unknown-theme test fails.
- [ ] **Step 6: Commit** `feat(api): watchlist theme column with its own endpoint`

### Task 3: Theme in peer sync (optional field)

**Files:**
- Modify: `apps/api/services/peer_sync/model.py`
  - `SyncRow` gains `theme: str = ""` as its **last** field, so positional construction in existing tests stays valid.
  - `order_key()` appends `self.theme`.
- Modify: `apps/api/services/watchlist_sync/files.py`
  - Read: `theme = raw.get("theme", "")`. It must be `str`, otherwise `ValueError(f"{ticker}: theme is not text")`.
  - Write: emit `"theme"` for every row.
- Modify: `apps/api/services/watchlist_sync/store.py`
  - `read_local_state` selects `theme` (with `or ""`).
  - `apply_state` writes `theme` in both the insert and the `DO UPDATE`.
- Test: add to `tests/api/watchlist_sync/test_files.py`, `test_model.py` and `test_store.py`.

**Interfaces:**
- Consumes: the `watchlist.theme` column (Task 2).
- Produces: `SyncRow.theme: str`.

- [ ] **Step 1: Write the failing tests.**
  - `test_files::test_a_peer_row_without_theme_reads_as_empty_theme`: write a valid peer JSON by hand whose row lacks `"theme"`. `read_peer_files` returns it, not skipped, with `theme == ""`. (Review Focus 2.)
  - `test_files::test_theme_round_trips`: `write_own_file` with `theme="gold_silver"`, then read it back: the value is equal.
  - `test_files::test_a_non_text_theme_is_skipped_beside_a_good_peer`: `"theme": 3` puts that file in `skipped`.
  - `test_model::test_theme_breaks_an_exact_tie_deterministically`: two rows with the same `(updated_at, updated_by)` and themes `""` and `"ai_semis"`. Merging in either order picks the same row. (Review Focus 3.)
  - `test_store::test_apply_state_writes_theme_and_read_returns_it`.
  - `test_store::test_an_older_themeless_peer_row_does_not_erase_a_newer_local_theme`: local row with `ts2`, theme `ai_semis`; peer row with `ts1 < ts2`, no theme. After merge and apply, the theme is still `ai_semis`.
- [ ] **Step 2:** Run `pytest tests/api/watchlist_sync -v`. Expected: the new tests FAIL and the old ones PASS.
- [ ] **Step 3:** Implement the changes.
- [ ] **Step 4:** Run `pytest tests/api/watchlist_sync tests/api/test_watchlist_theme_column.py -v`. Expected: PASS.
- [ ] **Step 5:** Mutation check.
  - Use `raw["theme"]` instead of `.get`: the themeless-row test fails.
  - Drop `theme` from `order_key`: the tie test fails.
  - Drop `theme` from the `DO UPDATE`: the store round-trip fails.
- [ ] **Step 6: Commit** `feat(sync): watchlist theme travels between PCs as an optional field`

### Task 4: Theme picker in the stock modal

**Files:**
- Modify: `apps/web/app/portfolio/page.tsx`
  - `PortfolioStock` gains `theme: string`.
  - A `["watchlist-themes"]` query on `/portfolio/watchlist/themes`.
  - `handleUpdateStockTheme(stock, themeId)` POSTs to `/portfolio/watchlist/${encodeURIComponent(ticker)}/theme`, then refetches `["portfolio-watchlist"]`.
  - Pass `themes` and `onUpdateTheme` to `StockDetailModal` (the call site is near :2994).
- Modify: `apps/web/app/portfolio/components/StockDetailModal.tsx`
  - A second row under the Sector row, built the same way: a `Theme` chip, a `<select aria-label="Stock theme">` and a `Save Theme` button.
  - Messages: `Saved theme for {ticker}.`, `Theme is already up to date.`, and the error text.
  - Option labels use `useLocale().locale` to pick `ko` or `en`. The first option is `""`, shown as `No theme` / `테마 없음`.
  - A stored id that is not in the list renders as a disabled selected option `Other` / `기타` with that id as its value.
  - Theme saving is shown only when the modal's stock is a watchlist row (`id > 0`), the same condition as the existing sector save's watchlist branch.
- Test: `apps/web/tests/e2e/portfolio-watchlist.spec.ts`, next to the sector test at :151.

**Interfaces:**
- Consumes: `GET /portfolio/watchlist/themes` (Task 1), `POST /portfolio/watchlist/{ticker}/theme` and `PortfolioStock.theme` (Task 2).
- Produces: none for later tasks.

- [ ] **Step 1: Write the failing e2e test** `the stock modal saves a theme without touching the sector`. Follow the mocking pattern this spec file already uses for watchlist routes.
  - The select shows the seeded theme's label.
  - Choose `Memory & storage` and click `Save Theme`.
  - The intercepted POST body is exactly `{"theme":"memory_storage"}`.
  - `Saved theme for AAPL.` is visible.
  - No POST to `/portfolio/watchlist` (the full-row upsert) fired.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/portfolio-watchlist.spec.ts -g "theme"` from `apps/web`. Expected: FAIL.
- [ ] **Step 3:** Implement it. Tokens only. Copy the sector row's class list.
- [ ] **Step 4:** Run the same command, then the whole `portfolio-watchlist.spec.ts`, then `npm run lint` and `npm run typecheck`. Expected: PASS, lint 0 errors.
- [ ] **Step 5:** Mutation check. Send the full row through `persistWatchlistItem` instead: the "no full-row POST" assertion fails.
- [ ] **Step 6: Commit** `feat(web): pick a watchlist theme in the stock modal`

### Task 5: Apply the approved draft, name fixes, records

**Files:**
- Create: `scripts/apply_watchlist_themes.py`
- Test: `tests/scripts/test_apply_watchlist_themes.py`
- Modify: `guideline/sop/todo.md` (track entry), `docs/INDEX.md` (link the spec and plan)

**Interfaces:**
- Consumes: the theme and upsert endpoints (Task 2) and `load_themes()` (Task 1).
- Produces: CLI `python scripts/apply_watchlist_themes.py [--csv PATH] [--dry-run]`, run from the repo root.
  - `--csv` defaults to the evidence CSV.
  - It maps the `proposed_theme` Korean label to an id through `load_themes()`. An unknown label is a hard error that names the label.
  - It calls the endpoints in-process via `with TestClient(app)` so startup migrations run. Without lifespan this fails with `no such table: cleanup_pending`.
  - It prints one line per ticker (`set`, `unchanged`, or `not-on-watchlist`) and a final `set=N unchanged=M missing=K`.
  - Name fixes are a constant in the script: `NRG→"NRG Energy"`, `SCCO→"Southern Copper"`, `MSTR→"Strategy"`, `IAUM→"iShares Gold Trust Micro"`, `SLV→"iShares Silver Trust"`. Each goes through the full-row upsert, reading the current sector, group and weight first so they are preserved. A name that is already correct prints `unchanged`.
  - Pure helper: `plan_changes(rows: list[dict], current: dict[str, dict], themes: list[WatchlistTheme]) -> list[tuple[str, str, str]]`. Each tuple is `(ticker, action, value)`, with action one of `"theme"`, `"name"` or `"missing"`. Already-equal values produce no tuple.

- [ ] **Step 1: Write the failing unit tests** for `plan_changes`. No DB, no network.
  - `test_label_maps_to_id`: a row labelled `금·은` produces `("ARIS", "theme", "gold_silver")`.
  - `test_unknown_label_raises`: `ValueError` naming the label.
  - `test_ticker_not_on_watchlist_is_missing_not_created`: produces `("NUAG", "missing", "")`. (Review Focus 5.)
  - `test_second_run_is_a_no_op`: when `current` already holds every target, the result is `[]`. (Review Focus 5.)
  - `test_name_fixes_only_when_different`.
- [ ] **Step 2:** Run `pytest tests/scripts/test_apply_watchlist_themes.py -v`. Expected: FAIL.
- [ ] **Step 3:** Implement the script.
- [ ] **Step 4: Owner gate.**
  - Run `--dry-run` against the real DB and show the owner the summary line and any `missing` rows.
  - Only after the owner says OK, back up `data/processed/moneyview.db` with the sqlite backup API into the scratchpad, then run the script without `--dry-run`.
  - Verify: `SELECT COUNT(*) FROM watchlist WHERE theme = ''` is 0, and the five names are fixed.
- [ ] **Step 5:** Mutation check. Make `plan_changes` emit tuples for equal values: the no-op test fails.
- [ ] **Step 6: Records.**
  - `guideline/sop/todo.md`: add a track entry. It says sub-project ① is done; that the other PC needs updating the same day and needs a theme apply (sync is off on this PC); and that PSTG still has no Yahoo quote and its status is unknown.
  - `docs/INDEX.md`: link the spec and this plan.
- [ ] **Step 7: Gates.** Run full pytest. The 18 known environment failures are the baseline. Then run the full Playwright suite with `--workers=2`, after confirming nothing listens on 3101 or 8110.
- [ ] **Step 8: Commit** `feat(scripts): apply approved watchlist themes; records`
