# Portfolio count, tile button, and watchlist drift — implementation brief

> **Status:** IMPLEMENTED 2026-09-12 on `worktree-portfolio-count-watchlist-drift`, branched
> from `renewal` @ `1af14ad`. A1, A2, B1 and B3 all shipped; see `guideline/sop/todo.md`
> Track I, and ERROR-LOG.md 2026-09-12 for the two defect records.
>
> **One deviation, in B3.** This brief calls the drift line "a rendering change only"
> because `gather_status` already returns both numbers. It is not: `watchlist_rows` and
> `tracked_tickers` are independent counts whose difference is not the number of
> un-imported seed tickers, and on a machine with locally-curated tickers the subtraction
> reports no drift in exactly the case B1 exists to repair. `gather_status` now compares the
> ticker sets. See the B3 section and Track I.
>
> **Branch from `renewal`.** An earlier revision of this brief said to start from
> `add-data-status-check`, because item B3 edits `scripts/check_data_status.py` and that
> file existed only there. PR #31 merged that branch into `renewal` on 2026-09-12
> (`110dae4`), so the file is now on `renewal` and the old instruction is wrong.

This is **bounded** work with an approved design — no spec document, no ceremony beyond
what is written here. It is the first of four sub-projects decomposed from one request;
the other three are recorded at the bottom and are NOT in scope here.

## Decisions already made (do not re-litigate)

Both were put to the user and answered:

1. **The count shows both numbers**, not one: `12 of 143 · 7 followed`. The user was
   offered followed-only and visible-of-total-only and chose both.
2. **Watchlist drift is fixed by additive merge**, not by auto-resync. The user was shown
   that `resync_watchlist_from_json` does `DELETE FROM watchlist` and chose the additive
   option specifically so machine-local curation survives.
3. **The drift line is in scope** (item B3), added after the initial design.

## A1. Holdings count

**File:** `apps/web/app/portfolio/components/StockTileGrid.tsx`

The sticky header currently holds a filter `<select>` and a search `<input>` and no count
at all. Add one line beneath them:

```
12 of 143 · 7 followed
```

- the first number is `visible.length` — already computed by `selectVisibleStocks`, and it
  tracks filter and search live
- the second is the full set passed in (`stocks.length`)
- `followedCount` is `stocks.filter(s => s.group_name === followedGroup).length`

Put it inside the existing `sticky top-0` header so it survives scrolling. It must stay
rendered when the grid is empty — `EmptyState` replaces only the grid body, not the
header, so this works if the line is a sibling of the controls rather than of the body.

**Test** (`apps/web/tests/e2e/portfolio-tile-grid.spec.ts`): typing into the search box
changes the first number and leaves `143` and `7 followed` unchanged. That separation is
the assertion — a single combined count would pass a weaker test while hiding whether the
filter or the total was the thing that moved.

## A2. The `+` button must not overlap the delta badge

**File:** `apps/web/app/portfolio/components/StockTile.tsx`

**Constraint — read before changing anything.** The follow control is deliberately a DOM
*sibling* of the tile, not a child, and it must stay that way. The tile is itself a
`<button>`; a nested button is invalid HTML that browsers reparent, and there is a spec
test asserting the tile holds only phrasing content. "Put it inside the card" means
*visually* inside the card's bounds, not a DOM child.

The bug is a false claim in the code's own comment. It says the button is "positioned over
the tile's top-right corner, which the header row leaves free" — the header row does not
leave it free. That row is:

```tsx
<span className="flex items-baseline justify-between gap-2">
  <span ...>{stock.ticker}</span>
  <DeltaBadge value={stock.delta?.delta_pct} />   {/* right-aligned, under the button */}
</span>
```

`DeltaBadge` is right-aligned into exactly the corner the button occupies.

**Fix:** keep the button absolute (required), and reserve its footprint in the header row.
The button is `h-7 w-7` (28px) at `right-1` (4px), so it spans 4→32px from the tile's right
edge. Content starts at 12px in (`p-3`). Reserving `pr-6` (24px) on the header row puts the
badge's right edge clear of the button with margin to spare. Verify the number against the
rendered result rather than trusting this arithmetic.

Correct the stale comment in the same change — it is the reason the bug was not obvious.

**Test** (same e2e file): assert the follow button's bounding box does not intersect the
delta badge's bounding box, via Playwright `boundingBox()` on both. Mutation that must fail
it: remove the `pr-6`. A test that merely asserts both elements are visible would pass with
them stacked on top of each other and is not acceptable here.

## B1. Additive merge so another machine picks up new tickers

**Files:** `apps/api/services/watchlist_seed.py`, `apps/api/routes/portfolio.py`

**Root cause, already confirmed.** `ensure_watchlist_bootstrapped` is one-shot:

```python
row = conn.execute("SELECT COUNT(*) AS count FROM watchlist").fetchone()
if row and int(row["count"]) > 0:
    return
if _has_watchlist_state(conn):
    return
```

Once a machine has any watchlist row, tickers added to `stock_targets.json` afterwards are
never picked up. That is the reported symptom: `SPCX` and the rest of the `custom` group
*are* committed in the seed (8 tickers: CRCL, IAUM, MP, NRG, SCCO, SLV, SNDK, SPCX), so the
other PC is not missing the file — it seeded before those were added. The separate
"insufficient" symptom is the no-JSON fallback, which yields only the 5 built-in
`DEFAULT_WATCHLIST_ITEMS`.

Add:

```python
def merge_missing_watchlist_items(json_path: Path) -> list[str]:
    """Insert seed tickers the table does not have. Never delete, never overwrite.

    `ensure_watchlist_bootstrapped` seeds once and then returns early forever, so a ticker
    added to the seed after a machine was first set up never reaches it. This closes that
    gap without the destructiveness of `resync_watchlist_from_json`, which DELETEs the
    table and would discard weights curated on that machine.
    """
```

Rules, all of which need a test:

- `INSERT OR IGNORE` only — an existing row's `weight`, `group_name` and `name` are never
  modified
- a ticker present in the DB but absent from the seed is never deleted
- returns the list of tickers it actually added, and logs it

**Call site:** immediately after `ensure_watchlist_bootstrapped(_WATCHLIST_JSON)` in
`GET /portfolio/watchlist` (`apps/api/routes/portfolio.py:55`). That endpoint already runs
the bootstrap on every request, so no startup wiring is needed and the other PC self-heals
the first time the portfolio page loads.

`resync_watchlist_from_json` is left exactly as it is — it remains the deliberate full
replace, and it is already exposed at `POST /portfolio/watchlist/resync` and already wired
to the UI at `apps/web/app/portfolio/page.tsx:1731`.

**Tests** (`tests/api/`, new file or the existing watchlist test file):

1. a DB seeded from a smaller/older seed gains the missing tickers on the next call
2. an existing row's weight and group survive the merge unchanged
3. a DB ticker absent from the seed is still there afterwards
4. a no-op when DB and seed already agree (returns `[]`, writes nothing)

Test 2 is the one that matters most: it is the difference between this and the destructive
resync, and it is the reason the additive option was chosen.

## B3. Drift line in the startup data-status block

**File:** `scripts/check_data_status.py` (exists only on `add-data-status-check`)

`gather_status()` already reads `watchlist_rows` from the DB and `tracked_tickers` from the
seed. Report them against each other in `render_text` when they disagree, e.g.:

```
Watchlist: 138/143 tracked tickers  (5 in seed not yet imported)
```

Keep it to the existing style: one line, no colour, no advice paragraph unless the verdict
is `empty` or `partial`. The existing tests for that script are in
`tests/scripts/test_check_data_status.py` — add a case for the divergent count, and note
that `gather_status` already returns both numbers, so this is a rendering change only.

## Verification for the whole brief

- `python -m pytest tests/ -q` — baseline on this branch is **1264 passed**
- `cd apps/web && npx playwright test tests/e2e/portfolio-tile-grid.spec.ts`
- `cd apps/web && npx tsc --noEmit`
- CLAUDE.md §8 applies to every test above: name the mutation each was shown to catch, or
  call it unverified. The two named explicitly here are the `pr-6` removal (A2) and a merge
  that overwrites instead of ignoring (B1 test 2).

**Previously listed here as a known flake — it was not one, and it is now fixed.**
`tests/scripts/test_reset_snapshots.py::test_a_second_reset_does_not_overwrite_the_first_backup`
was failing intermittently, and this brief told you to re-run rather than investigate. That
was wrong. The assertion had never actually been read: `_back_up` gave two backups the same
filename and the second overwrote the first, in 9 of 30 measured trials — the 2026-09-04
forensic loss reopened, because `%f` inherits a Windows clock granularity of 15.6 ms. Fixed
on branch `fix-backup-name-collision` (ERROR-LOG.md 2026-09-12). Nothing to work around.

---

## Not in scope — the other three sub-projects

The original request decomposed into four. This brief is the first. The remaining three
were explicitly deferred, in this order:

- **C. Market-event vertical bands on stock charts.** Semi-transparent coloured spans for
  oil shocks, the S&P low, Fed announcements, geopolitical dates. Charts are
  **lightweight-charts v5**, which has no native vertical span — this needs a **series
  primitive** (the v5 plugin API), plus an event data model and a decision about where the
  event list comes from and who maintains it.
- **D. Thematic, political and sentiment indicators.** Note before starting: the
  `indicators` table exists but holds **0 rows**, so this is an acquisition project first
  and a visualisation project second.
- The design conversation recommended making politics **observable rather than scored** —
  policy-sensitive spreads with a stated basis (clean energy vs traditional energy,
  defence relative strength) anchored to real event dates, rather than a subjective
  left/right sentiment number, which would be the exact "number wearing a basis it has not
  earned" defect this repository keeps finding. Themes as relative strength vs SPY (AI,
  cybersecurity, cloud). For Fear & Greed: CNN publishes no official API — prefer VIX plus
  breadth, and if CNN's figure is wanted, label it explicitly as scraped.

C and D share an overlay layer; building C first means D reuses it.
