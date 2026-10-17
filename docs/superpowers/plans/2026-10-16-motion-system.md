# Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** six owner-approved motions become shared tokens and components, and the market overview uses them:
1. odometer numbers
2. before → after
3. a sliding tab indicator
4. a scan reveal
5. draw-in and stagger
6. a hover nudge

The existing Playwright suite runs with reduced motion.

**Architecture:**
- **No new dependency.** The motions use CSS and the Web Animations API.
- **`lib/motion.ts`** holds the pure odometer plan and the reduced-motion hook.
- **`components/ui/`** gains `RollingNumber`, `BeforeAfter` and `ScanReveal`. The shared `Tabs` gets a measured indicator.
- **Existing components gain opt-in props:** `DeltaBadge` and `Sparkline` (`draw`).
- **`/dev/design` hosts a motion bench.** The motion spec drives it with motion on.

**Tech Stack:** Next.js 16, React 19, Tailwind 4 with the token CSS variables (`npm run tokens` generates `app/tokens.generated.css`, `lib/tokens.generated.ts` and the doc table), recharts 3.8, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-motion-system-design.md` (owner: "좋은데", "do it", 2026-10-16). Prototype: https://claude.ai/artifact/VQTa4ALFoobTj4UCNZQTUa. Paths below are under `apps/web/` unless stated.

**Branch:** `feat/motion-system`. It is currently stacked on `feat/market-overview-expansion` (PR #70, 08b15be).
- PR #70 must be merged into `renewal` before this branch is implemented.
- After the merge, rebase onto `renewal`.

**Model routing:**

| Task | Implementer | Reviewer |
|---|---|---|
| 0 Owner gate | controller | — |
| 1 Tokens, reduced-motion test config, `lib/motion.ts` | Haiku | Sonnet |
| 2 `RollingNumber`, `BeforeAfter`, `mv-enter`, motion bench | Sonnet | Sonnet |
| 3 `Tabs` indicator, `ScanReveal` | Sonnet | Sonnet |
| 4 `DeltaBadge` animate, `Sparkline` draw | Haiku | Sonnet |
| 5 Market overview adoption | Sonnet | Sonnet |
| 6 Gates, capture, records | controller | Opus (final review) |

Tasks 2–5 touch shared surfaces (`components/ui/**`, `tokens/**`, `app/globals.css`). Each of them runs the full Playwright suite (HARNESS test scope).

## Global Constraints

- **When things move:** only on first mount, a tab switch, a displayed value that actually changes, or a run that completes. A re-render with an equal value never moves.
- **Reduced motion:** when `prefers-reduced-motion: reduce` is set, the final text renders at once. Nothing translates, draws, sweeps or staggers.
- **SSR and first render** are treated as reduced (no motion) until the client has measured the setting.
- **Values stay readable.**
  - A rolling figure's wrapper carries the final string as `aria-label`. The moving glyphs are `aria-hidden`.
  - When the roll ends, the element holds exactly the final string as plain text.
- **Tokens** (added to `tokens/moneyview.tokens.json`; existing `duration.*` and `easing.*` stay):
  - `duration.roll` 600ms
  - `duration.roll-enter` 700ms
  - `duration.draw` 700ms
  - `duration.scan` 500ms
  - `duration.flash` 600ms
  - `duration.stagger` 40ms
  - `duration.digit-stagger` 45ms
  - `easing.emphasized` `cubic-bezier(0.2, 0, 0, 1)`
- **Colours and sizes** come only from tokens (CLAUDE.md §10). Rolling digits tint `var(--up)` on a rise and `var(--down)` on a fall. An entry roll uses no tint.
- **Odometer rules:**
  - Compare the strings aligned on the right.
  - Only characters that differ roll. A rise rolls up and a fall rolls down.
  - The delay grows from the rightmost character: `delayIndex × duration.digit-stagger`.
  - An entry (`from === null`) starts from the target string with every digit replaced by `0`.
- **Tests:** every new test is mutation-checked (CLAUDE.md §8). The global Playwright `use.reducedMotion` is `"reduce"`. Only `motion.spec.ts` (and one motion-on describe in Task 5) overrides it to `"no-preference"`.

## Review Focus

1. **Strings of different length** (`999.9` → `1,000.1`, `▲ +0.3%` → `▼ -1.2%`) must align on the right and end as exactly the new string. Pinned in Task 1 (`odometerPlan`) and Task 2 (end-state test).
2. **A value that changes again mid-roll** must restart from what is shown and end on the newest value, with no stale timer overwriting it. Pinned in Task 2.
3. **`null` / missing** renders `—` with no roll, and a later number rolls in from zeros. Pinned in Task 2.
4. **SSR hydration:** the server HTML and the first client render must be the same final text, so React reports no hydration warning. Pinned in Task 2 (console-error check on `/dev/design`).
5. **The tab indicator after a font load or resize** must still match the selected tab. Pinned in Task 3.

## Existing-test inventory (Task 0)

No existing assertion is planned to change. Task 1 turns on `reducedMotion: "reduce"` globally and runs the full suite.
- If any spec changes result, Task 1 stops.
- Task 1 then lists each one (file:line, old, new, why) for owner approval before editing.
- Specs that measure animation timing are the likeliest candidates (see memory `recharts-pixel-decode-stale-dom`).

---

### Task 0: Owner gate
- [ ] PR #70 is merged (the owner runs it; the auto-mode classifier refuses an unreviewed merge).
- [ ] Rebase `feat/motion-system` onto `renewal`.
- [ ] Record the plan's approval in `.superpowers/sdd/2026-10-16-motion-system/progress.md`.

### Task 1: Tokens, reduced-motion test config, `lib/motion.ts`

**Files:**
- Modify: `tokens/moneyview.tokens.json`, then run `npm run tokens`. That regenerates `app/tokens.generated.css`, `lib/tokens.generated.ts` and the doc table.
- Modify: `playwright.config.ts` (`use.reducedMotion: "reduce"`).
- Create: `lib/motion.ts`.
- Test: `tests/e2e/motion-model.spec.ts` (pure, no page).

**Interfaces (produces):**
```ts
export type OdometerCell = { from: string; to: string; delayIndex: number };
export function odometerPlan(from: string | null, to: string): OdometerCell[];
export function usePrefersReducedMotion(): boolean; // true on the server and on the first client render
```
- `odometerPlan` pads the shorter string on the left with `""` cells, so the output length is `max(len)`.
- A cell has `from === to` when the characters are equal.
- `delayIndex` is 0 at the rightmost cell and counts up leftward, over all cells.

- [ ] **Step 1:** Write `motion-model.spec.ts`:
  - `odometerPlan("7,744.1", "7,760.0")` has 7 cells. The changed cells are index 3 (`"4"→"6"`, delayIndex 3), index 4 (`"4"→"0"`, delayIndex 2) and index 6 (`"1"→"0"`, delayIndex 0). Every other cell has `from === to`.
  - `odometerPlan("999.9", "1,000.1")` gives `from` cells `["", "", "9", "9", "9", ".", "9"]` and `to` cells `["1", ",", "0", "0", "0", ".", "1"]`.
  - `odometerPlan(null, "▲ +12.4%")` has every `from` equal to `to`, except that digits become `"0"`.
  - `odometerPlan("5.11%", "5.11%")` has every cell unchanged.
- [ ] **Step 2:** Run `npx playwright test tests/e2e/motion-model.spec.ts`. It fails on the import.
- [ ] **Step 3:** Implement `lib/motion.ts`.
  - `usePrefersReducedMotion` starts at `true` and reads `matchMedia` in `useEffect`.
  - It subscribes to the media query's `change` event.
- [ ] **Step 4:** Add the 8 tokens and run `npm run tokens`. `npm run tokens:check`, `typecheck` and `lint` must be clean.
- [ ] **Step 5:** Set `reducedMotion: "reduce"` and run the **full** Playwright suite.
  - If it is green, go on.
  - If anything changes, stop and report NEEDS_CONTEXT with the list (the Task 0 inventory rule).
- [ ] **Step 6:** Mutation check: left alignment, a reversed delay order, and an unchanged cell marked as changed.
- [ ] **Step 7:** Commit `feat(web): motion tokens, odometer plan, reduced-motion test default`.

### Task 2: `RollingNumber`, `BeforeAfter`, `mv-enter`, motion bench

**Files:**
- Create: `components/ui/RollingNumber.tsx`, `components/ui/BeforeAfter.tsx`.
- Modify: `app/globals.css` (the `mv-enter` utility and the odometer window classes `mv-odo` and `mv-dg`; token vars only).
- Modify: `app/dev/design/**` (a "Motion" section with a demo control).
- Test: `tests/e2e/motion.spec.ts` (`test.use({ reducedMotion: "no-preference" })`), plus a reduced-motion describe in the same file.

**Interfaces:**
```tsx
type RollingNumberProps = {
  value: number | null;
  format: (n: number) => string;
  direction?: "auto" | "up" | "down"; // auto: sign of (value - previous)
  enter?: boolean;                     // roll in from zeros on first client mount
  className?: string;
};
// Renders <span aria-label={finalText} data-rolling={"true"|"false"}>…</span>.
// value null -> "—" (MISSING), never rolls.
type BeforeAfterProps = { previous: string | null; current: ReactNode };
// previous null -> current only; otherwise <old struck> <→> current, old fades in and the strike draws (duration.normal).
```
- **Rendering:** a changed cell renders as a `.mv-dg` window holding a two-row column. The column is animated with WAAPI over `translateY` (0 → -50% for up, -50% → 0 for down), with `duration.roll` (or `roll-enter`), `easing.emphasized` and a delay of `delayIndex × digit-stagger`.
- **End of a roll:** the span returns to plain text and the tint fades over `duration.flash`.
- **Mid-roll change:** a new value cancels the running animations and the pending cleanup, then rolls from the last target string to the new one. Controller ruling, 2026-10-17: this replaces "the currently shown string". Values change far slower than a roll, and the end text is exact.
- **Motion bench in `/dev/design`:** two `RollingNumber`s (price and percent) and one `BeforeAfter`, with buttons "Next value" and "Set same value". Test ids: `motion-roll-price`, `motion-roll-pct`, `motion-before-after`, `motion-next`, `motion-same`.
- **`mv-enter`:** `animation: <rise keyframes> var(--duration-slow) var(--easing-emphasized) both; animation-delay: calc(var(--mv-i, 0) * var(--duration-stagger))`. The keyframes go from `opacity 0; translateY(8px)` to the resting state. A `prefers-reduced-motion: reduce` block sets `animation: none`.

- [ ] **Step 1:** Write `motion.spec.ts`:
  - **Rolls then settles:** click `motion-next`. During the roll (poll within 200ms), `motion-roll-price` contains at least one `.mv-dg`. After 1.5s it contains no `.mv-dg`, and its `textContent` equals its `aria-label`, which equals the expected next string.
  - **Equal value, no roll:** click `motion-same`. No `.mv-dg` appears within 300ms.
  - **Mid-roll change:** click `motion-next` twice within 100ms. After 1.5s the text equals the second value.
  - **Label is final during the roll:** `aria-label` equals the final string while `.mv-dg` is present.
  - **Missing then number:** `value null` renders `—` with no `.mv-dg`. The next value rolls in.
  - **Before/after:** after `motion-next`, `motion-before-after` shows the previous string with a `line-through`-style strike element and the `→`.
  - **Reduced describe:** with `reducedMotion: "reduce"`, `motion-next` updates the text at once and no `.mv-dg` ever appears.
  - **Hydration:** loading `/dev/design` produces no console error containing "hydrat".
- [ ] **Step 2:** Run the spec. It fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the spec, `typecheck`, `lint` and `design:baseline`, then the full suite (shared surface).
- [ ] **Step 5:** Mutation check, one test per mutation:
  - no roll at all
  - no cleanup at the end
  - skip the equal-value guard
  - an `aria-label` that tracks the intermediate string
  - ignore reduced motion
  - render the SSR text as zeros
- [ ] **Step 6:** Commit `feat(web): RollingNumber, BeforeAfter, mv-enter and a motion bench`.

### Task 3: `Tabs` sliding indicator, `ScanReveal`

**Files:**
- Modify: `components/ui/Tabs.tsx`. Replace the `after:` underline on the selected tab with one absolutely positioned `<span data-testid="tabs-indicator" aria-hidden>` inside the tablist. It is positioned from the selected button's `offsetLeft` and `offsetWidth` through `transform` and `width`, with `duration.slow` and `easing.emphasized`, and recomputed on `activeKey`, a `ResizeObserver` on the tablist, and `document.fonts.ready`. The indicator colour stays `var(--brand)`.
- Create: `components/ui/ScanReveal.tsx`. Its props are `{ trigger: string; children: ReactNode; className?: string }`. When `trigger` changes after mount, a 1px `var(--brand)` line (`data-testid="scan-line"`) runs top to bottom and the children are revealed with a `clip-path` inset from 100% to 0, both over `duration.scan`. Under reduced motion nothing runs.
- Test: extend `motion.spec.ts`. Tab tests run against `/` (the market page tabs), with motion on.

- [ ] **Step 1:** Write the tests:
  - After clicking each market page tab and waiting 600ms, the indicator's box `x` and `width` equal the selected tab's within 1px.
  - At 390×844, the same holds after a resize from 1280.
  - On a tab switch, the `[data-testid="scan-line"]` element exists and has a running `getAnimations()` within 100ms. Under reduced motion it never has one.
- [ ] **Step 2:** Run them. They fail.
- [ ] **Step 3:** Implement. Keyboard behaviour stays the same.
- [ ] **Step 4:** Run the full suite (shared surface).
- [ ] **Step 5:** Mutation check: the indicator is not recomputed on resize, and the reduced-motion guard is removed.
- [ ] **Step 6:** Commit `feat(web): sliding tab indicator and scan reveal`.

### Task 4: `DeltaBadge` animate, `Sparkline` draw

**Files:**
- Modify: `components/ui/DeltaBadge.tsx`. Add a prop `animate?: boolean | "enter"`. When it is set, the `[data-part="value"]` text renders through `RollingNumber`, with the same formatter and `direction` from the sign change. The glyph, the tone and `data-dir` behave exactly as now.
- Modify: `components/ui/Sparkline.tsx`. Add a prop `draw?: boolean`. It sets `isAnimationActive={draw && !reduced}`, `animationDuration` to `duration.draw` (ms, from `tokens.generated.ts`) and `animationEasing="ease-out"`.
- Test: extend `motion.spec.ts` against the motion bench. Add a `DeltaBadge animate` and a `Sparkline draw` to the bench.

- [ ] **Step 1:** Write the tests:
  - The bench `DeltaBadge` rolls on "Next value", and its `[data-part="value"]` text ends equal to `formatNumber(v / 100, "percent", { signed: true })`.
  - The `Sparkline draw` path has a running animation on mount with motion on, and none under reduced motion.
- [ ] **Step 2:** Run them. They fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the full suite.
- [ ] **Step 5:** Mutation check: `animate` is ignored, and `draw` stays on under reduced motion.
- [ ] **Step 6:** Commit `feat(web): DeltaBadge roll and Sparkline draw-in, opt-in`.

### Task 5: Market overview adoption

**Files:**
- Modify: `components/market/InstrumentsPanel.tsx`.
  - The card and table values become `<RollingNumber value={quote.last_close} format={…} enter />`. The formatter is the one used today, including the rate `%`.
  - Cards get `mv-enter` with `--mv-i` = index.
- Modify: `components/market/ChangeFigureText.tsx`.
  - `pct` uses `<DeltaBadge value={…} animate="enter" />`.
  - `bp` uses `RollingNumber` with `formatBp`.
- Modify: `components/data/SparklineCard.tsx`.
  - `value` becomes `ReactNode`.
  - It gets `Sparkline draw`.
  - The hover nudge is an `aria-hidden` `→` at the top right. It is hidden at rest, then fades in and moves 4px over `duration.fast` and `duration.normal` on `:hover` and `:focus-visible`.
  - The border goes to `var(--ink)` on hover.
- Modify: `components/market/MarketPageTabs.tsx`. Wrap the panel in `ScanReveal trigger={active}`.
- Modify: `components/market/SpreadFigureRow.tsx` and `MarketRegimeLine.tsx`. Their figures use `RollingNumber enter`.
- Test: extend `market-overview-expansion.spec.ts` with a `test.describe` that uses `reducedMotion: "no-preference"`:
  - On load, a card value contains `.mv-dg` within 300ms, and after 1.5s its text equals the API value text.
  - With reduced motion (the default), the card text is final in the first frame. The existing tests cover that.

- [ ] **Step 1:** Write the motion-on test above, plus one for the scan line on a tab switch.
- [ ] **Step 2:** Run it. It fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the area specs (`market-*`, `one-screen-no-scroll`, `design-capture`, `responsive-accessibility`), `typecheck`, `lint` and `design:baseline`. Then run the full suite, because the SparklineCard and DeltaBadge consumers span pages.
- [ ] **Step 5:** Mutation check: drop `enter`, and drop the `ScanReveal` trigger.
- [ ] **Step 6:** Commit `feat(web): market overview moves — rolling figures, draw-in, stagger, scan reveal`.

### Task 6: Gates, capture, records
- [ ] **Full gates:** typecheck, lint, unit, `design:baseline`, the full Playwright suite, and pytest (no backend change expected; run it at the gate).
- [ ] **Capture:**
  - `/` at 1280×720 with reduced motion. It must equal the pre-motion capture except for the indicator.
  - A short recording with motion on, for the owner. Use a Playwright video of `/` with tab switches, saved in the scratchpad.
- [ ] **Controller:** re-run one Task 2 mutation and one Task 3 mutation.
- [ ] **Records:**
  - `guideline/sop/todo.md` Track D line.
  - `DESIGN.md`: a Motion section with the six motions, the principles and the tokens.
  - Add a reference to this spec in `docs/superpowers/specs/2026-10-16-monte-carlo-one-screen-design.md` §6.
  - Memory.
- [ ] **Final review** (Opus), then owner acceptance.
