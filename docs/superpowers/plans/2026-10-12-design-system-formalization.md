# Design System Formalization Implementation Plan (paper redesign)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `apps/web` takes on the redesign's light **paper** identity, and every value comes from one DTCG token file. That covers:
- the warm-white ground, ink text, signal-orange brand fills
- Korean red-up/blue-down
- Host Grotesk + Pretendard + Geist Mono
- square hairline panels with no shadows
- the bilingual "시장 MARKET" small labels

A generator derives these from the token file: the CSS variables, the Tailwind theme and type utilities, a typed TS constant, and the token table in the docs. A lint rule rejects values outside the tokens. Body text and controls switch between English and Korean.

**Architecture:** `apps/web/tokens/moneyview.tokens.json` is the only source. `apps/web/scripts/build-tokens.mjs` (plain Node, no dependency) resolves references and writes:
- `app/tokens.generated.css`: `:root` variables, `@theme` blocks, and one `@utility type-<style>` per app type style
- `lib/tokens.generated.ts`
- a marked section of `docs/design/MoneyView_Design_Tokens.md`

The token file first reproduces today's `globals.css` exactly (Tasks 2–3). That proves the pipeline while nothing visible changes. Then it switches to the paper values in one commit (Task 5). Old variable names survive as deprecated aliases while screens migrate (Tasks 9–13), and Task 14 deletes them. Shared components are restyled to the redesign's `mv-*` look as React components using token utilities (Task 8). Strings move into typed `en`/`ko` catalogs. Small labels use a separate always-bilingual table.

**Tech Stack:** Next.js 16.2 app router, Tailwind CSS 4 (`@tailwindcss/postcss`), React 19, recharts 3, lightweight-charts 5, ESLint 9 flat config, Playwright, Node 24 (`node --test`), `next/font/local`.

**Spec and design source:**
- Spec: `docs/MoneyView 디자인 시스템 정형화 계획서.md` (untracked; Task 1 moves it to `docs/superpowers/specs/2026-10-12-design-system-formalization-spec.md`).
- Redesign: the untracked export `Landing · 랜딩-html/` at the repo root. Task 1 copies its design files to `docs/design/redesign-2026-10/`. `ds/moneyview/tokens.json` there is the value source of Task 5.
- Read both together with the decisions and conflict tables below. **Where they disagree, the tables win.**

**Independence:** This plan does not depend on `2026-10-12-macro-signal-engine.md`, which is being implemented on `feat/macro-signal-engine`. Run this plan on its own branch, `feat/design-system-paper`, cut from `renewal`. If `/signals` exists when Task 13 runs, it is migrated with the other screens. If not, nothing waits for it.

## Owner decisions

**2026-10-12 (still in force):**
- **Korean font:** must allow commercial use. All three fonts the redesign names are SIL Open Font License 1.1: Host Grotesk, Pretendard and Geist Mono. OFL allows commercial use, embedding and redistribution, and the licence texts ship beside the files (Task 4).
- **Korean copy:** 합니다체 by default. This is now binding, no longer "confirm before Task 9".
- **Dark mode:** none. See decision 1 below.

**2026-10-13 (binding):**
1. **Theme:** ship only the light `paper` theme. The `void` (dark) values are dropped entirely and are not carried in the token file. A test enforces this (Task 5, `no value that exists only in the void theme is carried`).
2. **Language:** keep the ko/en toggle (i18n) for body text and controls. Also adopt the redesign's always-bilingual small labels (eyebrows, table headers) in the "시장 MARKET" style: Korean first, English second, both always visible (Task 7). Nav items stay toggle-translated, because they are controls.
3. **Landing page:** out of scope. That covers `Main.dc.html`'s sections, including the illustrative fear/greed, foreign-flow and regime panels, and the `mv-ticker`/`mv-live-dot` pieces that only it uses. They are listed under Follow-ups.

> **Owner-visible note: provenance of the palette and type scale.** The redesign's `tokens.json` carries
> `"meta": {"source": "Derived from a Heron AI brand extraction (heronaiapp.com: home, chat widget, resources, insights)."}`.
> Its `usage` notes cite "the reference's" colours: the background #FFFFFF, warm surface #F5F5ED, border #B3B3AF, mono, and the orange #FA3600. They also cite its "BT Grotesk scale (62/53/44/36/31/27)" and its 4.44 px spacing step.
> So MoneyView's colours and type sizes are lifted from another company's site, not just inspired by it. That does not matter for a local, single-user tool. **It matters if MoneyView is ever made public**: get a trade-dress/brand review before release, and consider re-deriving the orange and the scale.
> The design is not changed because of this. Task 1 records the note in the copied README, and Follow-ups keep the review item.

**Pre-approvals needed before Task 5.** Two existing e2e assertions encode today's colours. Under `.claude/CLAUDE.md`'s rule they are listed here, before anyone edits them:
- `tests/e2e/candle-colour.spec.ts`: `DELTA_UP` `#E54545` → `#D21F3C`, `DELTA_DOWN` `#4589E5` → `#1E5BD8`. The pixel tolerance of 24 does not cover the move: the green channel shifts by 38.
- `tests/e2e/sidebar-contrast.spec.ts`: `BLACK = rgb(0, 0, 0)` → the ink `rgb(40, 40, 40)`. The test's intent stays: bold, the same colour in every state, and the active item still marked.

## Conflicts between the redesign, the spec and the 2026-10-12 plan

| # | Before (spec or 2026-10-12 plan) | Redesign says | Resolution |
|---|---|---|---|
| R1 | Keep today's identity: mint/sage, `#FBFBFB` canvas, Rams-inspired (old D7) | Paper: `#FFFFFF` ground, `#F5F5ED`/`#F0F0F0` surfaces, ink `#282828`, brand `#FA3600` | Redesign wins (owner). Task 5 switches all values. |
| R2 | No dark mode | Two themes; `void` is the default (`Main.dc.html` `theme ?? 'void'`) | Paper only; void values never enter the token file (decision 1, tested). |
| R3 | Pretendard replaces Inter, one family | Host Grotesk (Latin) + Pretendard (Hangul) + Geist Mono (figures). The woff2 files are referenced but missing from the export. | Three OFL families, fetched as npm tarballs into a scratch directory (no dependency added), vendored to `app/fonts/` with their licences, loaded by `next/font/local` (Task 4). |
| R4 | 8 sizes (11–28 px); spec: 6–8 steps | 13 styles, `display` 62/64 down to `caption` 11/14, plus `figure`/`mono` | All 13 go into the token file, plus 4 from the redesign's own files: `panel-title` (bundle.css `.mv-panel-title`), `small` (`.mv-field-help`), `caption-ko` ("Korean captions at 12px"), `figure-md` (Main.dc.html's 32 px panel figure). **10 are app utilities.** The 6 landing-only styles (`display`, `heading-1…4`, `body-lg`) are tokens without utilities. That is two steps over the spec's 8. Dense data screens need two figure sizes and two title sizes. |
| R5 | Type is used as `text-<token>` theme utilities | `tokens.css` defines style classes that also set the family | Generated `@utility type-<style>` (family, size, line height, weight, tracking). Tailwind's `--text-*` theme keys cannot carry a font family. |
| R6 | Spec: `chart.series.1–8`; old plan: 8 colours via the dataviz skill, ≥ 0.1 apart in OKLab | `chart-1…5`; chart-1 = brand = the subject series | 5 series, as designed. Six or more categories fold the tail into "Other" in `chart-4`. The distinctness gate becomes **0.08**: the redesign's chart-3/4/5 are 0.085–0.097 apart (computed 2026-10-13). |
| R7 | Spec `value.gain/loss`; old D9 kept `state.positive/negative` canonical | `up` / `up-soft` / `down` / `down-soft` / `flat`; up `#D21F3C`, down `#1E5BD8` | Redesign names are canonical. `state-positive/negative`, `delta-up/down` and `chart-positive/negative` become deprecated aliases. |
| R8 | Status tones copied verbatim from Tailwind's amber/red/emerald so the swap is invisible | No status tones. bundle.css shows input errors in the `up` tone. | `status.error` = the up family, as bundle.css does. Warning and success derive from chart-5 and chart-2, darkened to ≥ 4.5:1 (`#7A6A00`, `#0B6E62`), with tinted surfaces. Each tone has `ink`/`surface`/`border` and nothing more. **Owner: see open question 2.** |
| R9 | Radius sm/md/lg = 4/8/12 px | `radius-0/1/2/pill` = 0/2/4/999 px | By role. Panels, tables, charts and modals take 0. Buttons, inputs and segmented controls take 1. Tooltips, menus and chips take 2. Dots take pill (M3). |
| R10 | 4 shadow tokens plus 14 raw Tailwind shadows | No shadows; 1 px hairlines | Every shadow is removed. Elevation becomes `border border-[var(--line)]`. The shadow tokens are deprecated as `none`. |
| R11 | `--space-5…8` = 24/32/48/64 px | `space-1…6, 8, 16, 32` = n × 4 px | Redesign values. `--space-5…8` have 0 references (counted 2026-10-13), so nothing moves. `--space-7` is removed. Tailwind's numeric scale already is n × 4 px (`p-6` = `--space-6`). |
| R12 | Tailwind breakpoints sm 640 / md 768 / lg 1024 | 992 / 768 / 480 | `--breakpoint-lg: 992px`, `md: 768px`, `sm: 480px` (literal `@theme` values). `xl`/`2xl` stay. The two JS `1024` checks (`AppShell.tsx:12`, `app/portfolio/page.tsx:1019`) read `tokens.bp.desktop`. No e2e viewport falls between the old and new points (widths used: 375, 390, 768, 1024, 1366, 1440, 1600). |
| R13 | Negative sign: ASCII `-` | `Delta` prints U+2212 `−` | **Keep ASCII `-`**: pasted figures stay numbers in spreadsheets, and existing assertions stay valid. If wrong, it costs one line in `formatNumber` plus the tests that pin `-`. |
| R14 | — | `Delta` shows 2 decimals and `■` for flat | Glyph `■` adopted. Percent deltas keep today's 1 decimal: 2 would change every delta assertion for no reading gain. |
| R15 | — | `Eyebrow` renders `[01] 시장 관측소 / MARKET OBSERVATORY` (slash) | Owner's style: `[01] 시장 MARKET` with no slash. The index is optional. |
| R16 | Old Task 8: pick an outside reference and extract its structure with Dembrandt | The redesign is the reference | Reference review dropped. Dembrandt stays a follow-up drift check only (old D10). |
| R17 | — | `bundle.css`: about 15 global `mv-*` classes with raw px values; `bundle.js`: demo React components | **Not imported.** The app already has the same components (`Card`, `DeltaBadge`, `DenseTable`, `KPIBlock`, `Sparkline`, `ToggleGroup`, `ActionButton`, `InlineField`), and tests depend on them. Global classes would be a second styling language that the lint rule cannot see and the theme reset cannot reach, and their px values would reintroduce raw values. The components are restyled with token utilities to match the classes (Task 8 mapping). `.mv-sr` → Tailwind `sr-only`. `.mv-row`/`.mv-stack` are demo layout and are not ported. |
| R18 | Spec: sequential palette | none | No consumer today, so it is not added (Follow-ups). |
| R19 | Heatmap: 7-step scale through mint-grey | Only `up`/`down` and their soft tints | 7 diverging steps: down, mid, down-soft, `surface`, up-soft, mid, up. The two midpoints are sRGB averages (`#81A4EB`, `#E88796`), marked "not in the redesign". |
| R20 | Spec: Monte Carlo `chart.band` | `Main.dc.html` fills under lines at opacity 0.12 | Token `chart.area-opacity` = 0.12. Bands use `chart-1` with that opacity. |
| R21 | `--text-inverse` (white) | no counterpart | `--bg` on an ink fill, `--on-brand` on a brand fill. White on `#FA3600` is only 3.8:1. |
| R22 | Motion tokens (duration/easing) | bundle.css uses 0.2–0.48 s `ease-in` inline, with no tokens | Today's motion tokens stay. Components use them. |
| R23 | — | `word-break: keep-all` on the page root | Adopted on `body`, so Hangul breaks between words. |
| R24 | — | Focus ring: 2 px brand, 2 px offset | One global `:focus-visible` rule. The per-component `focus-visible:ring-*` classes are deleted (M3). |
| R25 | — | `--surface` means warm surface `#F5F5ED`. Today `--surface` is the mint brand fill (52 uses), and `--chart-1…6` and `--type-label` also collide in name. | Task 3 first renames the colliding uses to their role (`--brand`, `--chart-primary…`, `--type-small`) while values stay put, proven by byte-identical screenshots. Only then does Task 5 change values. |
| R26 | Old plan saved captures in `test-results/` | — | Playwright empties `test-results/` at the start of every run, so `before/` would vanish on the next capture. Captures go to `apps/web/design-capture/` instead (git-ignored, Task 1). |

## Spec corrections (verified against the repo)

| # | Spec says | Repo fact | This plan does |
|---|---|---|---|
| D1 | Build the tokens | `globals.css` defines about 100 variables, used through `var(--…)` 2,429 times | Token file v1 is a 1:1 migration, proven equal (Task 2). It is kept only as the safety net before the paper switch (Task 5). |
| D2 | Tauri app, bundle fonts locally | Not Tauri. `next/font/google` self-hosts Inter, which has no Hangul. | Three vendored OFL families via `next/font/local` (R3) |
| D3 | Style Dictionary | Generated names must equal the existing `var(--x)` names; the outputs are custom | A small generator with tests, no new dependency |
| D4 | Stylelint | The values live in TSX class strings | A local ESLint rule |
| D5 | Korean copy: export → LLM → reimport | The UI is English (`<html lang="en">`) | Typed `en`/`ko` catalogs, glossary first, owner reviews the diff |
| D6 | Dark-mode tokens | Removed by the owner | None (R2) |
| D7 | Reference site first | — | Superseded by R16 |
| D8 | Put `var(--chart-series-1)` into Recharts | `TVChart.tsx` draws on a canvas, which cannot read `var()` | Canvas colours go through `resolveCssColor` with a token fallback |
| D9 | New `value.gain/loss` | — | Superseded by R7 |
| D10 | `claude mcp add … dembrandt mcp` | — | Follow-up only (R16) |
| D11 | Claude Design System artifact | It lives in claude.ai | The owner sets it from `DESIGN.md` and the paper token table (Task 14) |
| D12 | Tokens at repo-root `tokens/` | Only `apps/web` consumes them | `apps/web/tokens/` |
| D13 | 6–8 type steps | — | Superseded by R4 |
| D14 | Spec at the repo root (old plan) | The spec is at `docs/MoneyView 디자인 시스템 정형화 계획서.md` | Task 1 moves it from there |
| D15 | — | `lib/chartConfig.ts:63` uses `var(--bg-muted)`, which is never defined. The cursor fill silently renders nothing. | Fixed in Task 3 with an `ERROR-LOG.md` record. The new `unknownVar` lint check guards the class of bug. |

**Baseline (stage 0), measured 2026-10-12** over the 147 git-tracked `ts/tsx` files in `app/`, `components/`, `lib/`, `hooks/`. Task 1 re-measures it with the lint rule, and that number becomes the official baseline.

| Item | Now | Target |
|---|---|---|
| Hex / `rgb()` literals | 60 (27 unique, 17 files) | 0 outside the token file |
| Tailwind default-palette classes (`bg-amber-50` …) | 119, plus 22 black/white | 0 |
| Type: Tailwind scale / `text-[Npx]` / `--type-*` | ~650 / 13 / 115 | 10 `type-*` utilities |
| Radius outside tokens (`rounded`, `-md`, `-lg`) | 48 (token uses: ~380, mostly `--radius`) | 0; three radius roles plus `rounded-full` |
| Shadows | 14 raw + 5 token uses | 0 of either |
| Undefined `var(--x)` references | 1 (`--bg-muted`) | 0 |
| Number formatting | `toFixed(` 182, `toLocaleString(` 45, 15+ `format*` helpers | one `formatNumber` |

## Global Constraints

- Work in `apps/web` unless a path says otherwise. Run `npm` and `node` commands in `apps/web`, and `git` commands from the repo root. Use Git Bash: the commands use POSIX syntax.
- Branch: `feat/design-system-paper` from `renewal`. Never commit this work onto `feat/macro-signal-engine`.
- Baseline gates after every task: `npm run typecheck`, `npm run lint`, `npm run test:unit` (from Task 1) and the full Playwright suite must pass (last full run: 299 specs, 2026-09-27). pytest is unaffected and must stay at 1883.
- Test runners: the generator and lint-rule tests are Node scripts on `node:test`, because `RuleTester` plugs into it. They run through `npm run test:unit`. Every TS test runs through Playwright (`npx playwright test …`), as the repo already does for model tests. Every Playwright run boots the API and web harnesses from `playwright.config.ts`.
- Colour, radius and component sizes are written as `[var(--token)]` in classes. Type is written as `type-<style>`. Spacing uses Tailwind's numeric scale, which equals `--space-N`.
- Negative numbers use ASCII `-` (R13). The missing-value glyph is `—`. Percent inputs to `formatNumber` are fractions (`0.123` → `12.3%`).
- Paper theme only. Up = red ▲ +, down = blue ▼ -, flat = ink-muted ■. Never colour alone. Brand orange is for fills, never price changes.
- No new runtime or dev dependency. Fonts are vendored files.
- If an existing e2e assertion encodes an old rendered value, **stop and list it for the owner** before editing the test (`.claude/CLAUDE.md`). Task 5's two known cases are pre-listed above.
- Per `.claude/CLAUDE.md` §8, every new test is shown failing against a named mutation before it counts as verified. Each task's table names the mutations.
- `ERROR-LOG.md` is appended by concurrent branches. On a merge conflict there, keep both sides' records; taking one side deletes the other's.
- SOPs: `guideline/sop/file-structure.md` (Tasks 1–3), `test-verification.md` (all), `refactor-cleaner.md` (Tasks 8–13), `security-reviewer.md` (Task 4, vendored binaries), `code-reviewer.md` (Task 14).

## Visual review protocol

| Task | Expectation | How it is checked |
|---|---|---|
| 1 | Captures are deterministic | `before` and `before-again` are byte-identical (`capture-review.mjs --equal`) |
| 2, 3 | No visible change | `after-tokens` and `after-rename` are byte-identical to `before`. Any difference is a bug in that task. (The Task 3 cursor fix appears only on hover, which the captures do not do.) |
| 4 | Fonts change; nothing else should | Reviewed side-by-side. Look for truncation, wrapping and overflow, especially in the sidebar, tables and tiles. |
| 5 | **The switch**: every token-driven colour, radius, shadow and type size changes | Reviewed before/after against the Task 5 checklist, plus the automated `paper-identity.spec.ts` |
| 8 | Shared components take the `mv-*` look | `components-paper.spec.ts` (computed styles), plus review of `/dev/design` and every screen |
| 9–13 | Each screen loses its leftover Tailwind colours and sizes | Reviewed against the previous task's capture |
| 14 | Whole app on tokens | `paper-sweep.spec.ts` asserts that every computed colour is a token, plus a final `before` vs `final` review page for the owner |

A reviewed change is not an equality check. The reviewer (the owner, or the implementer for Task 4) writes one line per screen into Track D: "accepted" or the defect seen.

## Review Focus

1. **CRLF checkouts.** On Windows with `core.autocrlf`, committed generated files can come back with CRLF, and then `tokens:check` reports "stale" forever. → Task 2 `check treats CRLF and LF as equal`.
2. **Hex case.** The redesign writes `#fa3600`; the 1:1 file has `#E54545`. The equality tests compare lowercased colours, or a cosmetic difference hides real ones. → Task 2 `generated vars equal …`, Task 5 `paper values equal the redesign's tokens.json`.
3. **Prose that looks like a class** ("rounded to 2 places", "drop shadow"). → Task 1 RuleTester `valid` cases.
4. **First paint before the stored locale is read.** The server renders English. A Korean user must get Korean without a hydration error, and the choice must survive a reload. → Task 7 `… survives reload`, `defaults to Korean without a stored choice`.
5. **Negative zero after rounding** (`-0.04` with 1 digit). → Task 6 `rounded negative zero has no sign`. For the badge: Task 8 `rounded zero and missing read as flat`.
6. **An undefined `var(--x)` renders as nothing, silently.** The paper switch renames and deprecates hundreds of variables. → Task 3 `unknownVar`, Task 5 `deprecatedVar`, Task 5 `every pre-migration variable still resolves`.
7. **Bilingual labels and assistive tech.** Both halves are visible, but a screen reader must hear exactly one. → Task 7 exact-name `columnheader` assertions in both locales.
8. **Caption sizing by script.** Hangul is 12 px and Latin 11 px inside `.type-caption`, whatever the page language. The rule must sit in the utilities layer, or the utility beats it. → Task 7 `caption text is 12px in Hangul and 11px in Latin`.
9. **Breakpoints in `@theme inline`.** Media queries cannot read `var()`, so a breakpoint emitted as `var(--bp-desktop)` is silently ignored. → Task 5 `breakpoint theme keys are emitted as literal values` and `at 1000px wide the desktop layout applies`.
10. **Hangul falling through the Latin font.** `next/font` adds a metric-matched fallback face (local Arial) between Host Grotesk and Pretendard. If that face had Hangul, Pretendard would never be reached. → Task 4 width comparison.
11. **`Card` becoming `position: relative`** (for the corner ticks) changes the containing block of absolutely positioned descendants. → Task 8 step 4 review.

---

## File structure

| Path | Responsibility |
|---|---|
| `docs/design/redesign-2026-10/` | Tracked copy of the redesign export: `README.md`, `Main.dc.html`, `ds/moneyview/{tokens.json,tokens.css,components/bundle.css,components/bundle.js}` |
| `apps/web/tokens/moneyview.tokens.json` | The single token source (DTCG) |
| `apps/web/scripts/build-tokens.mjs` (+ `.test.mjs`) | flatten → resolve → render CSS / TS / doc table; `--check` mode |
| `apps/web/scripts/__fixtures__/globals-root-vars.baseline.json` | `:root` variables before migration (deleted in Task 14) |
| `apps/web/scripts/design-baseline.mjs` | Drift counts per category, from the lint rule |
| `apps/web/scripts/capture-review.mjs` | Byte-equality check and side-by-side review page for captures |
| `apps/web/app/tokens.generated.css`, `apps/web/lib/tokens.generated.ts` | Generated |
| `apps/web/eslint-rules/no-raw-design-values.mjs` (+ `.test.mjs`, `__fixtures__/tokens.css`) | Drift rule |
| `apps/web/app/fonts/*.woff2`, `app/fonts/OFL-*.txt` | Vendored fonts and their licences |
| `apps/web/lib/format.ts` | The one number formatter |
| `apps/web/lib/i18n/{messages/en.ts,messages/ko.ts,translate.ts,locale.ts,labels.ts}` | Catalogs, lookup, locale store, bilingual label table |
| `apps/web/components/ui/{LanguageToggle,HtmlLang,BilingualLabel,Eyebrow}.tsx` | New UI pieces |
| `apps/web/app/dev/design/page.tsx` | Component gallery: the deterministic test and review surface |
| `docs/design/MoneyView_Glossary.md` | Term table en/ko plus style rules |
| `DESIGN.md` (repo root) | Rules for people and Claude |
| `apps/web/tests/e2e/helpers/designScreens.ts` | The screen list shared by capture and sweep |
| `apps/web/tests/e2e/{design-capture,font,paper-identity,format-model,i18n-model,i18n,components-paper,theme-reset,paper-sweep}.spec.ts` | Frontend tests |

---

### Task 1: Spec and redesign in place, drift rule in warn mode, measured baseline, capture tooling

**Files:**
- Move: `docs/MoneyView 디자인 시스템 정형화 계획서.md` → `docs/superpowers/specs/2026-10-12-design-system-formalization-spec.md`
- Copy: redesign design files → `docs/design/redesign-2026-10/` (append MoneyView notes to its `README.md`)
- Create: `eslint-rules/no-raw-design-values.mjs`, `eslint-rules/no-raw-design-values.test.mjs`, `scripts/design-baseline.mjs`, `scripts/capture-review.mjs`, `tests/e2e/helpers/designScreens.ts`, `tests/e2e/design-capture.spec.ts`
- Modify: `eslint.config.mjs`, `package.json` (scripts), `.gitignore` (apps/web), `guideline/sop/todo.md`

**Interfaces:**
- Produces:
  - rule id `moneyview/no-raw-design-values` with messageIds `hex`, `colorFn`, `paletteClass`, `typeScale`, `arbitraryPx`, `lengthTypeVar`, `rawShadow`, `rawRadius`, `numericFontSize`
  - `node scripts/design-baseline.mjs [glob…]` prints `{messageId: count, total}`
  - `node scripts/capture-review.mjs <a> <b> [--equal]`
  - `DESIGN_SCREENS`, `screenName(route)` from `tests/e2e/helpers/designScreens.ts`
  - npm scripts `test:unit`, `design:baseline`

- [ ] **Step 1: Move the spec, copy the redesign, add the todo track** (repo root)

The redesign copy excludes three things:
- `MoneyView.html`: a 5.4 MB self-unpacking bundle of the same content
- `vendor/`: React runtime
- `support.js`: the export's runtime, which its README says is "not part of the design"

The root folder stays in place for the owner, because `MoneyView.html` is its only viewable form. The owner deletes it when done.

```bash
mkdir -p docs/superpowers/specs docs/design/redesign-2026-10/ds/moneyview/components
mv "docs/MoneyView 디자인 시스템 정형화 계획서.md" docs/superpowers/specs/2026-10-12-design-system-formalization-spec.md
src="Landing · 랜딩-html"
cp "$src/README.md" "$src/Main.dc.html" docs/design/redesign-2026-10/
cp "$src/ds/moneyview/tokens.json" "$src/ds/moneyview/tokens.css" docs/design/redesign-2026-10/ds/moneyview/
cp "$src/ds/moneyview/components/bundle.css" "$src/ds/moneyview/components/bundle.js" docs/design/redesign-2026-10/ds/moneyview/components/
```

Append to `docs/design/redesign-2026-10/README.md`:

```markdown

## MoneyView notes (2026-10-13)

- Copied from the untracked export `Landing · 랜딩-html/`. Not copied: `MoneyView.html` (5.4 MB
  bundle of the same content), `support.js` and `vendor/` (viewer runtime). Without them
  `Main.dc.html` does not render from this folder; it is kept for its inline values.
- MoneyView ships only the `paper` theme. The `void` values here are reference only and are not
  carried into `apps/web/tokens/moneyview.tokens.json`.
- The landing page (`Main.dc.html`) is out of scope of the 2026-10 design-system plan.
- Provenance: `tokens.json` `meta.source` says the palette and type scale were "Derived from a
  Heron AI brand extraction (heronaiapp.com)". Get a brand review before any public release.
- The font files referenced as `fonts/...` were not in the export; `apps/web/app/fonts/` holds the
  vendored copies (Task 4 of the plan).
```

In the spec, append the "Owner decisions", "Conflicts" and "Spec corrections" sections of this plan, verbatim, under `## 구현 계획에서 확정한 사항 (2026-10-13)`. In `guideline/sop/todo.md` under `## Open work`:

```markdown
### Track D: Design system (paper redesign)
Plan: `docs/superpowers/plans/2026-10-12-design-system-formalization.md`.
- [ ] D1 drift rule + baseline + redesign copy  - [ ] D2 token source (1:1)  - [ ] D3 rename collisions
- [ ] D4 fonts  - [ ] D5 paper switch  - [ ] D6 formatNumber  - [ ] D7 i18n + bilingual labels
- [ ] D8 component layer  - [ ] D9 shared UI/charts  - [ ] D10 portfolio  - [ ] D11 corporate/valuation/cases/decisions
- [ ] D12 monte-carlo  - [ ] D13 market/detail/news/events/dev/signals  - [ ] D14 lock-down
Baseline counts: (filled by D1)
Captures and review verdicts: (one line per task)
```

- [ ] **Step 2: Write the failing rule tests** (`eslint-rules/no-raw-design-values.test.mjs`)

```js
import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "./no-raw-design-values.mjs";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run("no-raw-design-values", rule, {
  valid: [
    'const a = <div className="bg-[var(--bg-surface)] type-caption rounded-[var(--radius-sm)] rounded-full shadow-[var(--shadow-modal)]" />;',
    'const note = "Values are rounded to two decimals and drawn without a shadow";',
    'const s = { stroke: "var(--chart-grid)" };',
    'const t = "text-transparent";',
    'const s = { fontSize: tokens.type.caption._ };',
  ],
  invalid: [
    { code: 'const a = <div className="bg-amber-50" />;', errors: [{ messageId: "paletteClass" }] },
    { code: 'const TONE = { error: "text-red-600" };', errors: [{ messageId: "paletteClass" }] },
    { code: 'const a = <div className="hover:text-white/85" />;', errors: [{ messageId: "paletteClass" }] },
    { code: 'const a = <div className="text-xs" />;', errors: [{ messageId: "typeScale" }] },
    { code: 'const a = <div className="text-[11px]" />;', errors: [{ messageId: "arbitraryPx" }] },
    { code: 'const a = <div className="text-[length:var(--type-caption)]" />;', errors: [{ messageId: "lengthTypeVar" }] },
    { code: 'const a = <div className="shadow-lg rounded-md" />;', errors: [{ messageId: "rawShadow" }, { messageId: "rawRadius" }] },
    { code: 'const a = clsx("p-2", ok && "rounded");', errors: [{ messageId: "rawRadius" }] },
    { code: 'const c = "#39F1C0";', errors: [{ messageId: "hex" }] },
    { code: 'const c = `rgba(0, 0, 0, ${a})`;', errors: [{ messageId: "colorFn" }] },
    { code: 'const s = { fontSize: 11 };', errors: [{ messageId: "numericFontSize" }] },
  ],
});
```

Add to `package.json` scripts:

```json
"test:unit": "node --test \"eslint-rules/**/*.test.mjs\" \"scripts/**/*.test.mjs\"",
"design:baseline": "node scripts/design-baseline.mjs"
```

Run: `npm run test:unit`. Expected FAIL: `Cannot find module './no-raw-design-values.mjs'`.

- [ ] **Step 3: Implement the rule** (`eslint-rules/no-raw-design-values.mjs`)

```js
/**
 * Design values must come from tokens (apps/web/tokens/moneyview.tokens.json).
 *
 * Colour and type-scale checks run on every string: a palette class in a lookup table is as
 * raw as one in className. Shadow and radius checks run only in class contexts, because
 * "rounded" and "shadow" are ordinary English words in UI copy.
 */
const PALETTE = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white";
const START = String.raw`(?:^|[\s"'\x60:])`;
const END = String.raw`(?=$|[\s"'\x60])`;

const EVERYWHERE = [
  ["hex", /#[0-9a-fA-F]{3,8}\b/],
  ["colorFn", /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/],
  ["paletteClass", new RegExp(`${START}(?:bg|text|border|ring|fill|stroke|from|via|to|divide|outline|decoration|placeholder|accent|caret)-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?${END}`)],
  ["typeScale", new RegExp(`${START}text-(?:xs|sm|base|lg|xl|[2-9]xl)${END}`)],
  ["arbitraryPx", new RegExp(`${START}text-\\[\\d+(?:\\.\\d+)?px\\]`)],
  ["lengthTypeVar", /text-\[length:var\(--type-/],
];
const CLASS_ONLY = [
  ["rawShadow", new RegExp(`${START}shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner|none))?${END}`)],
  ["rawRadius", new RegExp(`${START}rounded(?:-(?:xs|sm|md|lg|xl|2xl|3xl|4xl))?${END}`)],
];
const CLASS_HELPERS = new Set(["clsx", "cn", "twMerge", "cva"]);

function inClassContext(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "JSXAttribute") return p.name.name === "className";
    if (p.type === "CallExpression" && p.callee.type === "Identifier" && CLASS_HELPERS.has(p.callee.name)) return true;
    if (p.type === "Property" && (p.key.name === "className" || p.key.value === "className")) return true;
    if (p.type === "VariableDeclarator") return /class(es)?$/i.test(p.id?.name ?? "");
  }
  return false;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      hex: "Raw hex colour. Use a colour token: var(--token), or tokens.* for canvas.",
      colorFn: "Raw colour function. Use a colour token.",
      paletteClass: "Tailwind palette class. Use a colour token: bg-[var(--token)].",
      typeScale: "Tailwind type scale. Use a type utility: type-body, type-small, type-caption, ...",
      arbitraryPx: "Arbitrary px font size. Use a type utility.",
      lengthTypeVar: "Old type-token form. Use the type-<style> utility, which also sets family, weight, line height and tracking.",
      rawShadow: "Tailwind shadow. MoneyView has no shadows: use border border-[var(--line)].",
      rawRadius: "Tailwind radius. Use rounded-[var(--radius-1|2)], no class for square, or rounded-full for dots.",
      numericFontSize: "Numeric font size. Use tokens.type.<style>._ from lib/tokens.generated.ts.",
    },
  },
  create(context) {
    const check = (node, text) => {
      for (const [messageId, re] of EVERYWHERE) if (re.test(text)) context.report({ node, messageId });
      if (inClassContext(node)) {
        for (const [messageId, re] of CLASS_ONLY) if (re.test(text)) context.report({ node, messageId });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.raw);
      },
      'Property[key.name="fontSize"] > Literal'(node) {
        if (typeof node.value === "number") context.report({ node, messageId: "numericFontSize" });
      },
    };
  },
};
```

Run `npm run test:unit` → PASS.

- [ ] **Step 4: Register it in `eslint.config.mjs` as `warn`.** Add the import at the top: `import noRawDesignValues from "./eslint-rules/no-raw-design-values.mjs";`. Add this block after `...nextTs,`:

```js
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    ignores: ["lib/tokens.generated.ts"],
    plugins: { moneyview: { rules: { "no-raw-design-values": noRawDesignValues } } },
    // warn while screens migrate; Task 14 makes it an error.
    rules: { "moneyview/no-raw-design-values": "warn" },
  },
```

- [ ] **Step 5: Baseline script** (`scripts/design-baseline.mjs`)

```js
// Drift counts per category, from the lint rule itself so the baseline and the gate agree.
import { ESLint } from "eslint";

const DEFAULT = ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"];
const patterns = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const results = await new ESLint().lintFiles(patterns);
const counts = {};
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId === "moneyview/no-raw-design-values") counts[message.messageId] = (counts[message.messageId] ?? 0) + 1;
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ ...counts, total }, null, 2));
```

Run `npm run design:baseline` and paste the JSON into Track D. Expect roughly:
- hex + colorFn ≈ 60
- paletteClass ≈ 141
- typeScale ≈ 650
- arbitraryPx 13
- lengthTypeVar 115
- radius and shadow in the tens

The rule counts string nodes, not occurrences, so differences from the grep table are expected. Explain any category that is off by more than 20% before going on.

- [ ] **Step 6: Capture tooling.** Add `/design-capture/` to `apps/web/.gitignore` under `# testing`, with the comment `# DESIGN_CAPTURE screenshots; test-results/ is wiped by every Playwright run`.

`tests/e2e/helpers/designScreens.ts`:

```ts
import type { Page } from "@playwright/test";
import { mockCasesApi } from "./casesApiMock";
import { mockCorporatePageApi } from "./corporatePageMock";
import { mockDecisionsApi } from "./decisionsPageMock";
import { mockEventsApi } from "./eventsApiMock";
import { mockMarketPageApi } from "./marketPageMock";
import { mockPortfolioPageApi } from "./portfolioPageMock";
import { mockValuationApi } from "./valuationPageMock";

/** Screens captured for visual review (design-capture) and swept for token colours (Task 14). */
export const DESIGN_SCREENS: [string, (page: Page) => Promise<unknown>][] = [
  ["/", (p) => mockMarketPageApi(p)],
  ["/portfolio", (p) => mockPortfolioPageApi(p)],
  ["/corporate", (p) => mockCorporatePageApi(p)],
  ["/valuation", (p) => mockValuationApi(p)],
  ["/decisions", (p) => mockDecisionsApi(p)],
  ["/cases", (p) => mockCasesApi(p)],
  ["/events", async (p) => { await mockMarketPageApi(p); await mockEventsApi(p); }],
];

export const screenName = (route: string) => (route === "/" ? "market" : route.slice(1).replaceAll("/", "-"));
```

Open each helper before writing this file. Pass whatever arguments its signature requires (`mockDecisionsApi` is at `helpers/decisionsPageMock.ts:53`). `typecheck` catches a wrong call.

`tests/e2e/design-capture.spec.ts`:

```ts
import { test } from "@playwright/test";
import { DESIGN_SCREENS, screenName } from "./helpers/designScreens";

test.skip(!process.env.DESIGN_CAPTURE, "set DESIGN_CAPTURE=<label> to capture screens");

for (const [route, mock] of DESIGN_SCREENS) {
  test(`capture ${route}`, async ({ page }) => {
    // A fixed clock keeps "updated N min ago" and other date-relative text identical between
    // runs; the byte-equality checks of Tasks 1-3 depend on it.
    await page.clock.setFixedTime(new Date("2026-10-12T06:30:00Z"));
    await mock(page);
    await page.goto(route, { waitUntil: "networkidle" });
    await page.waitForTimeout(600); // past recharts' 400 ms animation
    await page.screenshot({
      path: `design-capture/${process.env.DESIGN_CAPTURE}/${screenName(route)}.png`,
      fullPage: true,
      animations: "disabled",
    });
  });
}
```

`scripts/capture-review.mjs`:

```js
// Compare two DESIGN_CAPTURE folders under apps/web/design-capture/.
//   node scripts/capture-review.mjs <a> <b> --equal   exit 1 unless every PNG is byte-identical
//   node scripts/capture-review.mjs <a> <b>           write design-capture/review-<a>-vs-<b>.html
// Chromium encodes identical pixels to identical PNG bytes, so byte equality is pixel equality.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "design-capture";
const [a, b] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (!a || !b) {
  console.error("usage: capture-review.mjs <a> <b> [--equal]");
  process.exit(2);
}
const pngs = (dir) => (existsSync(path.join(ROOT, dir)) ? readdirSync(path.join(ROOT, dir)).filter((n) => n.endsWith(".png")) : []);
const names = [...new Set([...pngs(a), ...pngs(b)])].sort();
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (process.argv.includes("--equal")) {
  const differing = names.filter((n) => {
    const [x, y] = [path.join(ROOT, a, n), path.join(ROOT, b, n)];
    return !existsSync(x) || !existsSync(y) || hash(x) !== hash(y);
  });
  if (!names.length || differing.length) {
    console.error(names.length ? `differs: ${differing.join(", ")}` : "no captures found");
    process.exit(1);
  }
  console.log(`${names.length} screens byte-identical`);
} else {
  const rows = names.map((n) => `<h2>${n}</h2><div class="pair"><img src="${a}/${n}"><img src="${b}/${n}"></div>`).join("\n");
  const out = path.join(ROOT, `review-${a}-vs-${b}.html`);
  writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>${a} vs ${b}</title><style>.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}img{width:100%;border:1px solid}</style><h1>${a} (left) / ${b} (right)</h1>\n${rows}\n`);
  console.log(`open ${out}`);
}
```

Capture twice and prove the captures are deterministic:

```bash
DESIGN_CAPTURE=before npx playwright test tests/e2e/design-capture.spec.ts
DESIGN_CAPTURE=before-again npx playwright test tests/e2e/design-capture.spec.ts
node scripts/capture-review.mjs before before-again --equal
```

Expected: `7 screens byte-identical`. If a screen differs, open both PNGs and find the element that changed, such as a live timer, a random id or a caret. Add it to that capture as `mask: [page.locator("<that element's selector>")]` in the `screenshot` options. Re-run both captures until `--equal` passes, and name each mask in Track D.

- [ ] **Step 7: Mutation matrix**

| Mutation | Must fail |
|---|---|
| delete `\|black\|white` from `PALETTE` | RuleTester invalid case `hover:text-white/85` |
| `inClassContext` always returns `true` | RuleTester valid case "Values are rounded … shadow" |
| overwrite `design-capture/before-again/market.png` with `cases.png` | `capture-review.mjs before before-again --equal` exits 1 naming `market.png` |

Restore each mutation after it fails.

- [ ] **Step 8: Gate and commit.** `npm run typecheck && npm run lint && npm run test:unit` must pass; the rule only warns.

```bash
git add docs/superpowers/specs/2026-10-12-design-system-formalization-spec.md docs/design/redesign-2026-10 guideline/sop/todo.md apps/web/eslint-rules apps/web/eslint.config.mjs apps/web/scripts/design-baseline.mjs apps/web/scripts/capture-review.mjs apps/web/package.json apps/web/.gitignore apps/web/tests/e2e/design-capture.spec.ts apps/web/tests/e2e/helpers/designScreens.ts
git commit -m "chore(design): redesign reference copy, drift lint rule in warn mode, baseline and capture tooling"
```

---

### Task 2: Token source and generator, 1:1 with today's `globals.css`

This task only proves the pipeline. The values it writes are replaced in Task 5, but they must first reproduce today's screens byte for byte. That is how the generator, the import order and the Tailwind wiring are shown correct before anything visible depends on them.

**Files:**
- Create: `scripts/build-tokens.mjs`, `scripts/build-tokens.test.mjs`, `scripts/__fixtures__/globals-root-vars.baseline.json`, `tokens/moneyview.tokens.json`, `app/tokens.generated.css`, `lib/tokens.generated.ts`
- Modify: `app/globals.css` (the `:root` block is replaced by `@import "./tokens.generated.css";`), `docs/design/MoneyView_Design_Tokens.md` (generated markers), `package.json` (`tokens`, `tokens:check`; `lint` runs `tokens:check` first)

**Interfaces:**
- Produces:
  - `flatten(tree) -> Map<id, {path, value, deprecated, description, theme}>`
  - `resolve(map) -> Map` (references `{a.b}` resolved; unknown refs and cycles throw)
  - `cssName(path)`: segments joined with `-`, a `_` segment dropped
  - `emitted(resolved)`: excludes the top-level `palette` group
  - `renderCss(resolved, resets)`, `renderTs(resolved)`, `renderDocTable(resolved)`, `spliceDoc(doc, table)`
  - `parseRootVars(css) -> Record<string,string>`, `sameText(a, b)`, `PATHS`
  - `lib/tokens.generated.ts` exports `tokens` (nested; a group's own value is under `_`) and `type Tokens`
  - Token extension `"$extensions": {"moneyview.theme": "--font-sans"}` emits that Tailwind theme key; root extension `"moneyview.themeReset": [...]` emits `@theme { X: initial; }`
  - Tree shape: `group → name → token`. The group is the first `-` segment of the CSS name (`--type-page-title` → `type["page-title"]`). A one-segment name that is also a group prefix lives under `_` (`--surface` → `surface._`).

- [ ] **Step 1: Freeze today's variables.** One-off; commit the output.

```bash
node -e '
const fs = require("fs");
const css = fs.readFileSync("app/globals.css", "utf8");
const start = css.indexOf(":root {");
const root = css.slice(start, css.indexOf("}", start));
const vars = Object.fromEntries([...root.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)].map(m => [m[1], m[2].trim()]));
fs.mkdirSync("scripts/__fixtures__", { recursive: true });
fs.writeFileSync("scripts/__fixtures__/globals-root-vars.baseline.json", JSON.stringify(vars, null, 2) + "\n");
console.log(Object.keys(vars).length, "variables");'
```

- [ ] **Step 2: Write the failing generator tests** (`scripts/build-tokens.test.mjs`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PATHS, cssName, emitted, flatten, parseRootVars, renderCss, renderTs, resolve, sameText, spliceDoc,
} from "./build-tokens.mjs";

const tree = {
  palette: { red: { 500: { $type: "color", $value: "#E54545" } } },
  state: { positive: { $type: "color", $value: "{palette.red.500}" } },
  delta: { up: { $type: "color", $value: "{state.positive}", $deprecated: "use state.positive" } },
  radius: { _: { $value: "0.5rem" }, sm: { $value: "4px" } },
  type: { caption: { _: { $value: "11px", $extensions: { "moneyview.theme": "--text-caption" } } } },
};

test("references resolve through chains and primitives are not emitted", () => {
  const resolved = resolve(flatten(tree));
  assert.equal(resolved.get("delta.up").value, "#E54545");
  assert.deepEqual(emitted(resolved).map((t) => cssName(t.path)),
    ["--state-positive", "--delta-up", "--radius", "--radius-sm", "--type-caption"]);
});

test("unknown references and cycles are refused", () => {
  assert.throws(() => resolve(flatten({ a: { $value: "{nope}" } })), /unknown token reference \{nope\}/);
  assert.throws(() => resolve(flatten({ a: { $value: "{b}" }, b: { $value: "{a}" } })), /cycle/);
});

test("css has the root vars, the reset block and the theme mapping", () => {
  const css = renderCss(resolve(flatten(tree)), ["--color-*"]);
  assert.equal(parseRootVars(css)["--radius"], "0.5rem");
  assert.match(css, /@theme \{\n {2}--color-\*: initial;\n\}/);
  assert.match(css, /@theme inline \{\n {2}--text-caption: var\(--type-caption\);\n\}/);
});

test("ts output nests values and keeps a group's own value under _", () => {
  assert.match(renderTs(resolve(flatten(tree))), /"radius": \{\n\s+"_": "0.5rem",\n\s+"sm": "4px"/);
});

test("check treats CRLF and LF as equal", () => {
  assert.ok(sameText("a\r\nb\r\n", "a\nb\n"));
  assert.ok(!sameText("a\nb\n", "a\nc\n"));
});

test("splice refuses a doc without markers", () => {
  assert.throws(() => spliceDoc("no markers", "| t |"), /markers/);
});

test("generated vars equal the pre-migration globals.css", () => {
  const baseline = JSON.parse(readFileSync(new URL("./__fixtures__/globals-root-vars.baseline.json", import.meta.url)));
  const tokens = JSON.parse(readFileSync(PATHS.source, "utf8"));
  const generated = parseRootVars(renderCss(resolve(flatten(tokens)), []));
  const norm = (v) => (/^#[0-9a-f]+$/i.test(v) ? v.toLowerCase() : v.replace(/\s+/g, " "));
  for (const [name, value] of Object.entries(baseline)) {
    assert.ok(name in generated, `${name} is missing from the token file`);
    assert.equal(norm(generated[name]), norm(value), `${name} changed value`);
  }
});
```

Run: `npm run test:unit`. Expected FAIL: `Cannot find module './build-tokens.mjs'`.

- [ ] **Step 3: Implement `scripts/build-tokens.mjs`**

```js
/**
 * apps/web/tokens/moneyview.tokens.json -> app/tokens.generated.css, lib/tokens.generated.ts
 * and the generated section of docs/design/MoneyView_Design_Tokens.md.
 *
 * Not Style Dictionary: generated names must equal the var(--x) names already in use, and the
 * outputs are custom. A token path joins with "-" into its CSS name; a segment "_" is the
 * group's own value (radius._ -> --radius, radius.sm -> --radius-sm).
 * The top-level "palette" group holds primitives: referenced, never emitted.
 *
 *   node scripts/build-tokens.mjs           write the outputs
 *   node scripts/build-tokens.mjs --check   fail if any output is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PATHS = {
  source: path.join(ROOT, "tokens/moneyview.tokens.json"),
  css: path.join(ROOT, "app/tokens.generated.css"),
  ts: path.join(ROOT, "lib/tokens.generated.ts"),
  doc: path.resolve(ROOT, "../../docs/design/MoneyView_Design_Tokens.md"),
};
const PRIVATE_GROUPS = new Set(["palette"]);
const REF = /^\{([^}]+)\}$/;
const START = "<!-- tokens:generated:start -->";
const END = "<!-- tokens:generated:end -->";
const BANNER = "GENERATED by apps/web/scripts/build-tokens.mjs from tokens/moneyview.tokens.json. Do not edit.";

export function flatten(tree, prefix = []) {
  const out = new Map();
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith("$") || node === null || typeof node !== "object") continue;
    const p = [...prefix, key];
    if ("$value" in node) {
      out.set(p.join("."), {
        path: p, value: node.$value, deprecated: node.$deprecated ?? null,
        description: node.$description ?? "", theme: node.$extensions?.["moneyview.theme"] ?? null,
      });
    } else {
      for (const [id, token] of flatten(node, p)) out.set(id, token);
    }
  }
  return out;
}

export function resolve(tokens) {
  const resolved = new Map();
  const visit = (id, stack) => {
    if (resolved.has(id)) return resolved.get(id).value;
    if (stack.includes(id)) throw new Error(`reference cycle: ${[...stack, id].join(" -> ")}`);
    const token = tokens.get(id);
    if (!token) throw new Error(`unknown token reference {${id}}${stack.length ? ` in ${stack.at(-1)}` : ""}`);
    const match = typeof token.value === "string" ? REF.exec(token.value) : null;
    const value = match ? visit(match[1], [...stack, id]) : token.value;
    resolved.set(id, { ...token, value });
    return value;
  };
  for (const id of tokens.keys()) visit(id, []);
  return new Map([...tokens.keys()].map((id) => [id, resolved.get(id)]));
}

export const cssName = (p) => `--${p.filter((s) => s !== "_").join("-")}`;
export const emitted = (resolved) => [...resolved.values()].filter((t) => !PRIVATE_GROUPS.has(t.path[0]));
export const sameText = (a, b) => a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

export function renderCss(resolved, resets) {
  const tokens = emitted(resolved);
  let css = `/* ${BANNER} */\n:root {\n${tokens.map((t) => `  ${cssName(t.path)}: ${t.value};`).join("\n")}\n}\n`;
  if (resets.length) css += `\n@theme {\n${resets.map((r) => `  ${r}: initial;`).join("\n")}\n}\n`;
  const themed = tokens.filter((t) => t.theme);
  if (themed.length) css += `\n@theme inline {\n${themed.map((t) => `  ${t.theme}: var(${cssName(t.path)});`).join("\n")}\n}\n`;
  return css;
}

export function renderTs(resolved) {
  const root = {};
  for (const t of emitted(resolved)) {
    let node = root;
    for (const segment of t.path.slice(0, -1)) node = node[segment] ??= {};
    node[t.path.at(-1)] = t.value;
  }
  return `// ${BANNER}\nexport const tokens = ${JSON.stringify(root, null, 2)} as const;\n\nexport type Tokens = typeof tokens;\n`;
}

export function renderDocTable(resolved) {
  const rows = emitted(resolved).map((t) =>
    `| \`${t.path.filter((s) => s !== "_").join(".")}\` | \`${cssName(t.path)}\` | \`${t.value}\` | ${t.deprecated ? `deprecated: ${t.deprecated}` : t.description} |`);
  return ["| Token | CSS variable | Value | Notes |", "|---|---|---|---|", ...rows].join("\n");
}

export function spliceDoc(doc, table) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a < 0 || b < a) throw new Error(`token doc is missing the ${START} / ${END} markers`);
  return `${doc.slice(0, a + START.length)}\n<!-- ${BANNER} -->\n${table}\n${doc.slice(b)}`;
}

export function parseRootVars(css) {
  const start = css.indexOf(":root {");
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...block.matchAll(/^\s*(--[\w-]+)\s*:\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

function readOr(file) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tree = JSON.parse(readFileSync(PATHS.source, "utf8"));
  const resolved = resolve(flatten(tree));
  const outputs = [
    [PATHS.css, renderCss(resolved, tree.$extensions?.["moneyview.themeReset"] ?? [])],
    [PATHS.ts, renderTs(resolved)],
    [PATHS.doc, spliceDoc(readOr(PATHS.doc), renderDocTable(resolved))],
  ];
  if (process.argv.includes("--check")) {
    const stale = outputs.filter(([file, content]) => !sameText(readOr(file), content)).map(([file]) => path.relative(ROOT, file));
    if (stale.length) {
      console.error(`Stale generated token files: ${stale.join(", ")}. Run: npm run tokens`);
      process.exit(1);
    }
  } else {
    for (const [file, content] of outputs) writeFileSync(file, content);
  }
}
```

- [ ] **Step 4: Write `tokens/moneyview.tokens.json` from the frozen variables.** One-off converter: the group is the first `-` segment, the rest stays one key, and a one-segment name that also prefixes others goes under `_`.

```bash
node -e '
const fs = require("fs");
const vars = require("./scripts/__fixtures__/globals-root-vars.baseline.json");
const names = Object.keys(vars);
const type = (v) => /^#|^rgba?\(/.test(v) ? "color" : /^-?[\d.]+(px|rem)$/.test(v) ? "dimension" : /^\d+ms$/.test(v) ? "duration" : undefined;
const tree = { $description: "MoneyView design tokens (DTCG). Values are CSS strings; $type is set for color, dimension and duration only." };
for (const name of names) {
  const [group, ...rest] = name.slice(2).split("-");
  const token = { ...(type(vars[name]) ? { $type: type(vars[name]) } : {}), $value: vars[name] };
  if (rest.length) (tree[group] ??= {})[rest.join("-")] = token;
  else if (names.some((n) => n.startsWith(name + "-"))) (tree[group] ??= {})._ = token;
  else tree[group] = token;
}
fs.mkdirSync("tokens", { recursive: true });
fs.writeFileSync("tokens/moneyview.tokens.json", JSON.stringify(tree, null, 2) + "\n");'
```

- [ ] **Step 5: Wire it in.**
  - In `docs/design/MoneyView_Design_Tokens.md`, add a final section `## Generated token table` containing the two marker lines `<!-- tokens:generated:start -->` and `<!-- tokens:generated:end -->`. Leave the existing prose.
  - In `app/globals.css`, delete every custom-property line inside `@layer base { :root { … } }`, keeping `body`, `.tabular-nums` and the utilities. Add `@import "./tokens.generated.css";` directly after `@import "tailwindcss";`. Remove the now-empty `:root {}`.
  - In `package.json`: add `"tokens": "node scripts/build-tokens.mjs"` and `"tokens:check": "node scripts/build-tokens.mjs --check"`, and change `"lint"` to `"npm run tokens:check && eslint"`.
  - Run `npm run tokens`.

- [ ] **Step 6: Verify there is no visual change**

```bash
npm run test:unit && npm run typecheck && npm run lint && npx playwright test
DESIGN_CAPTURE=after-tokens npx playwright test tests/e2e/design-capture.spec.ts
node scripts/capture-review.mjs before after-tokens --equal
```

Expected: `7 screens byte-identical`. Any difference is a bug in this task.

- [ ] **Step 7: Mutation matrix**

| Mutation | Must fail |
|---|---|
| change one value in the token file (`#E54545` → `#E54546`) | `generated vars equal the pre-migration globals.css` |
| `sameText` without the CRLF replace | `check treats CRLF and LF as equal` |
| `cssName` without `.filter((s) => s !== "_")` | `references resolve…` (`--radius-_`) |
| edit `app/tokens.generated.css` by hand, run `npm run tokens:check` | exits 1 naming the file |
| move the `@import "./tokens.generated.css"` above `@import "tailwindcss"` | `capture-review.mjs before after-tokens --equal` (re-capture first) |

- [ ] **Step 8: Commit**

```bash
git add apps/web/scripts apps/web/tokens apps/web/app/tokens.generated.css apps/web/lib/tokens.generated.ts apps/web/app/globals.css apps/web/package.json docs/design/MoneyView_Design_Tokens.md
git commit -m "feat(design): single DTCG token source generating CSS, TS and docs (no visual change)"
```

---

### Task 3: Make room for the paper names: rename collisions, check undefined variables

Some names mean one thing today and another in the redesign. The paper switch cannot change their values in place:
- `--surface`: mint brand fill now, warm surface in paper
- `--chart-1…6`: mint series now, paper series
- `--type-label`: 13 px now, a 15 px semibold style in paper

The uses are renamed to role names first, while the values stay identical (R25). This task also adds the `unknownVar` check that guards every rename that follows.

**Files:**
- Modify: every file under `app/ components/ lib/ hooks/` that uses `var(--surface)`, `var(--chart-1…6)` or `var(--type-label)` (rename only)
- Modify: `tokens/moneyview.tokens.json`, `scripts/__fixtures__/globals-root-vars.baseline.json`, `lib/chartConfig.ts` (`--bg-muted`)
- Modify: `eslint-rules/no-raw-design-values.mjs`, `eslint-rules/no-raw-design-values.test.mjs`; Create: `eslint-rules/__fixtures__/tokens.css`
- Modify: `ERROR-LOG.md` (repo root)

**Interfaces:**
- Consumes: `app/tokens.generated.css` (Task 2)
- Produces:
  - tokens `brand` (`#60caad` for now), `type.small` (13 px for now); `surface._`, `chart.1…6` and `type.label` removed
  - messageId `unknownVar`
  - shared ESLint setting `settings.moneyview.tokensCss` (defaults to `app/tokens.generated.css`)

- [ ] **Step 1: Write the failing rule test.** Create `eslint-rules/__fixtures__/tokens.css`:

```css
:root {
  --bg-surface: #ffffff;
  --chart-grid: #f0f2ec;
  --radius-sm: 4px;
  --shadow-modal: 0 4px 24px rgba(0, 0, 0, 0.08);
  --fixture-only: #000000;
}
```

`--fixture-only` exists only here. A valid case that uses it proves the rule reads the fixture through the setting, not the live token file.

In `no-raw-design-values.test.mjs`, add `import { fileURLToPath } from "node:url";`. Pass the fixture to the tester, so the tests do not depend on the live token file:

```js
const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  settings: { moneyview: { tokensCss: fileURLToPath(new URL("./__fixtures__/tokens.css", import.meta.url)) } },
});
```

Add to `valid`:

```js
    'const a = <main className="pt-[var(--main-pad-top)] [--main-pad-top:5rem]" />;',
    'const f = "var(--font-pretendard)";',
    'const s = { stroke: "var(--fixture-only)" };',
```

Add to `invalid`:

```js
    { code: 'const s = { fill: "var(--bg-muted)" };', errors: [{ messageId: "unknownVar" }] },
    { code: 'const a = <div className="bg-[var(--surface)]" />;', errors: [{ messageId: "unknownVar" }] },
```

Run `npm run test:unit`. Expected FAIL: the two invalid cases report no error.

- [ ] **Step 2: Implement `unknownVar`.** In `no-raw-design-values.mjs`, add at the top:

```js
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TOKENS_CSS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../app/tokens.generated.css");
// Custom properties that legitimately live outside the token file: next/font families,
// Tailwind internals, and AppShell's locally scoped padding.
const LOCAL_VAR = /^--(?:font-|tw-|main-pad-)/;
const VAR_REF = /var\((--[\w-]+)/g;
const tokenCache = new Map();

/** Names defined in the generated token CSS. An undefined var() renders as nothing, silently. */
function tokenVars(file) {
  if (!tokenCache.has(file)) {
    const known = new Set();
    const deprecated = new Set();
    for (const m of readFileSync(file, "utf8").matchAll(/^\s*(--[\w-]+)\s*:[^;]*;(\s*\/\* deprecated)?/gm)) {
      known.add(m[1]);
      if (m[2]) deprecated.add(m[1]);
    }
    tokenCache.set(file, { known, deprecated });
  }
  return tokenCache.get(file);
}
```

Add to `meta.messages`:

```js
      unknownVar: "{{name}} is not defined in app/tokens.generated.css; an undefined var() renders as nothing.",
```

In `create(context)`, before `const check`, add:

```js
    const vars = tokenVars(context.settings?.moneyview?.tokensCss ?? DEFAULT_TOKENS_CSS);
```

At the end of `check`, add:

```js
      for (const [, name] of text.matchAll(VAR_REF)) {
        if (LOCAL_VAR.test(name)) continue;
        if (!vars.known.has(name)) context.report({ node, messageId: "unknownVar", data: { name } });
      }
```

The `deprecated` set is collected now and used in Task 5. Run `npm run test:unit` → PASS. Then run `npm run design:baseline`. Expected: `unknownVar: 1` (`lib/chartConfig.ts`, `--bg-muted`). Any other hit is a defect of the same kind: list it in Track D and fix it in Step 4.

- [ ] **Step 3: Rename the colliding uses** (values unchanged)

```bash
git grep -lz -E "var\(--surface\)|var\(--chart-[1-6]\)|var\(--type-label\)" -- app components lib hooks | xargs -0 sed -i -E \
  -e 's/var\(--surface\)/var(--brand)/g' \
  -e 's/var\(--chart-1\)/var(--chart-primary)/g' -e 's/var\(--chart-2\)/var(--chart-secondary)/g' \
  -e 's/var\(--chart-3\)/var(--chart-tertiary)/g' -e 's/var\(--chart-4\)/var(--chart-muted)/g' \
  -e 's/var\(--chart-5\)/var(--chart-label)/g' -e 's/var\(--chart-6\)/var(--chart-ink)/g' \
  -e 's/var\(--type-label\)/var(--type-small)/g'
git grep -nE "var\(--surface\)|var\(--chart-[1-6]\)|var\(--type-label\)" -- app components lib hooks tests
```

The last command must print nothing.

In `tokens/moneyview.tokens.json`:
- delete `surface._` and add a top-level `"brand": { "$type": "color", "$value": "#60caad" }`
- delete `chart["1"]` … `chart["6"]`; each value lives on in `chart.primary`, `secondary`, `tertiary`, `muted`, `label`, `ink`
- rename the key `type.label` to `type.small`

Update the fixture the same way, so the equivalence test keeps checking every surviving value:

```bash
node -e '
const fs = require("fs"); const f = "scripts/__fixtures__/globals-root-vars.baseline.json";
const v = JSON.parse(fs.readFileSync(f, "utf8"));
v["--brand"] = v["--surface"]; delete v["--surface"];
v["--type-small"] = v["--type-label"]; delete v["--type-label"];
for (let i = 1; i <= 6; i++) delete v["--chart-" + i];
fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n");'
npm run tokens
```

- [ ] **Step 4: Fix the undefined cursor fill.** In `lib/chartConfig.ts:63`, change `fill: "var(--bg-muted)"` to `fill: "var(--surface-muted)"`. Add this record to `ERROR-LOG.md`, directly above the newest entry:

```text
## 2026-10-13: chart hover cursor filled with an undefined variable

Date: 2026-10-13
Command: `npm run design:baseline` (unknownVar check, Task 3 of the design-system plan)
Failure: `lib/chartConfig.ts` gave the Recharts tooltip cursor `fill: "var(--bg-muted)"`. No
`--bg-muted` was ever defined, so the fill was invalid at computed-value time and the cursor
fell back to whatever the SVG inherited. No error, no warning.
Root cause: a token name typed from memory; nothing compared `var(--x)` references with the
defined set.
Fix: `var(--surface-muted)`, the muted ground the cursor was meant to use.
Files changed: apps/web/lib/chartConfig.ts, apps/web/eslint-rules/no-raw-design-values.mjs
Prevention: the lint rule's `unknownVar` check reports any `var(--x)` that
app/tokens.generated.css does not define (Task 14 makes it an error).
```

- [ ] **Step 5: Verify**

```bash
npm run test:unit && npm run typecheck && npm run lint && npm run design:baseline && npx playwright test
DESIGN_CAPTURE=after-rename npx playwright test tests/e2e/design-capture.spec.ts
node scripts/capture-review.mjs before after-rename --equal
```

Expected: `unknownVar` absent from the baseline output, and `7 screens byte-identical`.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| revert one rename in one file (`var(--brand)` → `var(--surface)`) | `design:baseline` reports `unknownVar: 1`; the `--equal` check names that screen if it is captured |
| remove `font-\|` from `LOCAL_VAR` | RuleTester valid case `var(--font-pretendard)` |
| `tokenVars` ignores the settings and always reads `DEFAULT_TOKENS_CSS` | RuleTester valid case `var(--fixture-only)` |
| restore `var(--bg-muted)` in `chartConfig.ts` | `design:baseline` reports `unknownVar: 1` |

- [ ] **Step 7: Commit**

```bash
git add apps/web/app apps/web/components apps/web/lib apps/web/hooks apps/web/tokens apps/web/scripts apps/web/eslint-rules ERROR-LOG.md docs/design/MoneyView_Design_Tokens.md
git commit -m "refactor(design): rename tokens that collide with the paper names; reject undefined var() (fix chart cursor)"
```

---

### Task 4: Fonts: Host Grotesk, Pretendard, Geist Mono

**Files:**
- Create: `app/fonts/HostGrotesk-Variable-latin.woff2`, `app/fonts/PretendardVariable.woff2`, `app/fonts/GeistMono-{400,500,600}-latin.woff2`, `app/fonts/OFL-HostGrotesk.txt`, `app/fonts/OFL-Pretendard.txt`, `app/fonts/OFL-GeistMono.txt`, `tests/e2e/font.spec.ts`
- Modify: `app/layout.tsx`, `tokens/moneyview.tokens.json` (`font.family.sans`, `font.family.mono`), `app/globals.css`

**Interfaces:**
- Produces:
  - CSS vars `--font-host-grotesk`, `--font-pretendard`, `--font-geist-mono` (next/font)
  - tokens `font.family.sans` → `--font-family-sans` (Tailwind `--font-sans`) and `font.family.mono` → `--font-family-mono` (Tailwind `--font-mono`)

- [ ] **Step 1: Write the failing test** (`tests/e2e/font.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

test("Host Grotesk sets Latin, Pretendard sets Hangul, Geist Mono sets figures", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "networkidle" });
  const r = await page.evaluate(async () => {
    const root = getComputedStyle(document.documentElement);
    const v = (name: string) => root.getPropertyValue(name).trim();
    const f = { sans: v("--font-family-sans"), mono: v("--font-family-mono"), host: v("--font-host-grotesk"), pre: v("--font-pretendard"), geist: v("--font-geist-mono") };
    await Promise.all([
      document.fonts.load(`500 40px ${f.host}`, "Market"),
      document.fonts.load(`500 40px ${f.pre}`, "시장"),
      document.fonts.load(`500 40px ${f.geist}`, "0123"),
    ]);
    const width = (text: string, family: string) => {
      const el = document.createElement("span");
      Object.assign(el.style, { fontFamily: family, fontSize: "40px", fontWeight: "500", position: "absolute", whiteSpace: "nowrap" });
      el.textContent = text;
      document.body.appendChild(el);
      return el.getBoundingClientRect().width;
    };
    const loaded = [...document.fonts].filter((x) => x.status === "loaded").map((x) => x.family.toLowerCase());
    return {
      f, loaded,
      latinSans: width("Market overview", f.sans), latinHost: width("Market overview", f.host), latinPre: width("Market overview", f.pre),
      hangulSans: width("시장 개요 가치평가", f.sans), hangulPre: width("시장 개요 가치평가", f.pre), hangulSerif: width("시장 개요 가치평가", "serif"),
      ones: width("111.11", f.mono), eights: width("888.88", f.mono), geistOnes: width("111.11", f.geist),
    };
  });
  for (const value of Object.values(r.f)) expect(value, "a font variable is empty").not.toBe("");
  for (const name of ["hostgrotesk", "pretendard", "geistmono"]) expect(r.loaded.some((x) => x.includes(name)), `${name} loaded`).toBe(true);
  expect(Math.abs(r.latinSans - r.latinHost)).toBeLessThan(0.5); // Latin comes from Host Grotesk
  expect(Math.abs(r.latinHost - r.latinPre)).toBeGreaterThan(2); // ...which is measurably not Pretendard
  expect(Math.abs(r.hangulSans - r.hangulPre)).toBeLessThan(0.5); // Hangul falls through to Pretendard
  expect(Math.abs(r.hangulPre - r.hangulSerif)).toBeGreaterThan(2); // ...and Pretendard really rendered
  expect(Math.abs(r.ones - r.eights)).toBeLessThan(0.5); // figures are fixed-width
  expect(Math.abs(r.ones - r.geistOnes)).toBeLessThan(0.5); // ...because they are Geist Mono
});
```

Run `npx playwright test tests/e2e/font.spec.ts`. Expected FAIL: `a font variable is empty`.

- [ ] **Step 2: Vendor the fonts.** All three come from the npm registry as tarballs, fetched into a scratch directory outside the repo. Nothing is installed and no `package.json` changes. Package names and file paths were checked on 2026-10-13: `pretendard@1.3.9` (OFL-1.1), `@fontsource-variable/host-grotesk@5.3.0` (OFL-1.1), `@fontsource/geist-mono@5.3.0` (OFL-1.1).

```bash
scratch="$(mktemp -d)"
( cd "$scratch" && npm pack pretendard@1.3.9 @fontsource-variable/host-grotesk@5.3.0 @fontsource/geist-mono@5.3.0 --silent )
for t in "$scratch"/*.tgz; do mkdir -p "${t%.tgz}" && tar -xzf "$t" -C "${t%.tgz}"; done
mkdir -p app/fonts
cp "$scratch/pretendard-1.3.9/package/dist/web/variable/woff2/PretendardVariable.woff2" app/fonts/PretendardVariable.woff2
cp "$scratch/pretendard-1.3.9/package/dist/LICENSE.txt" app/fonts/OFL-Pretendard.txt
cp "$scratch/fontsource-variable-host-grotesk-5.3.0/package/files/host-grotesk-latin-wght-normal.woff2" app/fonts/HostGrotesk-Variable-latin.woff2
cp "$scratch/fontsource-variable-host-grotesk-5.3.0/package/LICENSE" app/fonts/OFL-HostGrotesk.txt
for w in 400 500 600; do cp "$scratch/fontsource-geist-mono-5.3.0/package/files/geist-mono-latin-$w-normal.woff2" "app/fonts/GeistMono-$w-latin.woff2"; done
cp "$scratch/fontsource-geist-mono-5.3.0/package/LICENSE" app/fonts/OFL-GeistMono.txt
grep -l "SIL Open Font License, Version 1.1" app/fonts/OFL-*.txt
```

Expected: all three licence files listed. Record the three package versions and the licence check in Track D. (`security-reviewer.md`: these are binaries from the public registry at pinned versions, and no install scripts run.)

- [ ] **Step 3: Load them.** In `app/layout.tsx`, replace `import { Inter } from "next/font/google";` and the `inter` constant with:

```tsx
import localFont from "next/font/local";

// All three are SIL OFL 1.1 (commercial use, embedding and redistribution allowed); licence
// texts sit beside the files in app/fonts. Latin: Host Grotesk. Hangul: Pretendard (the Latin
// subset has no Hangul, so the stack falls through to it). Figures: Geist Mono.
const hostGrotesk = localFont({
  src: "./fonts/HostGrotesk-Variable-latin.woff2",
  variable: "--font-host-grotesk",
  weight: "300 800",
  display: "swap",
});

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
});

const geistMono = localFont({
  src: [
    { path: "./fonts/GeistMono-400-latin.woff2", weight: "400", style: "normal" },
    { path: "./fonts/GeistMono-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/GeistMono-600-latin.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-geist-mono",
  display: "swap",
});
```

Change the body class `${inter.variable} font-sans …` to `${hostGrotesk.variable} ${pretendard.variable} ${geistMono.variable} font-sans flex min-h-screen justify-center`.

- [ ] **Step 4: Tokens and base styles.** Add to the token file:

```json
"font": { "family": {
  "sans": { "$value": "var(--font-host-grotesk), var(--font-pretendard), system-ui, \"Malgun Gothic\", sans-serif", "$extensions": { "moneyview.theme": "--font-sans" } },
  "mono": { "$value": "var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace", "$extensions": { "moneyview.theme": "--font-mono" } }
} }
```

In `globals.css`, change the body's `font-family: var(--font-inter), sans-serif;` to `font-family: var(--font-family-sans);`. Replace the `.tabular-nums` rule with `table, .tabular-nums { font-variant-numeric: tabular-nums; }`. `.overflow-mono-block` already names `var(--font-geist-mono)`, which was never defined until now. It now renders in Geist Mono, which is intended. Run `npm run tokens`.

- [ ] **Step 5: Run** `npx playwright test tests/e2e/font.spec.ts`, then the full suite. `next/font/local` derives family names from the constant names. If `loaded` reports names that do not contain `hostgrotesk`, `pretendard` and `geistmono`, put the reported substrings into the test's loop and note them in Track D. Capture `DESIGN_CAPTURE=after-font`, run `node scripts/capture-review.mjs after-rename after-font`, and review the page. Expect glyph-shape changes only. Note any truncation or wrap in Track D, and fix it in this task if it hides content.

- [ ] **Step 6: Mutation matrix**

| Mutation | Must fail |
|---|---|
| drop `${hostGrotesk.variable}` from the body class | `a font variable is empty` |
| put `var(--font-pretendard)` first in `font.family.sans` | `latinSans ≈ latinHost` |
| set `font.family.mono` to `var(--font-pretendard), monospace` | `ones ≈ eights` (Pretendard figures are proportional by default) |
| remove `var(--font-pretendard)` from `font.family.sans` | `hangulSans ≈ hangulPre` |

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/fonts apps/web/app/layout.tsx apps/web/app/globals.css apps/web/tokens apps/web/app/tokens.generated.css apps/web/lib/tokens.generated.ts apps/web/tests/e2e/font.spec.ts docs/design/MoneyView_Design_Tokens.md
git commit -m "feat(design): Host Grotesk, Pretendard and Geist Mono (all OFL), replacing Inter"
```

---

### Task 5: The switch: paper token set

One commit changes every token-driven value to the redesign's paper theme. Old names become deprecated aliases that point at their paper replacement, so all ~2,400 existing references keep rendering, now in paper values. Screens still carry their raw Tailwind colours and sizes until Tasks 9–13.

**Files:**
- Replace: `tokens/moneyview.tokens.json` (full content below); then `npm run tokens`
- Modify: `scripts/build-tokens.mjs` (utilities, deprecation markers, literal breakpoints, `PATHS.redesign`), `scripts/build-tokens.test.mjs`
- Modify: `eslint-rules/no-raw-design-values.mjs`, `eslint-rules/no-raw-design-values.test.mjs`, `eslint-rules/__fixtures__/tokens.css` (`deprecatedVar`)
- Modify: `app/globals.css` (base rules), `components/ui/AppShell.tsx`, `app/portfolio/page.tsx` (breakpoint)
- Create: `tests/e2e/paper-identity.spec.ts`
- Modify (pre-approved, see Owner decisions): `tests/e2e/candle-colour.spec.ts`, `tests/e2e/sidebar-contrast.spec.ts`

**Interfaces:**
- Consumes: the redesign `docs/design/redesign-2026-10/ds/moneyview/tokens.json`
- Produces:
  - paper tokens, by CSS name:
    - grounds and surfaces: `--bg`, `--surface`, `--surface-raised`, `--surface-sunken`, `--grid`, `--line`, `--line-strong`
    - text: `--ink`, `--ink-secondary`, `--ink-muted`, `--ink-disabled`
    - brand: `--brand`, `--brand-text`, `--brand-soft`, `--on-brand`, `--focus-ring`, `--link`
    - direction: `--up`, `--up-soft`, `--down`, `--down-soft`, `--flat`
    - charts: `--chart-1…5`, `--chart-area-opacity`, `--chart-heat-1…7`
    - status and overlay: `--status-{error,warning,success}-{ink,surface,border}`, `--overlay-scrim`
    - spacing and radius: `--space-{1,2,3,4,5,6,8,16,32}`, `--radius-{0,1,2,pill}`
    - layout: `--hairline`, `--bp-{desktop,tablet,mobile}`, `--content-max`, `--gutter`
    - component sizes: `--component-button-height-{sm,md}`, `--component-input-height`, `--component-tick-size`, `--component-delta-glyph`
    - type: `--type-<style>{,-line-height,-weight,-tracking,-family}` for 17 styles
  - type utilities `type-heading-5`, `type-panel-title`, `type-body`, `type-label`, `type-small`, `type-figure`, `type-figure-md`, `type-mono-link`, `type-mono`, `type-caption`
  - Tailwind `--breakpoint-sm/md/lg` = 480/768/992 px
  - messageId `deprecatedVar`; generator marks deprecated vars with `/* deprecated: … */`
  - token extension `"moneyview.utility": "<utility>"` on a type group

- [ ] **Step 1: Write the failing tests.** In `scripts/build-tokens.test.mjs`, delete the test `generated vars equal the pre-migration globals.css`. Its job, proving the pipeline without visual change, is done. Add:

```js
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const luminance = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const oklab = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const [l, m, s] = [
    0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b,
    0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b,
    0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b,
  ].map(Math.cbrt);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const source = () => JSON.parse(readFileSync(PATHS.source, "utf8"));
const design = () => JSON.parse(readFileSync(PATHS.redesign, "utf8"));

test("paper values equal the redesign's tokens.json", () => {
  const css = parseRootVars(renderCss(resolve(flatten(source())), []));
  const d = design();
  const colours = Object.fromEntries(d.color.tokens.map((t) => [t.name, t.value.paper]));
  const paper = (name) => { const ref = /^\{(.+)\}$/.exec(colours[name]); return ref ? paper(ref[1]) : colours[name]; };
  const expected = {};
  for (const name of Object.keys(colours)) expected[`--${name}`] = paper(name);
  for (const group of ["spacing", "radius", "breakpoint", "layout"]) for (const t of d[group].tokens) expected[`--${t.name}`] = t.value;
  for (const g of d.type.groups) for (const s of g.styles) {
    expected[`--type-${s.name}`] = s.fontSize;
    expected[`--type-${s.name}-line-height`] = s.lineHeight;
    expected[`--type-${s.name}-weight`] = String(s.fontWeight);
    expected[`--type-${s.name}-tracking`] = s.letterSpacing ?? "0";
    expected[`--type-${s.name}-family`] = css[`--font-family-${g.family}`];
  }
  for (const [name, value] of Object.entries(expected)) {
    assert.equal(String(css[name]).toLowerCase(), String(value).toLowerCase(), `${name}`);
  }
});

test("no value that exists only in the void theme is carried", () => {
  const tokens = design().color.tokens;
  const paperValues = new Set(tokens.map((t) => t.value.paper.toLowerCase()));
  const voidOnly = tokens.map((t) => t.value.void.toLowerCase()).filter((v) => v.startsWith("#") && !paperValues.has(v));
  const file = readFileSync(PATHS.source, "utf8").toLowerCase();
  assert.deepEqual(voidOnly.filter((v) => file.includes(v)), []);
});

test("every semantic colour is a reference into palette, never a literal", () => {
  const exempt = new Set(["palette", "overlay"]); // overlay.scrim is a palette colour with alpha
  const literal = [...flatten(source()).values()]
    .filter((t) => !exempt.has(t.path[0]) && typeof t.value === "string" && /^(#|rgba?\(|oklch\()/.test(t.value));
  assert.deepEqual(literal.map((t) => t.path.join(".")), []);
});

test("text reaches 4.5:1 and chart series 3:1 on every ground; series stay apart", () => {
  const r = resolve(flatten(source()));
  const v = (id) => r.get(id).value;
  const grounds = ["bg._", "surface._", "surface.raised"].map(v);
  for (const id of ["ink._", "ink.secondary", "ink.muted", "brand.text", "up._", "down._", "status.error.ink", "status.warning.ink", "status.success.ink"]) {
    for (const g of grounds) assert.ok(contrast(hex(v(id)), hex(g)) >= 4.5, `${id} on ${g}`);
  }
  for (const tone of ["error", "warning", "success"]) {
    assert.ok(contrast(hex(v(`status.${tone}.ink`)), hex(v(`status.${tone}.surface`))) >= 4.5, `status.${tone} ink on its surface`);
  }
  assert.ok(contrast(hex(v("on.brand")), hex(v("brand._"))) >= 4.5, "on-brand on brand");
  const series = [1, 2, 3, 4, 5].map((i) => v(`chart.${i}`));
  for (const s of series) for (const g of grounds) assert.ok(contrast(hex(s), hex(g)) >= 3, `${s} on ${g}`);
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const [a, b] = [oklab(hex(series[i])), oklab(hex(series[j]))];
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 0.08, `chart ${i + 1} and ${j + 1} are too close`);
  }
});

test("app type styles have a type-* utility, landing styles do not, every style is complete", () => {
  const flat = flatten(source());
  const styles = new Set([...flat.values()].filter((t) => t.path[0] === "type" && t.path.length === 3).map((t) => t.path[1]));
  const APP = ["heading-5", "panel-title", "body", "label", "small", "figure", "figure-md", "mono-link", "mono", "caption"];
  assert.equal(styles.size, 17);
  for (const s of styles) {
    for (const leaf of ["_", "line-height", "weight", "tracking", "family"]) assert.ok(flat.has(`type.${s}.${leaf}`), `type.${s}.${leaf} missing`);
    assert.equal(flat.get(`type.${s}._`).utility?.[0] ?? null, APP.includes(s) ? `type-${s}` : null, `type.${s} utility`);
  }
});

test("every pre-migration variable still resolves until Task 14 removes the aliases", () => {
  const baseline = JSON.parse(readFileSync(new URL("./__fixtures__/globals-root-vars.baseline.json", import.meta.url)));
  const generated = parseRootVars(renderCss(resolve(flatten(source())), []));
  const removed = new Set(["--space-7"]); // 0 references (counted 2026-10-13)
  assert.deepEqual(Object.keys(baseline).filter((n) => !removed.has(n) && !(n in generated)), []);
});

test("utility groups render one @utility with a declaration per leaf", () => {
  const t = {
    font: { $value: "serif" },
    type: { body: { $extensions: { "moneyview.utility": "type-body" }, _: { $value: "15px" }, "line-height": { $value: "24px" }, family: { $value: "{font}" } } },
  };
  assert.match(renderCss(resolve(flatten(t)), []),
    /@utility type-body \{\n {2}font-size: var\(--type-body\);\n {2}line-height: var\(--type-body-line-height\);\n {2}font-family: var\(--type-body-family\);\n\}/);
});

test("deprecated tokens carry the marker the lint rule reads", () => {
  const t = { ink: { $value: "#282828" }, text: { primary: { $value: "{ink}", $deprecated: "use --ink" } } };
  assert.match(renderCss(resolve(flatten(t)), []), /--text-primary: #282828; \/\* deprecated: use --ink \*\//);
});

test("breakpoint theme keys are emitted as literal values", () => {
  const t = { bp: { desktop: { $value: "992px", $extensions: { "moneyview.theme": "--breakpoint-lg" } } } };
  const css = renderCss(resolve(flatten(t)), []);
  assert.match(css, /@theme \{\n {2}--breakpoint-lg: 992px;\n\}/);
  assert.doesNotMatch(css, /--breakpoint-lg: var\(/);
});
```

In the lint test, add to the fixture `tokens.css` the line `  --old-alias: #ffffff; /* deprecated: use --bg-surface */`. Add the invalid case `{ code: 'const a = <div className="bg-[var(--old-alias)]" />;', errors: [{ messageId: "deprecatedVar" }] }`.

Run `npm run test:unit`. Expected FAIL: `PATHS.redesign` is undefined, the utility, marker and breakpoint tests fail, and the lint case reports nothing.

- [ ] **Step 2: Generator changes.** In `build-tokens.mjs`:

Add to `PATHS`:

```js
  redesign: path.resolve(ROOT, "../../docs/design/redesign-2026-10/ds/moneyview/tokens.json"),
```

Replace `flatten` and `renderCss` with:

```js
// A type group with "moneyview.utility" becomes one Tailwind utility; each leaf sets one property.
const UTILITY_PROPERTY = { _: "font-size", "line-height": "line-height", weight: "font-weight", tracking: "letter-spacing", family: "font-family" };

export function flatten(tree, prefix = [], utility = null) {
  const out = new Map();
  for (const [key, node] of Object.entries(tree)) {
    if (key.startsWith("$") || node === null || typeof node !== "object") continue;
    const p = [...prefix, key];
    if ("$value" in node) {
      out.set(p.join("."), {
        path: p, value: node.$value, deprecated: node.$deprecated ?? null,
        description: node.$description ?? "", theme: node.$extensions?.["moneyview.theme"] ?? null,
        utility: utility && UTILITY_PROPERTY[key] ? [utility, UTILITY_PROPERTY[key]] : null,
      });
    } else {
      for (const [id, token] of flatten(node, p, node.$extensions?.["moneyview.utility"] ?? null)) out.set(id, token);
    }
  }
  return out;
}

export function renderCss(resolved, resets) {
  const tokens = emitted(resolved);
  const line = (t) => `  ${cssName(t.path)}: ${t.value};${t.deprecated ? ` /* deprecated: ${t.deprecated} */` : ""}`;
  let css = `/* ${BANNER} */\n:root {\n${tokens.map(line).join("\n")}\n}\n`;
  if (resets.length) css += `\n@theme {\n${resets.map((r) => `  ${r}: initial;`).join("\n")}\n}\n`;
  // Media queries cannot read var(), so breakpoints go into @theme as literal values.
  const themed = tokens.filter((t) => t.theme);
  const literal = themed.filter((t) => t.theme.startsWith("--breakpoint-"));
  const inline = themed.filter((t) => !t.theme.startsWith("--breakpoint-"));
  if (literal.length) css += `\n@theme {\n${literal.map((t) => `  ${t.theme}: ${t.value};`).join("\n")}\n}\n`;
  if (inline.length) css += `\n@theme inline {\n${inline.map((t) => `  ${t.theme}: var(${cssName(t.path)});`).join("\n")}\n}\n`;
  const utilities = new Map();
  for (const t of tokens.filter((x) => x.utility)) {
    const [name, property] = t.utility;
    if (!utilities.has(name)) utilities.set(name, []);
    utilities.get(name).push(`  ${property}: var(${cssName(t.path)});`);
  }
  for (const [name, declarations] of utilities) css += `\n@utility ${name} {\n${declarations.join("\n")}\n}\n`;
  return css;
}
```

- [ ] **Step 3: Lint rule: `deprecatedVar`.** In `no-raw-design-values.mjs`, add to `meta.messages`:

```js
      deprecatedVar: "{{name}} is a deprecated alias; app/tokens.generated.css names its replacement.",
```

In the `VAR_REF` loop, after the `unknownVar` report, add:

```js
        else if (vars.deprecated.has(name)) context.report({ node, messageId: "deprecatedVar", data: { name } });
```

- [ ] **Step 4: Replace `tokens/moneyview.tokens.json`** with exactly this. It keeps `font` from Task 4, `duration`/`easing` from Task 2, and `brand`/`type.small` from Task 3, now with paper values.

```json
{
  "$description": "MoneyView design tokens (DTCG). Paper (light) theme of the 2026-10 redesign: docs/design/redesign-2026-10/ds/moneyview/tokens.json. The void (dark) theme is deliberately absent. palette holds primitives (referenced, never emitted). $deprecated tokens are pre-redesign names, removed in Task 14.",
  "palette": {
    "$type": "color",
    "paper": {
      "0": { "$value": "#ffffff" }, "25": { "$value": "#fafaf6" }, "50": { "$value": "#f5f5ed" }, "75": { "$value": "#f0f0f0" },
      "100": { "$value": "#e6e6e0" }, "300": { "$value": "#b4b4b0" }, "350": { "$value": "#b3b3af" }, "600": { "$value": "#72726f" },
      "700": { "$value": "#626260" }, "800": { "$value": "#414140" }, "900": { "$value": "#282828" }, "950": { "$value": "#101010" }
    },
    "orange": { "100": { "$value": "#ffe6dc" }, "500": { "$value": "#fa3600" }, "700": { "$value": "#c42b00" } },
    "red": {
      "50": { "$value": "#fdeef0" },
      "300": { "$value": "#e88796", "$description": "Not in the redesign: sRGB midpoint of up and up-soft (heat step 6)." },
      "600": { "$value": "#d21f3c" }
    },
    "blue": {
      "50": { "$value": "#e3ecfd" },
      "300": { "$value": "#81a4eb", "$description": "Not in the redesign: sRGB midpoint of down and down-soft (heat step 2)." },
      "600": { "$value": "#1e5bd8" }
    },
    "teal": {
      "50": { "$value": "#e2f3f0", "$description": "Not in the redesign: success surface." },
      "600": { "$value": "#0e8c7c" },
      "700": { "$value": "#0b6e62", "$description": "Not in the redesign: chart-2 darkened to >= 4.5:1 for success text." }
    },
    "sand": { "600": { "$value": "#8a7650" } },
    "amber": {
      "50": { "$value": "#fbf5d9", "$description": "Not in the redesign: warning surface." },
      "600": { "$value": "#9a8600" },
      "700": { "$value": "#7a6a00", "$description": "Not in the redesign: chart-5 darkened to >= 4.5:1 for warning text." }
    }
  },
  "bg": {
    "_": { "$value": "{palette.paper.0}", "$description": "Page ground." },
    "canvas": { "$value": "{bg._}", "$deprecated": "use --bg" },
    "primary": { "$value": "{bg._}", "$deprecated": "use --bg" },
    "surface": { "$value": "{surface.raised}", "$deprecated": "use --surface-raised" },
    "elevated": { "$value": "{surface.raised}", "$deprecated": "use --surface-raised" },
    "subtle": { "$value": "{surface._}", "$deprecated": "use --surface" },
    "sidebar": { "$value": "{surface._}", "$deprecated": "use --surface" },
    "secondary": { "$value": "{surface._}", "$deprecated": "use --surface" }
  },
  "surface": {
    "_": { "$value": "{palette.paper.50}", "$description": "Section bands, alternating and hovered rows." },
    "raised": { "$value": "{palette.paper.75}", "$description": "Panels, cards, menus, chart plots." },
    "sunken": { "$value": "{palette.paper.25}", "$description": "Inputs and code wells." },
    "panel": { "$value": "{surface.raised}", "$deprecated": "use --surface-raised" },
    "muted": { "$value": "{surface._}", "$deprecated": "use --surface" }
  },
  "grid": { "$value": "{palette.paper.100}", "$description": "Chart gridlines and table row rules; never a control border." },
  "line": {
    "_": { "$value": "{palette.paper.350}", "$description": "The 1px hairline: panel frames, dividers (decorative, 2.1:1)." },
    "strong": { "$value": "{palette.paper.600}", "$description": "Control edges: inputs, outline buttons, segmented controls." }
  },
  "ink": {
    "_": { "$value": "{palette.paper.900}", "$description": "Primary text and figures." },
    "secondary": { "$value": "{palette.paper.800}", "$description": "Body copy, table text." },
    "muted": { "$value": "{palette.paper.700}", "$description": "Captions, axis labels, metadata, the flat state." },
    "disabled": { "$value": "{palette.paper.300}", "$description": "Disabled labels only." }
  },
  "text": {
    "primary": { "$value": "{ink._}", "$deprecated": "use --ink" },
    "secondary": { "$value": "{ink.secondary}", "$deprecated": "use --ink-secondary" },
    "muted": { "$value": "{ink.muted}", "$deprecated": "use --ink-muted" },
    "disabled": { "$value": "{ink.disabled}", "$deprecated": "use --ink-disabled" },
    "inverse": { "$value": "{bg._}", "$deprecated": "use --bg on an ink fill, --on-brand on a brand fill" }
  },
  "border": {
    "_": { "$value": "{line._}", "$deprecated": "use --line" },
    "default": { "$value": "{line._}", "$deprecated": "use --line" },
    "soft": { "$value": "{grid}", "$deprecated": "use --grid" },
    "strong": { "$value": "{line.strong}", "$deprecated": "use --line-strong" },
    "accent": { "$value": "{brand._}", "$deprecated": "use --brand" }
  },
  "brand": {
    "_": { "$value": "{palette.orange.500}", "$description": "Signal orange. Fills only: primary button, selection, focus ring, the subject chart series, the active nav marker. Never on price changes." },
    "text": { "$value": "{palette.orange.700}", "$description": "Brand as text: links, eyebrow index." },
    "soft": { "$value": "{palette.orange.100}", "$description": "Tinted ground behind brand-text: selected rows, active chips." }
  },
  "accent": { "$value": "{brand.soft}", "$deprecated": "use --brand-soft (ground) or --brand-text (text, icon)" },
  "on": { "brand": { "$value": "{palette.paper.950}", "$description": "Text and icons on a brand fill (white on brand is only 3.8:1)." } },
  "focus": { "ring": { "$value": "{brand._}", "$description": "2px solid, 2px offset (globals.css :focus-visible)." } },
  "link": { "$value": "{brand.text}" },
  "up": {
    "_": { "$value": "{palette.red.600}", "$description": "상승. Always with ▲ and +." },
    "soft": { "$value": "{palette.red.50}" }
  },
  "down": {
    "_": { "$value": "{palette.blue.600}", "$description": "하락. Always with ▼ and -." },
    "soft": { "$value": "{palette.blue.50}" }
  },
  "flat": { "$value": "{ink.muted}", "$description": "보합: 0.0% and missing data." },
  "delta": {
    "up": { "$value": "{up._}", "$deprecated": "use --up" },
    "down": { "$value": "{down._}", "$deprecated": "use --down" }
  },
  "state": {
    "positive": { "$value": "{up._}", "$deprecated": "use --up" },
    "negative": { "$value": "{down._}", "$deprecated": "use --down" },
    "warning": { "$value": "{status.warning.ink}", "$deprecated": "use --status-warning-ink" },
    "success": { "$value": "{status.success.ink}", "$deprecated": "use --status-success-ink" },
    "error": { "$value": "{status.error.ink}", "$deprecated": "use --status-error-ink" },
    "info": { "$value": "{brand._}", "$deprecated": "use --brand (fill) or --brand-text (text)" }
  },
  "status": {
    "$description": "Not in the redesign. Error follows bundle.css (input errors use the up tone); warning and success derive from chart-5 and chart-2, darkened to >= 4.5:1.",
    "error": { "ink": { "$value": "{up._}" }, "surface": { "$value": "{up.soft}" }, "border": { "$value": "{up._}" } },
    "warning": { "ink": { "$value": "{palette.amber.700}" }, "surface": { "$value": "{palette.amber.50}" }, "border": { "$value": "{palette.amber.600}" } },
    "success": { "ink": { "$value": "{palette.teal.700}" }, "surface": { "$value": "{palette.teal.50}" }, "border": { "$value": "{palette.teal.600}" } }
  },
  "overlay": { "scrim": { "$value": "rgb(16 16 16 / 0.45)", "$description": "Not in the redesign: modal backdrop, on-brand black at 45%." } },
  "chart": {
    "1": { "$value": "{brand._}", "$description": "The subject series (the one asset the chart is about)." },
    "2": { "$value": "{palette.teal.600}", "$description": "Benchmark or comparison line." },
    "3": { "$value": "{palette.sand.600}", "$description": "Secondary comparison, area fills." },
    "4": { "$value": "{palette.paper.700}", "$description": "Everything else: the market average, the folded 'Other'." },
    "5": { "$value": "{palette.amber.600}", "$description": "A fifth series only when unavoidable." },
    "area-opacity": { "$value": "0.12", "$description": "Fill opacity under a line and for percentile bands (Main.dc.html)." },
    "heat-1": { "$value": "{palette.blue.600}" },
    "heat-2": { "$value": "{palette.blue.300}" },
    "heat-3": { "$value": "{palette.blue.50}" },
    "heat-4": { "$value": "{palette.paper.50}" },
    "heat-5": { "$value": "{palette.red.50}" },
    "heat-6": { "$value": "{palette.red.300}" },
    "heat-7": { "$value": "{palette.red.600}" },
    "primary": { "$value": "{chart.1}", "$deprecated": "use --chart-1" },
    "secondary": { "$value": "{chart.2}", "$deprecated": "use --chart-2" },
    "tertiary": { "$value": "{chart.3}", "$deprecated": "use --chart-3" },
    "muted": { "$value": "{chart.4}", "$deprecated": "use --chart-4" },
    "label": { "$value": "{ink.muted}", "$deprecated": "use --ink-muted" },
    "ink": { "$value": "{ink._}", "$deprecated": "use --ink" },
    "grid": { "$value": "{grid}", "$deprecated": "use --grid" },
    "positive": { "$value": "{up._}", "$deprecated": "use --up" },
    "negative": { "$value": "{down._}", "$deprecated": "use --down" }
  },
  "space": {
    "$type": "dimension",
    "1": { "$value": "4px" }, "2": { "$value": "8px" }, "3": { "$value": "12px" }, "4": { "$value": "16px" },
    "5": { "$value": "20px" }, "6": { "$value": "24px" }, "8": { "$value": "32px" }, "16": { "$value": "64px" }, "32": { "$value": "128px" }
  },
  "radius": {
    "0": { "$value": "0px", "$description": "Panels, tables, charts, modals: the default (no rounded class)." },
    "1": { "$value": "2px", "$description": "Buttons, inputs, segmented controls." },
    "2": { "$value": "4px", "$description": "Tooltips, menus, delta chips." },
    "pill": { "$value": "999px", "$description": "Status dots." },
    "_": { "$value": "{radius.0}", "$deprecated": "use no rounded class (square), or --radius-1/2 by role" },
    "sm": { "$value": "{radius.2}", "$deprecated": "use --radius-2" },
    "md": { "$value": "{radius.0}", "$deprecated": "use no rounded class (square), or --radius-1/2 by role" },
    "lg": { "$value": "{radius.0}", "$deprecated": "use no rounded class (square)" }
  },
  "shadow": {
    "card-hover": { "$value": "none", "$deprecated": "no shadows: use border border-[var(--line)]" },
    "modal": { "$value": "none", "$deprecated": "no shadows: use border border-[var(--line)]" },
    "popover": { "$value": "none", "$deprecated": "no shadows: use border border-[var(--line)]" },
    "sidebar": { "$value": "none", "$deprecated": "no shadows: use border border-[var(--line)]" }
  },
  "hairline": { "$value": "1px", "$description": "Every border and rule; no 2px borders except the focus ring." },
  "duration": { "fast": { "$value": "100ms" }, "normal": { "$value": "200ms" }, "slow": { "$value": "350ms" } },
  "easing": {
    "default": { "$value": "cubic-bezier(0.4, 0, 0.2, 1)" },
    "enter": { "$value": "cubic-bezier(0, 0, 0.2, 1)" },
    "exit": { "$value": "cubic-bezier(0.4, 0, 1, 1)" }
  },
  "bp": {
    "desktop": { "$value": "992px", "$extensions": { "moneyview.theme": "--breakpoint-lg" } },
    "tablet": { "$value": "768px", "$extensions": { "moneyview.theme": "--breakpoint-md" } },
    "mobile": { "$value": "480px", "$extensions": { "moneyview.theme": "--breakpoint-sm" } }
  },
  "content": { "max": { "$value": "1280px" } },
  "gutter": { "$value": "24px", "$description": "Grid gutter (16px under 768px)." },
  "component": {
    "$description": "Component sizes from the redesign's bundle.css.",
    "button": { "height-sm": { "$value": "32px" }, "height-md": { "$value": "44px" } },
    "input": { "height": { "$value": "44px" } },
    "tick": { "size": { "$value": "8px", "$description": "Panel corner ticks." } },
    "delta": { "glyph": { "$value": "9px", "$description": "▲▼■ inside a delta." } }
  },
  "font": { "family": {
    "sans": { "$value": "var(--font-host-grotesk), var(--font-pretendard), system-ui, \"Malgun Gothic\", sans-serif", "$extensions": { "moneyview.theme": "--font-sans" } },
    "mono": { "$value": "var(--font-geist-mono), var(--font-pretendard), ui-monospace, monospace", "$extensions": { "moneyview.theme": "--font-mono" } }
  } },
  "type": {
    "display": { "_": { "$value": "62px" }, "line-height": { "$value": "64px" }, "weight": { "$value": "600" }, "tracking": { "$value": "-0.03em" }, "family": { "$value": "{font.family.sans}" } },
    "heading-1": { "_": { "$value": "53px" }, "line-height": { "$value": "58px" }, "weight": { "$value": "600" }, "tracking": { "$value": "-0.025em" }, "family": { "$value": "{font.family.sans}" } },
    "heading-2": { "_": { "$value": "44px" }, "line-height": { "$value": "50px" }, "weight": { "$value": "600" }, "tracking": { "$value": "-0.02em" }, "family": { "$value": "{font.family.sans}" } },
    "heading-3": { "_": { "$value": "36px" }, "line-height": { "$value": "42px" }, "weight": { "$value": "500" }, "tracking": { "$value": "-0.015em" }, "family": { "$value": "{font.family.sans}" } },
    "heading-4": { "_": { "$value": "31px" }, "line-height": { "$value": "38px" }, "weight": { "$value": "500" }, "tracking": { "$value": "-0.01em" }, "family": { "$value": "{font.family.sans}" } },
    "heading-5": { "$extensions": { "moneyview.utility": "type-heading-5" }, "_": { "$value": "27px" }, "line-height": { "$value": "34px" }, "weight": { "$value": "500" }, "tracking": { "$value": "-0.01em" }, "family": { "$value": "{font.family.sans}" } },
    "panel-title": { "$description": "bundle.css .mv-panel-title.", "$extensions": { "moneyview.utility": "type-panel-title" }, "_": { "$value": "18px" }, "line-height": { "$value": "24px" }, "weight": { "$value": "600" }, "tracking": { "$value": "-0.01em" }, "family": { "$value": "{font.family.sans}" } },
    "body-lg": { "_": { "$value": "18px" }, "line-height": { "$value": "30px" }, "weight": { "$value": "400" }, "tracking": { "$value": "-0.005em" }, "family": { "$value": "{font.family.sans}" } },
    "body": { "$extensions": { "moneyview.utility": "type-body" }, "_": { "$value": "15px" }, "line-height": { "$value": "24px" }, "weight": { "$value": "400" }, "tracking": { "$value": "0" }, "family": { "$value": "{font.family.sans}" } },
    "label": { "$extensions": { "moneyview.utility": "type-label" }, "_": { "$value": "15px" }, "line-height": { "$value": "20px" }, "weight": { "$value": "600" }, "tracking": { "$value": "0" }, "family": { "$value": "{font.family.sans}" } },
    "small": { "$description": "bundle.css .mv-field-help: help text, dense secondary copy.", "$extensions": { "moneyview.utility": "type-small" }, "_": { "$value": "13px" }, "line-height": { "$value": "18px" }, "weight": { "$value": "400" }, "tracking": { "$value": "0" }, "family": { "$value": "{font.family.sans}" } },
    "figure": { "$extensions": { "moneyview.utility": "type-figure" }, "_": { "$value": "44px" }, "line-height": { "$value": "44px" }, "weight": { "$value": "500" }, "tracking": { "$value": "-0.03em" }, "family": { "$value": "{font.family.mono}" } },
    "figure-md": { "$description": "Main.dc.html panel figure (KOSPI last): figures of 20px and up outside stat cards.", "$extensions": { "moneyview.utility": "type-figure-md" }, "_": { "$value": "32px" }, "line-height": { "$value": "32px" }, "weight": { "$value": "500" }, "tracking": { "$value": "-0.03em" }, "family": { "$value": "{font.family.mono}" } },
    "mono-link": { "$extensions": { "moneyview.utility": "type-mono-link" }, "_": { "$value": "16px" }, "line-height": { "$value": "20px" }, "weight": { "$value": "500" }, "tracking": { "$value": "0.02em" }, "family": { "$value": "{font.family.mono}" } },
    "mono": { "$extensions": { "moneyview.utility": "type-mono" }, "_": { "$value": "13px" }, "line-height": { "$value": "18px" }, "weight": { "$value": "500" }, "tracking": { "$value": "0" }, "family": { "$value": "{font.family.mono}" } },
    "caption": { "$extensions": { "moneyview.utility": "type-caption" }, "_": { "$value": "11px" }, "line-height": { "$value": "14px" }, "weight": { "$value": "500" }, "tracking": { "$value": "0.08em" }, "family": { "$value": "{font.family.mono}" } },
    "caption-ko": { "$description": "tokens.json caption usage: Korean captions at 12px. Applied by globals.css to Hangul inside .type-caption.", "_": { "$value": "12px" }, "line-height": { "$value": "16px" }, "weight": { "$value": "500" }, "tracking": { "$value": "0" }, "family": { "$value": "{font.family.mono}" } },
    "page-title": { "$value": "{type.heading-5._}", "$deprecated": "use type-heading-5" },
    "metric-lg": { "$value": "{type.figure-md._}", "$deprecated": "use type-figure-md" },
    "section-title": { "$value": "{type.panel-title._}", "$deprecated": "use type-panel-title" },
    "card-title": { "$value": "{type.panel-title._}", "$deprecated": "use type-panel-title" },
    "metric-md": { "$value": "{type.panel-title._}", "$deprecated": "use type-panel-title (figures: type-figure-md)" },
    "table-header": { "$value": "{type.caption._}", "$deprecated": "use type-caption" },
    "table-body": { "$value": "{type.small._}", "$deprecated": "use type-small (figures: type-mono)" },
    "helper": { "$value": "{type.small._}", "$deprecated": "use type-small" }
  }
}
```

Run `npm run tokens`.

- [ ] **Step 5: Base styles and breakpoints.** In `app/globals.css`, replace the `body` rule and the `table, .tabular-nums` rule inside `@layer base` with:

```css
  body {
    background-color: var(--bg);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    font-family: var(--font-family-sans);
    /* Hangul breaks between words, not syllables (the redesign's page root). */
    word-break: keep-all;
  }

  /* One focus ring for every control (redesign: 2px brand, 2px offset). */
  :focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  table, .tabular-nums {
    font-variant-numeric: tabular-nums;
  }
```

Add at the start of `@layer utilities`:

```css
  /* Hangul captions run at 12px, Latin at 11px, whatever the page language (tokens.json:
     "Korean captions at 12px"). In the utilities layer because a base-layer rule would lose
     to the type-caption utility regardless of specificity. */
  .type-caption:lang(ko), .type-caption :lang(ko) {
    font-size: var(--type-caption-ko);
    line-height: var(--type-caption-ko-line-height);
    letter-spacing: var(--type-caption-ko-tracking);
  }
  .type-caption :lang(en) {
    font-size: var(--type-caption);
    line-height: var(--type-caption-line-height);
    letter-spacing: var(--type-caption-tracking);
  }
```

In `components/ui/AppShell.tsx`, add `import { tokens } from "@/lib/tokens.generated";`. Above the component, add `const DESKTOP_MIN = Number.parseFloat(tokens.bp.desktop); // Tailwind lg`, and change `window.innerWidth >= 1024` to `window.innerWidth >= DESKTOP_MIN`. In `app/portfolio/page.tsx:1019`, make the same import and constant, and change `window.innerWidth < 1024` to `window.innerWidth < DESKTOP_MIN`.

- [ ] **Step 6: Identity test** (`tests/e2e/paper-identity.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

test("ground, ink and Hangul line breaking are the paper base", async ({ page }) => {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app-sidebar")).toBeVisible({ timeout: 60_000 });
  const body = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return { bg: s.backgroundColor, color: s.color, wordBreak: s.wordBreak };
  });
  expect(body).toEqual({ bg: rgb("#ffffff"), color: rgb("#282828"), wordBreak: "keep-all" });
});

test("keyboard focus draws the 2px brand ring", async ({ page }) => {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const probe = document.createElement("button");
    probe.id = "focus-probe";
    probe.textContent = "probe";
    document.body.prepend(probe);
  });
  await page.keyboard.press("Tab");
  const ring = await page.locator("#focus-probe").evaluate((el) => {
    const s = getComputedStyle(el);
    return { focused: document.activeElement === el, style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  expect(ring).toEqual({ focused: true, style: "solid", width: "2px", color: rgb("#fa3600") });
});

test.describe("at 1000px wide", () => {
  test.use({ viewport: { width: 1000, height: 800 } });
  test("the desktop layout applies (lg = 992px)", async ({ page }) => {
    await mockValuationApi(page);
    await page.goto("/valuation", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#app-sidebar")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Open navigation sidebar" })).toBeHidden();
  });
});
```

- [ ] **Step 7: Pre-approved test updates.** Make the two changes listed under Owner decisions, and only those:
- `candle-colour.spec.ts`: `DELTA_UP = { r: 0xd2, g: 0x1f, b: 0x3c }`, `DELTA_DOWN = { r: 0x1e, g: 0x5b, b: 0xd8 }`, the literal triples inside the `evaluate` loop to match, and the doc comment's "globals.css" line to "tokens: --up / --down".
- `sidebar-contrast.spec.ts`: `const INK = "rgb(40, 40, 40)";` in place of `BLACK`, with its uses and the doc comment ("bold ink").

Run the full suite. If any other spec fails on a rendered value, **stop and list it for the owner**.

- [ ] **Step 8: Run and review**

```bash
npm run tokens && npm run test:unit && npm run typecheck && npm run lint && npx playwright test
npm run design:baseline
DESIGN_CAPTURE=after-paper npx playwright test tests/e2e/design-capture.spec.ts
node scripts/capture-review.mjs after-font after-paper
```

Record the `deprecatedVar` count in Track D (expected ≈ 2,400). The owner reviews `design-capture/review-after-font-vs-after-paper.html` against this checklist:
- Ground white; panels and cards `#F0F0F0` with a `#B3B3AF` hairline; square corners; no shadows.
- Text near-black `#282828`; secondary `#414140`; muted `#626260`.
- Gains red `#D21F3C`, losses blue `#1E5BD8`, with sign/arrow still present.
- Every former mint fill (primary buttons, active sidebar item, selected toggles) is orange `#FA3600`. Text on it may still be white (3.8:1) until Task 8/M1 makes it `--on-brand`. **Expected, not a defect.**
- Screens' own Tailwind colours (`bg-amber-50` …) are unchanged until Tasks 9–13. **Expected.**
- **Defects to report:** invisible text or borders (an alias resolving to nothing), black chart fills, any layout collapse.

- [ ] **Step 9: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `brand._` → `{palette.orange.700}` | `paper values equal the redesign's tokens.json` (`--brand`) |
| `surface.raised` → a literal `"#1f1f1d"` (void) | `no value that exists only in the void theme is carried` and the tier test |
| `status.warning.ink` → `{palette.amber.600}` | `text reaches 4.5:1 …` (3.63:1 on white) |
| remove `moneyview.utility` from `type.body` | `app type styles have a type-* utility …` |
| delete `text.primary` | `every pre-migration variable still resolves …` |
| `renderCss` puts breakpoints into `@theme inline` | `breakpoint theme keys are emitted as literal values` and `the desktop layout applies (lg = 992px)` |
| delete `word-break: keep-all` | `ground, ink and Hangul line breaking …` |
| delete the `:focus-visible` rule | `keyboard focus draws the 2px brand ring` |
| drop the `else if (vars.deprecated…)` line | RuleTester `deprecatedVar` case |

- [ ] **Step 10: Commit**

```bash
git add apps/web/tokens apps/web/app/tokens.generated.css apps/web/lib/tokens.generated.ts apps/web/scripts apps/web/eslint-rules apps/web/app/globals.css apps/web/components/ui/AppShell.tsx apps/web/app/portfolio/page.tsx apps/web/tests/e2e/paper-identity.spec.ts apps/web/tests/e2e/candle-colour.spec.ts apps/web/tests/e2e/sidebar-contrast.spec.ts docs/design/MoneyView_Design_Tokens.md
git commit -m "feat(design): switch to the paper redesign tokens; old names become deprecated aliases

Visible change: every token-driven colour, radius, shadow and type size. Before/after:
design-capture/review-after-font-vs-after-paper.html. Owner-approved test updates:
candle-colour (up/down hex), sidebar-contrast (black -> ink)."
```

---

### Task 6: One number formatter

**Files:**
- Create: `lib/format.ts`, `tests/e2e/format-model.spec.ts`

**Interfaces:**
- Produces:
  - `formatNumber(value: number|null|undefined, kind: NumberKind, opts?: {digits?, signed?, locale?}) -> string`
  - `NumberKind = "price"|"percent"|"ratio"|"multiple"|"integer"|"compact"`, `FormatLocale = "en"|"ko"`, `MISSING = "—"`

- [ ] **Step 1: Write the failing test.** The expected strings were checked against Node 24's `Intl`.

```ts
import { expect, test } from "@playwright/test";
import { MISSING, formatNumber } from "../../lib/format";

test("each kind has its default digits and suffix", () => {
  expect(formatNumber(1234.5, "price")).toBe("1,234.50");
  expect(formatNumber(0.1234, "percent")).toBe("12.3%");
  expect(formatNumber(0.8512, "ratio")).toBe("0.85");
  expect(formatNumber(12.34, "multiple")).toBe("12.3x");
  expect(formatNumber(1234.5, "integer")).toBe("1,235");
  expect(formatNumber(1_234_000_000, "compact")).toBe("1.2B");
});

test("korean compact uses 억/조 units", () => {
  expect(formatNumber(1_234_000_000, "compact", { locale: "ko" })).toBe("12.3억");
});

test("sign rules: ASCII hyphen-minus, + only when asked", () => {
  expect(formatNumber(0.123, "percent", { signed: true })).toBe("+12.3%");
  expect(formatNumber(-1234.5, "price")).toBe("-1,234.50");
});

test("rounded negative zero has no sign", () => {
  expect(formatNumber(-0.0004, "percent")).toBe("0.0%");
  expect(formatNumber(-0.0004, "percent", { signed: true })).toBe("0.0%");
});

test("missing and non-finite values render the missing glyph", () => {
  for (const v of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) expect(formatNumber(v, "price")).toBe(MISSING);
});
```

Run `npx playwright test tests/e2e/format-model.spec.ts`. Expected FAIL: cannot resolve `../../lib/format`.

- [ ] **Step 2: Implement `lib/format.ts`**

```ts
/**
 * The one number formatter. Figures align because every figure goes through here and is set
 * in Geist Mono (type-mono / type-figure*), whose digits are fixed-width.
 *
 * signDisplay "negative", not "auto": "auto" prints -0.04 at one digit as "-0.0".
 * The minus is ASCII "-", not the redesign's U+2212: pasted figures must stay numbers in a
 * spreadsheet (plan R13). Percent inputs are fractions: 0.123 -> "12.3%".
 */
export type NumberKind = "price" | "percent" | "ratio" | "multiple" | "integer" | "compact";
export type FormatLocale = "en" | "ko";
export const MISSING = "—";

const DIGITS: Record<NumberKind, number> = { price: 2, percent: 1, ratio: 2, multiple: 1, integer: 0, compact: 1 };
const INTL: Record<FormatLocale, string> = { en: "en-US", ko: "ko-KR" };

export function formatNumber(
  value: number | null | undefined,
  kind: NumberKind,
  { digits = DIGITS[kind], signed = false, locale = "en" }: { digits?: number; signed?: boolean; locale?: FormatLocale } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return MISSING;
  const body = new Intl.NumberFormat(INTL[locale], {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    notation: kind === "compact" ? "compact" : "standard",
    signDisplay: signed ? "exceptZero" : "negative",
  }).format(kind === "percent" ? value * 100 : value);
  return kind === "percent" ? `${body}%` : kind === "multiple" ? `${body}x` : body;
}
```

- [ ] **Step 3: Run** → PASS.

- [ ] **Step 4: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `"negative"` → `"auto"` | `rounded negative zero has no sign` |
| drop `* 100` for percent | `each kind …` (`0.1%`) |
| `INTL.ko = "en-US"` | `korean compact uses 억/조 units` |
| append `.replace("-", "\u2212")` to `body` | `sign rules …` |

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/format.ts apps/web/tests/e2e/format-model.spec.ts
git commit -m "feat(design): single locale-aware number formatter"
```

The existing `toFixed`, `toLocaleString` and local `format*` calls move to it screen by screen in Tasks 9–13 (M5).

---

### Task 7: Bilingual infrastructure, glossary, bilingual small labels, app shell

**Files:**
- Create: `lib/i18n/messages/en.ts`, `lib/i18n/messages/ko.ts`, `lib/i18n/translate.ts`, `lib/i18n/locale.ts`, `lib/i18n/labels.ts`
- Create: `components/ui/LanguageToggle.tsx`, `components/ui/HtmlLang.tsx`, `components/ui/BilingualLabel.tsx`, `components/ui/Eyebrow.tsx`, `app/dev/design/page.tsx`
- Create: `docs/design/MoneyView_Glossary.md`, `tests/e2e/i18n-model.spec.ts`, `tests/e2e/i18n.spec.ts`
- Modify: `components/ui/Sidebar.tsx`, `components/ui/AppShell.tsx`, `playwright.config.ts`

**Interfaces:**
- Produces:
  - `en` (source catalog, `as const`), `Messages`, `ko: Messages`, `MessageKey`, `translate(messages, key, params?)`
  - `Locale`, `detectLocale(stored, browser)`, `useLocale() -> {locale, setLocale}`, `useT()`; localStorage key `moneyview.locale`
  - `LABELS: Record<LabelKey, readonly [ko, en]>`, `LabelKey`
  - `<BilingualLabel k />`, `<Eyebrow label index? suffix? />`
  - route `/dev/design` with test ids `gallery-eyebrow`, `gallery-table`

**How the two language systems interact:**
- Body text and controls follow the locale (`t(key)`).
- Small labels (eyebrows, table headers) always show both languages, Korean first ("종목 NAME"), whatever the locale. They come from `LABELS`, not the catalogs, so the toggle cannot hide one half.
- Assistive tech hears only the active locale's half: the other half is `aria-hidden`. A screen reader says "종목" or "Name", never both.
- Both halves carry `lang`. Captions size by script through that attribute (Task 5's `:lang` rules).

- [ ] **Step 1: Glossary first** (`docs/design/MoneyView_Glossary.md`). This is the source the Korean translation is checked against. Each later screen task appends its own terms.

```markdown
# MoneyView Glossary (en ↔ ko)

Rule: a term in this table is translated exactly as written here, everywhere. Expanded
form on first use within a screen, short form after. UI sentences use 합니다체.
Buttons end in a verb ("저장", "실행", "다시 시도"). A verdict states its evidence figure
("ROIC 12.4%가 WACC 8.1%보다 높습니다").

Bilingual small labels (eyebrows, table headers) show the Korean term, then the English term in
capitals: "종목 NAME". Both come from `apps/web/lib/i18n/labels.ts`; add the row here first.

| English | 한국어 | Note |
|---|---|---|
| DCF | 현금흐름할인(DCF) → DCF | |
| WACC | 가중평균자본비용(WACC) → WACC | |
| ROIC | 투하자본이익률(ROIC) → ROIC | |
| VaR / ES | VaR / 기대손실(ES) | |
| Intrinsic value | 내재가치 | Always shown next to the market price |
| Terminal value | 잔존가치 | Never 영구가치 |
| Monte Carlo | 몬테카를로 시뮬레이션 | |
| Market Overview | 시장 개요 | nav |
| Portfolio | 포트폴리오 | nav |
| News Feed | 뉴스 | nav |
| Corporate Analysis | 기업 분석 | nav |
| Decision Log | 의사결정 기록 | nav |
| Valuation | 가치평가 | nav |
| Cases | 케이스 | nav |
| Events | 이벤트 | nav |
| Retry | 다시 시도 | |
| Loading… | 불러오는 중… | |
| Market | 시장 | label |
| Name | 종목 | label (table header for a security) |
| Price | 현재가 | label |
| Up / Down / Unchanged | 상승 / 하락 / 보합 | delta, screen-reader text |
```

- [ ] **Step 2: Write the failing model test** (`tests/e2e/i18n-model.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { LABELS } from "../../lib/i18n/labels";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { translate } from "../../lib/i18n/translate";
import { detectLocale } from "../../lib/i18n/locale";

test("lookup, interpolation and unknown-key fallback", () => {
  expect(translate(en, "nav.valuation")).toBe("Valuation");
  expect(translate(ko, "nav.valuation")).toBe("가치평가");
  expect(translate(en, "common.updatedAgo", { minutes: 5 })).toBe("Updated 5 min ago");
  expect(translate(en, "nav.nope" as never)).toBe("nav.nope");
});

test("stored choice wins, then a Korean browser, else English", () => {
  expect(detectLocale("en", "ko-KR")).toBe("en");
  expect(detectLocale(null, "ko-KR")).toBe("ko");
  expect(detectLocale("fr", "en-US")).toBe("en");
});

test("every ko leaf and every label half is non-empty; label Korean contains Hangul", () => {
  const leaves = (o: object): string[] => Object.values(o).flatMap((v) => (typeof v === "string" ? [v] : leaves(v)));
  expect(leaves(ko).filter((s) => !s.trim())).toEqual([]);
  for (const [key, [kr, eng]] of Object.entries(LABELS)) {
    expect(/[가-힣]/.test(kr), `${key} Korean half`).toBe(true);
    expect(/^[A-Za-z0-9 .&/-]+$/.test(eng), `${key} English half`).toBe(true);
  }
});
```

Run. Expected FAIL: cannot resolve the modules.

- [ ] **Step 3: Implement the catalogs, lookup, locale store and label table**

`lib/i18n/messages/en.ts`:

```ts
export const en = {
  nav: {
    market: "Market Overview", portfolio: "Portfolio", news: "News Feed", corporate: "Corporate Analysis",
    monteCarlo: "Monte Carlo", decisions: "Decision Log", valuation: "Valuation", cases: "Cases", events: "Events",
  },
  common: {
    loading: "Loading…", retry: "Retry", unavailable: "Could not be loaded.",
    updatedAgo: "Updated {minutes} min ago", language: "Language",
  },
} as const;

type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Messages = Widen<typeof en>;
```

`lib/i18n/messages/ko.ts`:

```ts
import type { Messages } from "./en";

// Terms follow docs/design/MoneyView_Glossary.md exactly.
export const ko: Messages = {
  nav: {
    market: "시장 개요", portfolio: "포트폴리오", news: "뉴스", corporate: "기업 분석",
    monteCarlo: "몬테카를로 시뮬레이션", decisions: "의사결정 기록", valuation: "가치평가", cases: "케이스", events: "이벤트",
  },
  common: {
    loading: "불러오는 중…", retry: "다시 시도", unavailable: "불러오지 못했습니다.",
    updatedAgo: "{minutes}분 전 갱신", language: "언어",
  },
};
```

`lib/i18n/translate.ts`:

```ts
import type { Messages } from "./messages/en";

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Messages>;

/** An unknown key returns itself, so a missing string is visible on screen, not blank. */
export function translate(messages: Messages, key: MessageKey, params?: Record<string, string | number>): string {
  const raw = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
  if (typeof raw !== "string") return key;
  return params ? raw.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : raw;
}
```

`lib/i18n/locale.ts`:

```ts
"use client";

import { useCallback, useSyncExternalStore } from "react";
import { en } from "./messages/en";
import { ko } from "./messages/ko";
import { translate, type MessageKey } from "./translate";

export type Locale = "en" | "ko";
const STORAGE_KEY = "moneyview.locale";
const CATALOGS = { en, ko };
const listeners = new Set<() => void>();

export function detectLocale(stored: string | null, browser: string | undefined): Locale {
  if (stored === "en" || stored === "ko") return stored;
  return browser?.toLowerCase().startsWith("ko") ? "ko" : "en";
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    listeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

// The server renders English; the client switches after hydration without a mismatch.
const getSnapshot = (): Locale => detectLocale(window.localStorage.getItem(STORAGE_KEY), window.navigator.language);
const getServerSnapshot = (): Locale => "en";

function setLocale(next: Locale) {
  window.localStorage.setItem(STORAGE_KEY, next);
  listeners.forEach((listener) => listener());
}

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return { locale, setLocale };
}

export function useT() {
  const { locale } = useLocale();
  return useCallback(
    (key: MessageKey, params?: Record<string, string | number>) => translate(CATALOGS[locale], key, params),
    [locale],
  );
}
```

`lib/i18n/labels.ts`:

```ts
/**
 * Always-bilingual small labels (eyebrows, table headers): Korean first, English second, both
 * shown in every locale (the redesign's "시장 MARKET"). Korean terms follow
 * docs/design/MoneyView_Glossary.md; English is stored in plain case and uppercased by CSS.
 */
export const LABELS = {
  market: ["시장", "Market"],
  name: ["종목", "Name"],
  price: ["현재가", "Price"],
} as const satisfies Record<string, readonly [string, string]>;

export type LabelKey = keyof typeof LABELS;
```

Run the model spec → PASS.

- [ ] **Step 4: Components**

`components/ui/BilingualLabel.tsx`:

```tsx
"use client";

import { LABELS, type LabelKey } from "@/lib/i18n/labels";
import { useLocale } from "@/lib/i18n/locale";

/**
 * "종목 NAME": both languages always visible. Assistive tech reads only the active locale's
 * half, so a screen reader does not announce every header twice. `lang` on each half lets
 * the caption rules in globals.css size Hangul and Latin separately.
 */
export function BilingualLabel({ k }: { k: LabelKey }) {
  const { locale } = useLocale();
  const [kr, eng] = LABELS[k];
  return (
    <span className="inline-flex items-baseline gap-1">
      <span lang="ko" aria-hidden={locale !== "ko" || undefined}>{kr}</span>
      <span lang="en" className="uppercase" aria-hidden={locale !== "en" || undefined}>{eng}</span>
    </span>
  );
}
```

`components/ui/Eyebrow.tsx`:

```tsx
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import type { LabelKey } from "@/lib/i18n/labels";

interface EyebrowProps {
  label: LabelKey;
  /** Section number, shown as [01] in brand text. */
  index?: number;
  /** A value after the label, such as a record id. */
  suffix?: string;
}

/** The small mono label above a title: "[01] 시장 MARKET" (redesign Eyebrow, without the slash). */
export function Eyebrow({ label, index, suffix }: EyebrowProps) {
  return (
    <div className="type-caption inline-flex items-baseline gap-2 uppercase text-[var(--ink-muted)]">
      {index !== undefined && <span className="text-[var(--brand-text)]">{`[${String(index).padStart(2, "0")}]`}</span>}
      <BilingualLabel k={label} />
      {suffix !== undefined && <span>{suffix}</span>}
    </div>
  );
}
```

`components/ui/HtmlLang.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/i18n/locale";

export function HtmlLang() {
  const { locale } = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
```

`components/ui/LanguageToggle.tsx`:

```tsx
"use client";

import clsx from "clsx";
import { useLocale, useT, type Locale } from "@/lib/i18n/locale";

// Language names are shown in their own language on purpose; they are not translated.
const OPTIONS: [Locale, string][] = [["en", "English"], ["ko", "한국어"]];

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <div role="group" aria-label={t("common.language")} className="inline-flex gap-0.5 rounded-[var(--radius-1)] border border-[var(--line-strong)] p-0.5">
      {OPTIONS.map(([value, label]) => (
        <button key={value} type="button" aria-pressed={locale === value} onClick={() => setLocale(value)}
          className={clsx("type-caption rounded-[var(--radius-1)] px-3 py-1",
            locale === value ? "bg-[var(--ink)] text-[var(--bg)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]")}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

`app/dev/design/page.tsx` (the gallery; Task 8 extends it):

```tsx
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { Eyebrow } from "@/components/ui/Eyebrow";

// Component gallery: the deterministic surface for component tests and visual review
// (design-system plan, Tasks 7-8). Sample values are constants.
const ROWS = [["삼성전자", "71,200"], ["SK하이닉스", "182,500"]] as const;

export default function DesignGalleryPage() {
  return (
    <div className="flex flex-col gap-8 p-6">
      <section data-testid="gallery-eyebrow"><Eyebrow index={1} label="market" /></section>
      <section>
        <table data-testid="gallery-table">
          <thead>
            <tr>
              <th scope="col" className="type-caption px-4 py-2 text-left uppercase text-[var(--ink-muted)]"><BilingualLabel k="name" /></th>
              <th scope="col" className="type-caption px-4 py-2 text-right uppercase text-[var(--ink-muted)]"><BilingualLabel k="price" /></th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, price]) => (
              <tr key={name}>
                <td className="type-body px-4 py-3">{name}</td>
                <td className="type-mono px-4 py-3 text-right">{price}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 5: Shell wiring.** In `Sidebar.tsx`:
- Change each `navItems` entry from `label: "..."` to `key: "nav.market" as const` (`nav.portfolio`, `nav.news`, `nav.corporate`, `nav.monteCarlo`, `nav.decisions`, `nav.valuation`, `nav.cases`, `nav.events`).
- Call `const t = useT();` and render `{t(item.key)}`.
- Render `<LanguageToggle />` at the bottom of the `<aside>`.

In `AppShell.tsx`, render `<HtmlLang />` once. In `playwright.config.ts`, add `locale: "en-US"` to the top-level `use`, so the English default the suite relies on is explicit.

- [ ] **Step 6: Page tests** (`tests/e2e/i18n.spec.ts`)

```ts
import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

test("switching to Korean relabels the nav, sets <html lang> and survives reload", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Valuation" })).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("link", { name: "가치평가" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.reload();
  await expect(page.getByRole("link", { name: "가치평가" })).toBeVisible();
});

test.describe("ko browser", () => {
  test.use({ locale: "ko-KR" });
  test("defaults to Korean without a stored choice", async ({ page }) => {
    await mockMarketPageApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "시장 개요" })).toBeVisible();
  });
});

test("bilingual headers show both languages and expose only the active one", async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
  const table = page.getByTestId("gallery-table");
  const header = table.locator("th").first();
  await expect(header.locator('[lang="ko"]')).toHaveText("종목");
  await expect(header.locator('[lang="en"]')).toHaveText("Name");
  await expect(header.locator('[lang="ko"]')).toBeVisible();
  await expect(header.locator('[lang="en"]')).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Name", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(table.getByRole("columnheader", { name: "종목", exact: true })).toBeVisible();
  await expect(header.locator('[lang="en"]')).toBeVisible();
});

test("caption text is 12px in Hangul and 11px in Latin, in either locale", async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
  const sizes = () => page.getByTestId("gallery-eyebrow").evaluate((el) => ({
    ko: getComputedStyle(el.querySelector('[lang="ko"]')!).fontSize,
    en: getComputedStyle(el.querySelector('[lang="en"]')!).fontSize,
  }));
  expect(await sizes()).toEqual({ ko: "12px", en: "11px" });
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  expect(await sizes()).toEqual({ ko: "12px", en: "11px" });
});
```

- [ ] **Step 7: Run** `npm run typecheck && npm run lint && npx playwright test`. Watch the browser console in the i18n spec for React hydration warnings; there must be none.

- [ ] **Step 8: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `setLocale` without `localStorage.setItem` | `… survives reload` |
| `detectLocale`: ignore `browser` | `defaults to Korean without a stored choice` |
| remove the `HtmlLang` effect | `toHaveAttribute("lang", "ko")` |
| `BilingualLabel`: drop both `aria-hidden` | `columnheader` name `"Name"` exact (name becomes "종목 Name") |
| `BilingualLabel`: `aria-hidden` on the Korean half always | `columnheader` name `"종목"` exact after switching |
| delete the `.type-caption :lang(en)` rule (globals.css) | `caption text is 12px … 11px …` (second assertion) |
| delete `.type-caption :lang(ko)` from the first selector | `caption text …` (first assertion) |
| `LABELS.name = ["Name", "Name"]` | `… label Korean contains Hangul` |

- [ ] **Step 9: Commit**

```bash
git add apps/web/lib/i18n apps/web/components/ui/LanguageToggle.tsx apps/web/components/ui/HtmlLang.tsx apps/web/components/ui/BilingualLabel.tsx apps/web/components/ui/Eyebrow.tsx apps/web/components/ui/Sidebar.tsx apps/web/components/ui/AppShell.tsx apps/web/app/dev/design apps/web/playwright.config.ts apps/web/tests/e2e/i18n-model.spec.ts apps/web/tests/e2e/i18n.spec.ts docs/design/MoneyView_Glossary.md
git commit -m "feat(i18n): en/ko catalogs, locale switch, glossary and always-bilingual small labels"
```

---

### Task 8: Component layer: shared components take the `mv-*` look

Each `mv-*` class becomes the existing React component, restyled with token utilities (R17):

| Redesign | App component | Notes |
|---|---|---|
| `mv-btn` (+ `-primary/-secondary/-ghost`, `-sm/-md/-lg`) | `ActionButton` | `danger` (no redesign counterpart) = outline in the error tone. No `lg` size: the app has no hero CTA. |
| `mv-panel`, `mv-tick-*` | `Card` | Corner ticks on every card |
| `mv-panel-title`, `mv-panel-sub` | `SectionHeader`, `PageHeader` | `PageHeader.eyebrow` becomes an `Eyebrow` |
| `mv-eyebrow` | `Eyebrow` (Task 7) | |
| `mv-stat` | `KPIBlock` | |
| `mv-delta` (+ `-chip`) | `DeltaBadge` | Always the chip form |
| `mv-table`, `mv-th-en`, `.is-num` | `DenseTable` | Right-aligned columns are figures |
| `mv-seg` | `ToggleGroup`, `ViewToggle`, `LanguageToggle` | `Tabs` takes the brand underline |
| `mv-field`, `mv-input` | `InlineField` + exported `fieldInputClass` | |
| `mv-spark` | `Sparkline` | |
| `mv-sr` | Tailwind `sr-only` | |
| `mv-ticker`, `mv-live-dot`, `mv-row`, `mv-stack` | — | Landing or demo only (decision 3) |

**Files:**
- Modify: `components/ui/{ActionButton,Card,DeltaBadge,DenseTable,KPIBlock,ToggleGroup,Tabs,ViewToggle,InlineField,Sparkline,PageHeader,SectionHeader,ModalShell,Sidebar,StatusBadge}.tsx`
- Modify: `app/cases/[id]/page.tsx`, `app/dev/monitor/page.tsx`, `app/monte-carlo/page.tsx` (`PageHeader` eyebrow callers)
- Modify: `lib/i18n/labels.ts`, `lib/i18n/messages/{en,ko}.ts`, `docs/design/MoneyView_Glossary.md`, `app/dev/design/page.tsx`, `tests/e2e/helpers/designScreens.ts`
- Create: `tests/e2e/components-paper.spec.ts`

**Interfaces:**
- Consumes: tokens (Task 5), `formatNumber`/`MISSING` (Task 6), `BilingualLabel`/`Eyebrow`/`useT` (Task 7)
- Produces:
  - `DeltaBadge` with `data-dir="up|down|flat"` and `[data-part="value"]`
  - `ColumnDef.label?: LabelKey`; `ColumnDef.header` becomes optional, removed in Task 14
  - `PageHeader.eyebrow?: { label: LabelKey; suffix?: string }`
  - `Sparkline.tone?: "up"|"down"|"brand"|"neutral"`
  - `fieldInputClass` (exported from `InlineField.tsx`)
  - catalog keys `delta.up|down|flat`; labels `change`, `case`, `devRuntime`, `monteCarlo`

- [ ] **Step 1: Write the failing test** (`tests/e2e/components-paper.spec.ts`)

```ts
import { expect, test, type Locator } from "@playwright/test";

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const style = (locator: Locator, ...props: string[]) =>
  locator.evaluate((el, names) => Object.fromEntries(names.map((n) => [n, getComputedStyle(el).getPropertyValue(n)])), props);

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
});

test("primary button is a brand fill with near-black text, 44px tall, 2px corners", async ({ page }) => {
  const button = page.getByRole("button", { name: "Primary" });
  expect(await style(button, "background-color", "color", "height", "border-top-left-radius", "text-transform")).toEqual({
    "background-color": rgb("#fa3600"), color: rgb("#101010"), height: "44px", "border-top-left-radius": "2px", "text-transform": "uppercase",
  });
});

test("deltas pair colour with glyph and sign; rounded zero and missing read as flat", async ({ page }) => {
  const deltas = page.getByTestId("gallery-deltas").getByTestId("delta-badge");
  const read = (i: number) => deltas.nth(i).evaluate((el) => ({
    dir: el.getAttribute("data-dir"),
    glyph: el.querySelector('[aria-hidden="true"]')?.textContent,
    value: el.querySelector('[data-part="value"]')?.textContent,
    color: getComputedStyle(el).color,
  }));
  expect(await read(0)).toEqual({ dir: "up", glyph: "▲", value: "+1.2%", color: rgb("#d21f3c") });
  expect(await read(1)).toEqual({ dir: "down", glyph: "▼", value: "-3.4%", color: rgb("#1e5bd8") });
  expect(await read(2)).toEqual({ dir: "flat", glyph: "■", value: "0.0%", color: rgb("#626260") });
  expect(await read(3)).toEqual({ dir: "flat", glyph: "■", value: "—", color: rgb("#626260") });
});

test("card is a square hairline panel with four corner ticks and no shadow", async ({ page }) => {
  const card = page.getByTestId("gallery-card-body").locator("..");
  expect(await style(card, "border-top-width", "border-top-color", "background-color", "border-top-left-radius", "box-shadow")).toEqual({
    "border-top-width": "1px", "border-top-color": rgb("#b3b3af"), "background-color": rgb("#f0f0f0"),
    "border-top-left-radius": "0px", "box-shadow": "none",
  });
  await expect(card.locator(':scope > i[aria-hidden="true"]')).toHaveCount(4);
});

test("table headers are 11px mono captions; right-aligned cells are mono figures", async ({ page }) => {
  const table = page.getByTestId("gallery-table");
  const th = await style(table.locator("th").first(), "font-size", "font-family");
  expect(th["font-size"]).toBe("11px");
  expect(th["font-family"].toLowerCase()).toContain("geistmono");
  const figure = await style(table.locator("tbody td").nth(1), "text-align", "font-family");
  expect(figure["text-align"]).toBe("right");
  expect(figure["font-family"].toLowerCase()).toContain("geistmono");
});

test("the selected segment is an ink fill with ground-coloured text", async ({ page }) => {
  const on = page.getByTestId("gallery-toggle").getByRole("button", { name: "3M" });
  expect(await style(on, "background-color", "color")).toEqual({ "background-color": rgb("#282828"), color: rgb("#ffffff") });
});

test("a large KPI figure is the 44px mono figure style", async ({ page }) => {
  const s = await style(page.getByTestId("gallery-card-body").getByText("2,847.31"), "font-size", "font-family");
  expect(s["font-size"]).toBe("44px");
  expect(s["font-family"].toLowerCase()).toContain("geistmono");
});
```

If Task 4 recorded a different family substring than `geistmono`, use it here. Run. Expected FAIL: the `Primary` button and `gallery-deltas` are not found.

- [ ] **Step 2: Extend the gallery** (replace `app/dev/design/page.tsx`)

```tsx
"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { DenseTable } from "@/components/ui/DenseTable";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { Sparkline } from "@/components/ui/Sparkline";
import { ToggleGroup } from "@/components/ui/ToggleGroup";

// Component gallery: the deterministic surface for component tests and visual review
// (design-system plan, Tasks 7-8). Sample values are constants.
const ROWS = [
  { name: "삼성전자", price: "71,200", change: 1.24 },
  { name: "SK하이닉스", price: "182,500", change: -0.87 },
];
const RANGES = [{ value: "1M", label: "1M" }, { value: "3M", label: "3M" }, { value: "1Y", label: "1Y" }];
const SPARK = [3, 4, 3.5, 5, 4.8, 6];
const noop = () => {};

export default function DesignGalleryPage() {
  const [range, setRange] = useState("3M");
  return (
    <div className="flex flex-col gap-8 p-6">
      <section data-testid="gallery-eyebrow"><Eyebrow index={1} label="market" /></section>
      <section data-testid="gallery-buttons" className="flex gap-3">
        <ActionButton label="Primary" variant="primary" onClick={noop} />
        <ActionButton label="Secondary" onClick={noop} />
        <ActionButton label="Small" size="sm" onClick={noop} />
        <ActionButton label="Disabled" disabled onClick={noop} />
      </section>
      <section data-testid="gallery-deltas" className="flex gap-3">
        <DeltaBadge value={1.24} />
        <DeltaBadge value={-3.4} />
        <DeltaBadge value={-0.04} />
        <DeltaBadge value={null} />
      </section>
      <Card>
        <div data-testid="gallery-card-body"><KPIBlock label="KOSPI" value="2,847.31" delta={1.24} size="lg" /></div>
      </Card>
      <section data-testid="gallery-toggle">
        <ToggleGroup options={RANGES} value={range} onChange={setRange} ariaLabel="Range" />
      </section>
      <section className="w-48"><Sparkline data={SPARK} /></section>
      <section data-testid="gallery-table">
        <DenseTable
          columns={[
            { key: "name", label: "name" },
            { key: "price", label: "price", align: "right" },
            { key: "change", label: "change", align: "right", render: (v) => <DeltaBadge value={v as number} /> },
          ]}
          data={ROWS}
        />
      </section>
    </div>
  );
}
```

Add `["/dev/design", async () => {}]` to `DESIGN_SCREENS`. Add to `LABELS`: `change: ["등락률", "Change"]`, `case: ["케이스", "Case"]`, `devRuntime: ["개발 런타임", "Developer runtime"]`, `monteCarlo: ["몬테카를로 시뮬레이션", "Monte Carlo"]`. Add their rows to the glossary. Add to `en`: `delta: { up: "Up", down: "Down", flat: "Unchanged" }`, and to `ko`: `delta: { up: "상승", down: "하락", flat: "보합" }`.

- [ ] **Step 3: Restyle the components.** Write the code below exactly. Where a row of the mapping table names old classes, replace exactly those class strings and leave the component's logic and props untouched.

`components/ui/DeltaBadge.tsx` (full):

```tsx
"use client";

import clsx from "clsx";
import { formatNumber, MISSING } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";

interface DeltaBadgeProps {
  /** A change in percent units: 1.24 means +1.24%. */
  value: number | null | undefined;
  className?: string;
}

const GLYPH = { up: "▲", down: "▼", flat: "■" } as const;
const TONE = {
  up: "text-[var(--up)] bg-[var(--up-soft)]",
  down: "text-[var(--down)] bg-[var(--down-soft)]",
  flat: "text-[var(--flat)] bg-[var(--surface)]",
} as const;

// The redesign's delta chip: glyph, sign and colour together, never colour alone. A screen
// reader hears the direction word instead of the glyph. A span, not a div, so it can sit
// inside a <button> (StockTile).
export function DeltaBadge({ value, className }: DeltaBadgeProps) {
  const { locale } = useLocale();
  const t = useT();
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : null;
  const text = numeric === null ? MISSING : formatNumber(numeric / 100, "percent", { signed: true, locale });
  // Direction follows the printed figure (1 decimal), so -0.04 prints "0.0%" and reads as flat.
  const dir = numeric === null || Math.round(numeric * 10) === 0 ? "flat" : numeric > 0 ? "up" : "down";
  return (
    <span
      data-testid="delta-badge"
      data-dir={dir}
      className={clsx("type-mono inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--radius-2)] px-2 py-0.5", TONE[dir], className)}
    >
      <span className="sr-only">{t(`delta.${dir}`)}</span>
      <span aria-hidden="true" className="text-[length:var(--component-delta-glyph)]">{GLYPH[dir]}</span>
      <span data-part="value">{text}</span>
    </span>
  );
}
```

`components/ui/Card.tsx`: keep the props interface. Replace `paddingMap` and the component with:

```tsx
const paddingMap: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

const TICK = "pointer-events-none absolute h-[var(--component-tick-size)] w-[var(--component-tick-size)] border-[var(--ink-muted)]";
// The redesign's panel signature: a 1px hairline frame with 8px corner ticks laid over it.
const TICKS = ["-left-px -top-px border-l border-t", "-right-px -top-px border-r border-t", "-bottom-px -left-px border-b border-l", "-bottom-px -right-px border-b border-r"];

export function Card({ children, padding = "md", hoverable = false, onClick, className, as: Tag = "div" }: CardProps) {
  const isInteractive = hoverable || Boolean(onClick);

  return (
    <Tag
      className={clsx(
        "relative border border-[var(--line)] bg-[var(--surface-raised)]",
        paddingMap[padding],
        isInteractive && "transition-colors duration-[var(--duration-normal)] hover:border-[var(--line-strong)]",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {TICKS.map((position) => <i key={position} aria-hidden="true" className={clsx(TICK, position)} />)}
      {children}
    </Tag>
  );
}
```

`components/ui/ActionButton.tsx`: replace `variantStyles`, `sizeStyles` and the `<button>`'s `className` with:

```tsx
const variantStyles: Record<ActionVariant, string> = {
  primary: "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)] hover:border-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)]",
  secondary: "border-[var(--line-strong)] bg-transparent text-[var(--ink)] hover:border-[var(--brand)] hover:text-[var(--brand-text)]",
  danger: "border-[var(--status-error-border)] bg-transparent text-[var(--status-error-ink)] hover:bg-[var(--status-error-surface)]",
};
const DISABLED = "cursor-not-allowed pointer-events-none border-[var(--grid)] bg-transparent text-[var(--ink-disabled)]";

const sizeStyles: Record<ActionSize, string> = {
  sm: "type-caption h-[var(--component-button-height-sm)] px-3 gap-1.5",
  md: "type-mono h-[var(--component-button-height-md)] px-5 gap-2",
};
```

```tsx
      className={clsx(
        "inline-flex items-center justify-center rounded-[var(--radius-1)] border uppercase",
        "transition-colors duration-[var(--duration-normal)]",
        isDisabled ? DISABLED : variantStyles[variant],
        sizeStyles[size],
        className
      )}
```

`components/ui/DenseTable.tsx`: add the imports `import { BilingualLabel } from "@/components/ui/BilingualLabel";`, `import { MISSING } from "@/lib/format";` and `import type { LabelKey } from "@/lib/i18n/labels";`. Change `ColumnDef` to:

```ts
export interface ColumnDef<T> {
  key: string;
  /** Plain header text: replaced by `label` screen by screen, removed in Task 14. */
  header?: string;
  /** Bilingual header ("종목 NAME"); wins over `header`. */
  label?: LabelKey;
  /** "right" marks a figure column: Geist Mono, tabular, right-aligned (redesign .is-num). */
  align?: "left" | "right" | "center";
  width?: string;
  render?: (value: unknown, row: T) => ReactNode;
}
```

and the returned JSX to:

```tsx
    <div className={clsx("w-full overflow-x-auto", className)}>
      <table className="type-body w-full min-w-max border-collapse text-[var(--ink-secondary)]">
        <thead className={clsx("bg-[var(--bg)]", stickyHeader && "sticky top-0 z-10")}>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className={clsx("type-caption whitespace-nowrap border-b border-[var(--line)] px-4 py-2 uppercase text-[var(--ink-muted)]", alignMap[col.align ?? "left"])}
                style={col.width ? { width: col.width } : undefined}
              >
                {col.label ? <BilingualLabel k={col.label} /> : col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-8 text-center text-[var(--ink-muted)]">{emptyMessage}</td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={clsx(
                  "border-b border-[var(--grid)] transition-colors duration-[var(--duration-normal)] hover:bg-[var(--surface)]",
                  onRowClick && "cursor-pointer"
                )}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => {
                  const raw = row[col.key];
                  return (
                    <td
                      key={col.key}
                      className={clsx("whitespace-nowrap px-4 py-3", col.align === "right" && "type-mono text-[var(--ink)]", alignMap[col.align ?? "left"])}
                    >
                      {col.render ? col.render(raw, row) : raw == null ? MISSING : String(raw)}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
```

`components/ui/PageHeader.tsx` (full):

```tsx
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { LabelKey } from "@/lib/i18n/labels";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: { label: LabelKey; suffix?: string };
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2"><Eyebrow label={eyebrow.label} suffix={eyebrow.suffix} /></div>}
        <h1 className="type-heading-5 text-[var(--ink)]">{title}</h1>
        {subtitle && <p className="type-body mt-1 text-[var(--ink-secondary)]">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
```

Callers:
- `app/cases/[id]/page.tsx:49`: `eyebrow={{ label: "case", suffix: record.id }}` (if `record.id` is a number, use `String(record.id)`)
- `app/dev/monitor/page.tsx` (lines 366, 379, 396, 415): `eyebrow={{ label: "devRuntime" }}`
- `app/monte-carlo/page.tsx:677`: `eyebrow={{ label: "monteCarlo" }}`

`components/ui/Sparkline.tsx`: change the props and stroke to:

```tsx
type SparkTone = "up" | "down" | "brand" | "neutral";
const TONE_COLOR: Record<SparkTone, string> = { up: "var(--up)", down: "var(--down)", brand: "var(--brand)", neutral: "var(--ink-muted)" };

interface SparklineProps {
  data: number[];
  /** Explicit stroke; wins over tone. */
  color?: string;
  /** Default: the direction of the whole window (last vs first), as in the redesign. */
  tone?: SparkTone;
  height?: number;
}

export function Sparkline({ data, color, tone, height = 40 }: SparklineProps) {
```

Before `return`, add `const stroke = color ?? TONE_COLOR[tone ?? (data[data.length - 1] >= data[0] ? "up" : "down")];`. On `<Line>`, set `stroke={stroke}` and `strokeWidth={1.5}`.

`components/ui/InlineField.tsx`: add and export the shared input look below the imports:

```tsx
/** The redesign's text input (bundle.css .mv-input); every <input>/<select>/<textarea> uses it. */
export const fieldInputClass =
  "type-body h-[var(--component-input-height)] w-full rounded-[var(--radius-1)] border border-[var(--line-strong)] bg-[var(--surface-sunken)] pl-4 pr-2 text-[var(--ink)] placeholder:text-[var(--ink-muted)] focus:border-[var(--brand)] aria-[invalid=true]:border-[var(--status-error-border)] disabled:border-[var(--grid)] disabled:text-[var(--ink-disabled)]";
```

Then apply this mapping table:

| Component, element | Old classes (as of Task 3) | New classes |
|---|---|---|
| `InlineField` label (line 27) | `text-[length:var(--type-helper)] font-semibold text-[var(--text-primary)]` | `type-label text-[var(--ink)]` |
| `InlineField` help (line 29) | `text-[length:var(--type-caption)] leading-[1.4] text-[var(--text-muted)]` | `type-small text-[var(--ink-muted)]` |
| `KPIBlock` label | `text-[length:var(--type-small)] font-medium text-[var(--text-muted)] leading-tight tracking-wide` | `type-label text-[var(--ink-secondary)]` |
| `KPIBlock` loading block | `h-8 w-24 rounded-[var(--radius-sm)] bg-[var(--bg-subtle)] animate-pulse` | `h-8 w-24 bg-[var(--surface)] animate-pulse` |
| `KPIBlock` `valueSizeMap` | sm/md `text-[length:var(--type-metric-md)] font-semibold`, lg `text-[length:var(--type-metric-lg)] font-bold` | sm/md `type-figure-md`, lg `type-figure` |
| `KPIBlock` value span | `text-[var(--text-primary)] leading-none tabular-nums` plus `style={{ letterSpacing … }}` | `text-[var(--ink)]`, and delete the `style` prop |
| `SectionHeader` h2 | `text-[length:var(--type-section-title)] font-semibold leading-snug text-[var(--text-primary)]` plus `style` | `type-panel-title text-[var(--ink)]`, and delete the `style` prop |
| `SectionHeader` description | `mt-0.5 text-[length:var(--type-helper)] text-[var(--text-muted)] leading-relaxed` | `type-small mt-1 text-[var(--ink-muted)]` |
| `ToggleGroup` container | `… gap-[var(--space-1)] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-muted)] p-[var(--space-1)]` | `inline-flex flex-wrap items-center gap-0.5 rounded-[var(--radius-1)] border border-[var(--line-strong)] p-0.5` |
| `ToggleGroup` `sizeStyles` | sm `min-h-8 px-[var(--space-3)] text-[length:var(--type-helper)]`, md `min-h-9 px-[var(--space-4)] text-[length:var(--type-small)]` | sm `min-h-6`, md `min-h-8` |
| `ToggleGroup` button base | `… rounded-[calc(var(--radius-md)-2px)] font-medium … focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1` | `type-caption inline-flex items-center justify-center rounded-[var(--radius-1)] px-3 py-1 uppercase transition-colors duration-[var(--duration-normal)]` |
| `ToggleGroup` selected / unselected | `border border-transparent bg-[var(--bg-surface)] text-[var(--text-primary)]` / `border border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]` | `bg-[var(--ink)] text-[var(--bg)]` / `text-[var(--ink-muted)] hover:text-[var(--ink)]` |
| `ViewToggle` container and buttons | its `clsx` strings (lines 21–23, 35) | the same three `ToggleGroup` strings: container, button base, selected/unselected |
| `Tabs` container (line 30) | `flex gap-[var(--space-2)] overflow-x-auto border-b border-[var(--border-soft)]` | `flex gap-4 overflow-x-auto border-b border-[var(--line)]` |
| `Tabs` tab (line 50) | `… border-b-2 … text-[length:var(--type-small)] font-medium … focus-visible:*` | `type-mono relative inline-flex min-h-10 items-center gap-2 px-1 pb-3 pt-2 uppercase transition-colors duration-[var(--duration-normal)]` |
| `Tabs` selected / unselected | `border-[var(--border-accent)] text-[var(--text-primary)]` / `border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]` | `text-[var(--ink)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-[var(--brand)]` / `text-[var(--ink-muted)] hover:text-[var(--ink)]` |
| `ModalShell` backdrop (line 129) | `bg-black/40` | `bg-[var(--overlay-scrim)]` |
| `ModalShell` panel (line 143 `clsx`) | its `rounded-*`, `shadow-*` and background classes | delete `rounded-*` and `shadow-*`; background `bg-[var(--bg)]`, add `border border-[var(--line)]` |
| `ModalShell` header rule, title, subtitle (152, 156, 161) | `border-[var(--border-soft)]`; `text-[length:var(--type-section-title)] font-semibold text-[var(--text-primary)] leading-snug`; `mt-0.5 text-[length:var(--type-helper)] text-[var(--text-muted)]` | `border-[var(--line)]`; `type-panel-title text-[var(--ink)]`; `type-small mt-0.5 text-[var(--ink-muted)]` |
| `Sidebar` aside (lines 32–45) | its background, border and shadow classes | `bg-[var(--surface)] border-r border-[var(--line)]`; no shadow |
| `Sidebar` logo (48–49) | `<Activity className="h-6 w-6 text-[var(--accent)]" />` and `font-bold text-xl text-[var(--text-primary)]` | `<span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-[var(--brand)]" />` and `type-panel-title text-[var(--ink)]` (drop the `Activity` import if unused) |
| `Sidebar` nav link (62) | its colour, background, radius and size classes | base `type-body font-bold text-[var(--ink)] rounded-[var(--radius-1)] hover:bg-[var(--surface-raised)]`; active adds `bg-[var(--surface-raised)]` (and loses any shadow class) plus a leading `<span aria-hidden="true" className="h-4 w-0.5 bg-[var(--brand)]" />` |
| `Sidebar` footer (74) | `text-xs text-[var(--text-muted)]` | `type-caption text-[var(--ink-muted)]` |
| `StatusBadge` styles map | success/warning/error/neutral tone classes | `bg-[var(--status-<tone>-surface)] text-[var(--status-<tone>-ink)] border-[var(--status-<tone>-border)]` for success, warning, error; neutral `bg-[var(--surface)] text-[var(--ink-secondary)] border-[var(--line)]`; badge `rounded-[var(--radius-2)] type-small`; dot keeps `rounded-full` |

> **2026-10-14:** `Sidebar.tsx` was replaced by `components/ui/TopNav.tsx` (corporate-one-screen plan, Task 3), which carries this paper look over. Later tasks that name `Sidebar` apply to `TopNav`.

The `Sidebar` keeps `font-bold`, because `sidebar-contrast.spec.ts` asserts 700. That spec also requires the hover background to equal the active background, which both rows above give: `--surface-raised`.

- [ ] **Step 4: Review the containing-block change.** Run `git grep -n "absolute" -- app components`. For each hit inside a `<Card>`, check that it still positions against the box it meant to. It now positions against the card, which became `relative`. Note each one checked in Track D. Fix any that moved by adding `relative` to the box it intended.

- [ ] **Step 5: Run.** `npm run typecheck && npm run lint && npx playwright test`. Expected: `components-paper.spec.ts` passes. If an existing assertion encodes old component text or size, such as an exact `toHaveText` on a container holding a `DeltaBadge` (now with screen-reader text and a glyph) or the old `"N/A"` for a missing delta, **stop and list it for the owner**. `git grep -n '"N/A"' -- tests/e2e` shows `corporate-dcf-sensitivity.spec.ts:139` and `portfolio-watchlist.spec.ts:428`. Check whether either reads a `DeltaBadge`, and list it only if it does.

- [ ] **Step 6: Capture and review.** `DESIGN_CAPTURE=after-components npx playwright test tests/e2e/design-capture.spec.ts && node scripts/capture-review.mjs after-paper after-components`. The owner reviews `/dev/design` against the redesign's look (open `docs/design/redesign-2026-10/ds/moneyview/components/bundle.css` side by side) and every screen for layout regressions. The taller 44 px buttons and inputs and the 20 px card padding are expected.

- [ ] **Step 7: Mutation matrix**

| Mutation | Must fail |
|---|---|
| `primary` variant `text-[var(--on-brand)]` → `text-[var(--bg)]` | `primary button is a brand fill …` |
| `DeltaBadge` direction without the `Math.round(numeric * 10) === 0` test | `… rounded zero and missing read as flat` (third badge reads down) |
| `Card` without the `TICKS` map | `card is … four corner ticks …` |
| `DenseTable` without `type-mono` on right-aligned cells | `… right-aligned cells are mono figures` |
| `KPIBlock` lg → `type-figure-md` | `a large KPI figure is the 44px mono figure style` |
| `ToggleGroup` selected → `bg-[var(--surface-raised)]` | `the selected segment is an ink fill …` |

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/ui apps/web/app/dev apps/web/app/cases apps/web/app/monte-carlo/page.tsx apps/web/lib/i18n apps/web/tests/e2e/components-paper.spec.ts apps/web/tests/e2e/helpers/designScreens.ts docs/design/MoneyView_Glossary.md
git commit -m "feat(design): shared components take the redesign's panel, button, delta, table and segment look"
```

---

### Screen migration procedure (used by Tasks 9–13)

Each screen task runs these steps over its own file globs. The mapping tables are fixed here, so every task applies the same rules. A lint message names the replacement for a deprecated variable. These tables add the contextual choices a message cannot make.

**M1: colour.** First, deprecated variables:

| From | To |
|---|---|
| `--bg-canvas`, `--bg-primary` | `--bg` |
| `--bg-surface`, `--bg-elevated`, `--surface-panel` | `--surface-raised` |
| `--bg-subtle`, `--bg-sidebar`, `--bg-secondary`, `--surface-muted` | `--surface` |
| `--text-primary` / `--text-secondary` / `--text-muted` / `--text-disabled` | `--ink` / `--ink-secondary` / `--ink-muted` / `--ink-disabled` |
| `--text-inverse` | `--bg` on an ink fill; `--on-brand` on a brand fill |
| `--border`, `--border-default` | `--line` |
| `--border-soft` | `--grid` (row rules); `--line` if it frames a box |
| `--border-strong` | `--line-strong` |
| `--border-accent` | `--brand` |
| `--brand` (former mint, Task 3) used as a text or icon colour | `--brand-text` |
| `--brand` as a fill with text on it | keep `--brand`; the text becomes `--on-brand` |
| `--accent` | `--brand-soft` as a ground; `--brand-text` as text or icon |
| `--delta-up`, `--state-positive`, `--chart-positive` | `--up` |
| `--delta-down`, `--state-negative`, `--chart-negative` | `--down` |
| `--state-warning`, `--state-success`, `--state-error` | `--status-<tone>-ink` for text, icon or fill; `--status-<tone>-surface` for a ground |
| `--state-info` | `--brand` as a fill; `--brand-text` as text; inside `focus-visible:ring-*`, delete (M3) |
| `--chart-primary/secondary/tertiary/muted` | `--chart-1/2/3/4` |
| `--chart-label`, `--chart-ink`, `--chart-grid` | `--ink-muted`, `--ink`, `--grid` |
| any `bg-[var(--x)]/NN` or `text-[var(--x)]/NN` opacity modifier | the matching soft token: `--up-soft`, `--down-soft`, `--brand-soft`, `--status-<tone>-surface`. Task 14's sweep rejects mixed colours. |

Then Tailwind palette classes:

| From | To |
|---|---|
| `bg-amber-50`, `bg-amber-100` | `bg-[var(--status-warning-surface)]` |
| `border-amber-200`, `border-amber-300` | `border-[var(--status-warning-border)]` |
| `text-amber-700`, `-800`, `-900`, `-950`; `bg-amber-500`, `bg-orange-600` | `text-[var(--status-warning-ink)]` / `bg-[var(--status-warning-ink)]` |
| `bg-red-50`, `bg-red-100`, `bg-rose-50`, `bg-rose-100` | `bg-[var(--status-error-surface)]` |
| `border-red-100`, `border-red-200`, `border-rose-200` | `border-[var(--status-error-border)]` |
| `text-red-400…900`, `text-rose-700`; `bg-red-500` | `text-[var(--status-error-ink)]` / `bg-[var(--status-error-ink)]` |
| `bg-emerald-50`, `bg-emerald-100` | `bg-[var(--status-success-surface)]` |
| `border-emerald-200` | `border-[var(--status-success-border)]` |
| `text-emerald-800`, `-900`; `bg-emerald-500`, `bg-teal-500` | `text-[var(--status-success-ink)]` / `bg-[var(--status-success-ink)]` |
| `bg-gray-200`, `bg-slate-100`, `bg-slate-50`, `bg-blue-50/50` | `bg-[var(--surface)]` |
| `border-gray-100`, `border-blue-100/50` | `border-[var(--grid)]` |
| `bg-slate-500` | `bg-[var(--line-strong)]` |
| `bg-black/40`, `bg-black/50`, `bg-black/55` | `bg-[var(--overlay-scrim)]` |
| `bg-black` (opaque) | a tooltip or popover surface → `bg-[var(--ink)]` with `text-[var(--bg)]`; a backdrop → `bg-[var(--overlay-scrim)]`. Name the choice in the commit. |
| `text-white`, `text-white/85` | `text-[var(--on-brand)]` on a brand fill; `text-[var(--bg)]` on an ink or status-ink fill |
| `text-black` | `text-[var(--ink)]` |

**M2: type.** Delete the `font-*`, `leading-*`, `tracking-*` classes and inline `letterSpacing` on the same element. The `type-*` utility carries weight, line height and tracking. Keep a `font-bold`/`font-semibold` only where emphasis differs from the style, and say why in a comment.

| From | To |
|---|---|
| `text-[10px]`, `text-[11px]`, `--type-caption`, `--type-table-header`; a `text-xs … uppercase` label, timestamp or axis text | `type-caption` (mono; add `uppercase` for labels) |
| `text-xs`, `text-[12px]`, `--type-helper`, `--type-table-body`, `--type-small` (prose) | `type-small` |
| `text-sm`, non-heading `text-base`, `--type-body` | `type-body` |
| form labels, emphasized inline labels | `type-label` |
| headings set in `text-base`, `text-lg`, `text-xl`; `--type-card-title`, `--type-section-title`, `--type-metric-md` (heading) | `type-panel-title` |
| headings set in `text-2xl` … `text-4xl`; `--type-page-title` | `type-heading-5` |
| a figure of 20 px or more (KPI, last price, headline metric); `--type-metric-lg`; `--type-metric-md` as a figure | `type-figure-md` (`type-figure` only through `KPIBlock size="lg"`) |
| a figure in a table cell, list row or inline text | `type-mono` |
| a link-like button or nav-like CTA in mono capitals | `type-mono-link` |

**M3: radius, shadow, focus.**

| Element | Radius |
|---|---|
| panels, cards, tiles, tables, charts, modals, sections | none (delete `rounded-*`, `rounded-[var(--radius…)]`) |
| `<button>`, `<input>`, `<select>`, `<textarea>`, `role="tab"`, segmented controls | `rounded-[var(--radius-1)]` |
| tooltips, menus, popovers, badges, chips | `rounded-[var(--radius-2)]` |
| dots, spinners, progress tracks | `rounded-full` (unchanged) |

- Every `shadow-*`, `shadow-[var(--shadow-*)]` and `hover:shadow-*` is deleted. If the element needed the shadow to stand off the ground (popover, menu, floating panel), add `border border-[var(--line)]`.
- Every `focus-visible:outline-none`, `focus-visible:ring-*` and `focus-visible:ring-offset-*` is deleted; the global ring (Task 5) applies.
- Inputs use `fieldInputClass` from `InlineField.tsx`.

**M4: hex, colour functions, charts.** Replace each with the token holding that role (search `lib/tokens.generated.ts`).
- Chart category colours → `var(--chart-N)`, with N ≤ 5 in order of importance; chart-1 is the subject.
- A chart with six or more categories folds the tail into one "Other" series in `var(--chart-4)`. Name the folded series in the commit.
- Area and band fills use `fillOpacity={Number(tokens.chart["area-opacity"])}`.
- Canvas surfaces (lightweight-charts) → `resolveCssColor("var(--token)", tokens.<path>)`, so the fallback is also a token.
- A colour with no token stops the task: propose the token first (the `DESIGN.md` rule).
- Event-category colours that arrive in API data (`eventsApiMock.ts`) are user data, not design values. They stay as data.

**M5: numbers.** `x.toFixed(n)`, `x.toLocaleString(...)` and local `format*` helpers become `formatNumber(x, kind, { locale })`, with `locale` from `useLocale()`. Every figure gets a mono style (M2). Delete a local helper once it is unused. Keep a helper only if it is not a number format (dates, durations, tickers), and note why.

**M6: strings.** Move JSX text and the `aria-label`, `title`, `placeholder` and `alt` literals into `en.ts` under the screen's namespace. Write the `ko` entry following the glossary; add new terms to the glossary first. An LLM may draft the translation, given the glossary and the instruction "terms in the glossary are fixed". The owner then reviews the `ko.ts` diff, and **every line containing a number, unit or sign is read by eye**.

**M7: bilingual small labels.** Every `<th>` text, every `DenseTable` column `header`, and every small uppercase label above a title (an eyebrow) becomes bilingual:
- `<BilingualLabel k=… />`
- `label: "<key>"` on a `DenseTable` column
- `<Eyebrow label=… />`

Add the `LABELS` entry and its glossary row first. A `<th>` that is empty or holds only an icon stays as it is.

**Per-task steps:**
1. Run `npm run design:baseline -- <globs>` and record the counts.
2. Apply M1–M7 to the globs.
3. Run `npm run design:baseline -- <globs>` again. Every category must be 0, including `deprecatedVar` and `unknownVar`. Then run `npm run typecheck && npm run lint`.
4. Run the task's e2e specs (English default). If an assertion encodes an old value (a number format, a merged shade, a header that is now bilingual), stop and list it for the owner before changing the test.
5. Add one Korean assertion to the spec named by the task: a `test.describe` with `test.use({ locale: "ko-KR" })` that opens the screen and asserts its translated title, one formatted figure and one bilingual header (`getByRole("columnheader", { name: "<ko>", exact: true })`).
6. Run `DESIGN_CAPTURE=<task-id> npx playwright test tests/e2e/design-capture.spec.ts`, then `node scripts/capture-review.mjs <previous-task-id> <task-id>`. Put the review page path and the owner's verdict line in Track D.
7. Mutation: put one replaced class back in one file. `npm run design:baseline -- <globs>` must report 1 in that category, which proves the rule covers this screen. Delete the step-5 `ko` catalog entry: the Korean assertion must fail. Restore both.
8. Commit `refactor(design): <screen> on paper tokens, formatNumber and en/ko strings`.

### Task 9: Shared UI remainder, charts, data and workbench components

**Globs:** `components/ui/**/*.tsx` (what Task 8 did not touch), `components/charts/**/*.tsx`, `components/data/**/*.tsx`, `components/workbenches/**/*.tsx`, `components/providers/**/*.tsx`, `lib/chartConfig.ts`. (`components/market/**` belongs to Task 13.)
**Specs:** the whole Playwright suite, because shared components render on every page.
**Korean assertion:** in `tests/e2e/i18n.spec.ts`, a shared `ErrorState` text in Korean.

- [ ] Run the procedure, steps 1–8. In addition:
  - In `lib/chartConfig.ts`, replace `CHART_COLORS`, `CHART_COLOR_SEQUENCE` and `CHART_REFERENCE_COLORS` with:

```ts
export const CHART_COLORS = {
  primary: "var(--chart-1)",
  secondary: "var(--chart-2)",
  tertiary: "var(--chart-3)",
  muted: "var(--chart-4)",
  label: "var(--ink-muted)",
  ink: "var(--ink)",
  positive: "var(--up)",
  negative: "var(--down)",
} as const;

/** Five series (redesign chart-1..5). A sixth category folds into "Other" in chart-4 (M4). */
export const CHART_COLOR_SEQUENCE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export const CHART_REFERENCE_COLORS = {
  baseline: CHART_COLORS.ink,
  highlight: "var(--brand)",
  warning: "var(--status-warning-ink)",
  success: "var(--status-success-ink)",
  danger: CHART_COLORS.negative,
} as const;
```

  - The cursor fill from Task 3 becomes `var(--surface)`.
  - The shared axis tick props, the object holding `fontSize: 11`, become `fontSize: Number.parseFloat(tokens.type.caption._), fontFamily: "var(--font-family-mono)", fill: "var(--ink-muted)"`, with `import { tokens } from "@/lib/tokens.generated";`. SVG attributes cannot hold the `type-caption` utility, so the values come from tokens.
  - Run `git grep -n "CHART_COLOR_SEQUENCE" -- app components`. Any consumer that can receive six or more series folds the tail per M4. List each consumer and its decision in the commit.
  - `TVChart.tsx` (8 hex) and `TornadoChart.tsx` go through M4. The `TVChart` candles use `resolveCssColor("var(--up)", tokens.up._)` and `resolveCssColor("var(--down)", tokens.down._)`. `candle-colour.spec.ts`, already updated in Task 5, is this step's check.
  - Shared strings (`ErrorBoundary`, `EmptyState`, `LoadingState`, `ErrorState`, `ExportButton`, `TickerSearch`, `DenseTable`'s default `emptyMessage`) go to `common.*`.
  - Inputs in `TickerSearch`, `FilterBar` and `Sliders` take `fieldInputClass`.

### Task 10: Portfolio

**Globs:** `app/portfolio/**/*.{ts,tsx}`.
**Specs:** `tests/e2e/portfolio-*.spec.ts`, `watchlist-peer-sync.spec.ts`, `snapshot-history-*.spec.ts`.
**Korean assertion:** in `tests/e2e/portfolio-panel-presentation.spec.ts`.

- [ ] Run the procedure, steps 1–8. `portfolioMetrics.ts` (4 palette classes in a lookup table) maps through M1, and its number helpers fold into `formatNumber` (M5). `StockTile`'s former mint selected fill (`--state-info`, `--bg-surface` text) becomes `bg-[var(--brand)] text-[var(--on-brand)]` (M1). Its focus ring classes are deleted (M3).

### Task 11: Valuation, cases, decisions

> **2026-10-14:** corporate moved out of this task. `docs/superpowers/plans/2026-10-14-corporate-one-screen.md`, run between Tasks 10 and 11 and merged back here, rebuilds `app/corporate/**` on the paper tokens. Its Task 12 applies M1–M4 to every corporate file and M6/M7 to what it wrote. Still open from the corporate side, listed under Follow-ups: M5 numbers in corporate, the English prose of `buildCalculationDetails.ts`, and the bilingual headers of the pre-existing corporate tables (pinned by XPath/columnheader assertions). `LABELS.verdict = ["판정", "Verdict"]` already exists (added there): reuse it.

**Globs:** `app/valuation/**/*.{ts,tsx}`, `app/cases/**/*.{ts,tsx}`, `app/decisions/**/*.{ts,tsx}`, `lib/dcfRefusal.ts`, `lib/bridgeQuality.ts`, `lib/impliedReturn.ts`.
**Specs:** `valuation*.spec.ts`, `cases*.spec.ts`, `decisions.spec.ts`, `dcf-workbench-refusal.spec.ts`.
**Korean assertion:** in `tests/e2e/cases.spec.ts`.

- [ ] Run the procedure, steps 1–8. Refusal and verdict texts move to `valuation.*` and keep their evidence figures through `{param}` interpolation, as the glossary's verdict rule requires. The verdict column header uses the existing `LABELS.verdict`.

### Task 12: Monte Carlo

**Globs:** `app/monte-carlo/**/*.{ts,tsx}`.
**Specs:** `tests/e2e/monte-carlo-*.spec.ts`, `high-risk-render-regression.spec.ts`, `simulation-lab-price-autofill.spec.ts`.
**Korean assertion:** in `tests/e2e/monte-carlo-chart-guard.spec.ts`.

- [ ] Run the procedure, steps 1–8. `PathSimulationSection` (9 palette classes, 3 hex), `RiskAnalysisSection` and `ReturnDistributionSection` go through M1/M4. Percentile bands use `var(--chart-1)` at `tokens.chart["area-opacity"]` (spec `chart.band`, R20). The median line is `var(--ink)` and the tails are `var(--down)` / `var(--up)`. No new colour.

### Task 13: Detail, news, events, dev (market and signals moved out)

> **2026-10-15 (owner):** the market overview (`app/page.tsx`, `components/market/**`) moves to its own one-screen plan, which also applies the paper migration. This follows the corporate precedent; see the proposal in `scratchpad/proposals/market-one-screen.md`, to be turned into a spec. `app/signals/**` is not on this branch until PR #67 merges, and gets its own migration task after that. For this task, ignore the market and signals globs below. The Korean assertion moves to `tests/e2e/news-*.spec.ts`, or to `detail-*` if news has no page heading. The final baseline is 0 for every glob except `app/page.tsx` and `components/market/**`; report the market count as the input to the market plan.

> **2026-10-16:** the market part is `docs/superpowers/plans/2026-10-16-market-one-screen.md` (spec `docs/superpowers/specs/2026-10-16-market-one-screen-design.md`). It applies M1–M7 to `app/page.tsx`, `components/market/**` and `components/data/SparklineCard.tsx`, adds the market Korean assertion to `tests/e2e/market-one-screen.spec.ts`, and lowers the `design:baseline` market cap from 295 to 0 (`scripts/design-baseline-cap.mjs`). The market globs, specs and Korean assertion are struck from this task below.


**Globs:** `app/detail/**/*.{ts,tsx}`, `app/news/**/*.{ts,tsx}`, `app/events/**/*.{ts,tsx}`, `app/dev/**/*.{ts,tsx}`, `app/signals/**/*.{ts,tsx}` (if present), and the remaining `lib/**/*.ts` and `hooks/**/*.ts`.
**Specs:** `detail-*.spec.ts`, `news-*.spec.ts`, `event*.spec.ts`, `perf-dashboard.spec.ts`, `dev-monitor.spec.ts`, `terminal-diagnostics.spec.ts`, `signals-*.spec.ts` (if present).
**Korean assertion:** in `tests/e2e/news-*.spec.ts` (or `detail-*`), per the 2026-10-15 note; the market's is in the market one-screen plan.

- [ ] Run the procedure, steps 1–8.
  - `app/page.tsx` is a server component (`force-dynamic`), so it cannot call `useT()`. Pass message **keys**, not strings, to `PageHeader`, and translate inside it. Make `PageHeader` a client component if it is not one already.
  - The dev monitor's `bg-[linear-gradient(90deg,var(--state-info),var(--state-warning))]` becomes `bg-[var(--brand)]`: a progress fill, not a gradient (the redesign has none).
  - If `app/signals/copy.ts` exists, its entries become `signals.*` in the catalogs, and its state labels use the glossary terms 발동 / 근접 / 미발동 / 데이터 지연, added to the glossary first. Then delete the file.
- [ ] Run `npm run design:baseline` with no globs. The total must be 0.

---

### Task 14a: Lock-down outside the market overview, DESIGN.md, CLAUDE.md, gate

> **2026-10-15 (owner): Task 14 is split in two.** `components/market/**` and `app/page.tsx` still hold 233 baseline hits (162 of them deprecated variables) and get their own one-screen plan, which also applies the paper migration. So:
> - **14a (this task, now):** the stricter lint rules, a shared no-page-scroll test, the design rule at `error` for everything except the market files, `DESIGN.md`, `CLAUDE.md` and a gate over the non-market app.
> - **14b (after the market plan merges):** the deprecated aliases, Tailwind's theme reset, the market override and every market exception go away, and the gate runs again over everything.
>
> Wherever this plan says "Task 14" (Task 1 step 4, Task 13, the self-review), read: error level, `DESIGN.md` and the gate = 14a; alias removal and the market override = 14b.

**Where the old Task 14 content went**

| Old Task 14 content | Now | Why |
|---|---|---|
| Step 1, `paper-sweep.spec.ts` | 14a, market route excluded; 14b removes the exclusion | the market page still renders pre-paper classes and aliases, so its computed colours are not all tokens |
| Step 2, `no-raw-design-values` to `error` | 14a, with a `warn` override for the market files | the owner's split |
| Step 2, `react/jsx-no-literals` and the attribute-text rule | 14b, step 7, only when its count is 0 | measured 2026-10-15 over the repo outside market: **416** `jsx-no-literals` and **118** attribute hits in 59 files (the M6 leftovers of Tasks 9–12, option A). Switching it on at `error` would break lint. |
| Step 3, alias removal, `DenseTable` `label` required, fixture delete | 14b | market still uses aliases and `DenseTable` `header` |
| Step 4, Tailwind theme reset | 14b | with the reset in place the market's `text-xs`, `rounded-md` and `bg-amber-50` classes would render unstyled |
| Steps 5–8, `DESIGN.md`, `CLAUDE.md`, docs, Claude Design System | 14a | the rules are what they document |
| Step 9, final gate | 14a over the non-market app; 14b over the whole app | |
| Step 10, mutation matrix | split by what each mutation tests | |

**Files:**
- Modify: `eslint-rules/no-raw-design-values.mjs`, `eslint-rules/no-raw-design-values.test.mjs`, `eslint-rules/__fixtures__/tokens.css`, `eslint.config.mjs`, `scripts/design-baseline.mjs`
- Create: `tests/e2e/helpers/noPageScroll.ts`, `tests/e2e/one-screen-no-scroll.spec.ts`, `tests/e2e/paper-sweep.spec.ts`, `DESIGN.md` (repo root)
- Modify (the 40 existing hits, table in step 6): `components/ui/{TopNav,ActionButton,ErrorBoundary,LoadingState,MetricQualityBadge,StatusBadge}.tsx`, `components/providers/AppProvider.tsx`, `components/charts/{EventFilter,EventTooltip,HistogramPanel,OHLCVChartCard,PercentileBandPanel}.tsx`, `components/data/TimelineList.tsx`, `components/workbenches/DCFWorkbench.tsx`, `app/corporate/components/graphs/HurdleRateDecompositionGraph.tsx`, `app/dev/monitor/page.tsx`, `app/events/components/EventsTable.tsx`, `app/monte-carlo/components/{MonteCarloRunPanel,shared}.tsx`, `app/portfolio/components/{StockDetailModal,PortfolioAllocationEditor,PortfolioAttributionSummary}.tsx`, `app/cases/components/SimulateResults.tsx`, `components/ui/Sliders.tsx`
- Modify: `.claude/CLAUDE.md` (new §10; §9 is the Work Harness), `docs/INDEX.md`, `docs/design/MoneyView_Design_Tokens.md`, `docs/design/MoneyView_Component_System.md`, `docs/design/MoneyView_Chart_System.md`, `guideline/sop/todo.md`
- Not touched: `components/market/**`, `app/page.tsx`, `tokens/**`, `tests/e2e/corporate-one-screen.spec.ts` (it keeps its private `expectNoPageScroll`; the shared helper is a copy of the same 8 lines, and moving the corporate spec onto it is a follow-up that needs no assertion change)

**Existing-test change inventory (HARNESS stage 3). Owner approval is required before step 2.**

**Approved by the owner on 2026-10-15** (rows as listed; changes: none). Owner also confirmed: 14b step 7 (jsx-no-literals) stays conditional on a zero count; the paper-sweep escape hatch (>15 distinct violations -> stop and ask) stays.

| File:line | Old | New | Why |
|---|---|---|---|
| `eslint-rules/no-raw-design-values.test.mjs:17` (valid case 1, written in Task 1) | the class string contains `rounded-full` with no marker | `rounded-full` removed from that string (the new valid cases cover `rounded-full` with its marker) | under the new rule an unmarked `rounded-full` is an error, so the old string is no longer valid |
| `eslint-rules/__fixtures__/tokens.css` | 8 variables | + `--brand`, `--brand-soft`, `--brand-text`, `--on-brand`, `--ink`, `--radius-2` | the new test strings use these names, and `unknownVar` would otherwise fire. No assertion changes. |

Steps 6 and 10 can change class strings that e2e specs assert (a chip losing `rounded-full`, the `TopNav` weight). If a spec fails because it encodes an old value, **stop and list it for the owner** (`.claude/CLAUDE.md`). Do not edit the assertion.

**Interfaces:**
- Produces, in rule `moneyview/no-raw-design-values` (same rule id, so `design-baseline.mjs` and every `eslint-disable` keep working): messageIds `roundedFull`, `fontWeight`, `brandGround`, `brandHover`, `brandText`, `figureMono`.
- Produces: exemption syntax `{/* rounded-full: dot|track|fill|spinner */}` and `{/* M2: <reason> */}`.
- Produces: `design:baseline` output with `bySeverity`; `pageScrollProblems`, `measurePage`, `expectNoPageScroll` in `tests/e2e/helpers/noPageScroll.ts`.
- Consumes: `ONE_SCREEN_ROUTES` (`components/ui/oneScreenRoutes.ts`), `DESIGN_SCREENS` (`tests/e2e/helpers/designScreens.ts`), `tokens` (`lib/tokens.generated.ts`).

**Output contracts (HARNESS plan rule).** Line numbers are as of commit `370d254`.

*A. The six new checks.* All run inside `create(context)` of the existing rule. A "class literal" is a string `Literal` or `TemplateElement` for which the existing `inClassContext(node)` is true. A token is one whitespace-separated item of the literal's text; its *variants* are the `:`-separated prefixes (`md:hover:bg-x` has variants `md`, `hover`); its *base* is the rest.

| messageId | Visits | Flags (node reported) | Does not flag | Message (exact) |
|---|---|---|---|---|
| `roundedFull` | class literals | the literal, once, when a token's base is `rounded-full` (any variants) and no comment in the window (below) matches `/\brounded-full:\s*(?:dot\|track\|fill\|spinner)\b/` | prose outside class context (`"a rounded-full pill"`); `rounded-[var(--radius-2)]`; a literal whose window holds `rounded-full: dot` | `rounded-full is for dots, tracks, fills and spinners. Mark one with a comment on the same or previous line, {/* rounded-full: dot */} (or track, fill, spinner), or use rounded-[var(--radius-2)] for a chip.` |
| `fontWeight` | class literals | the literal, once, when a token's base is `font-medium`, `font-semibold`, `font-bold`, `font-extrabold` or `font-black` and no comment in the window matches `/\bM2:\s*\S/` | `font-mono`, `font-normal`; prose outside class context; `M2:` with no reason | `A bold, semibold, medium or black weight overrides the type style. Delete it, or justify it in a comment on the same or previous line: {/* M2: <why> */}.` |
| `brandGround` | class literals | the literal, once, when a token's base is `bg-[var(--brand)]` and its variants contain neither a hover-like nor a pseudo-element variant, unless (a) the scope's source text contains `text-[var(--on-brand)]` or (b) the scope is a `className` attribute on an element with no children | `after:bg-[var(--brand)]`; `bg-[var(--brand-soft)]`; tone tables such as `{ dot: "bg-[var(--brand)]" }` (not class context); a fill element without children (dot, bar, marker) | `bg-[var(--brand)] behind text needs text-[var(--on-brand)] in the same className. A fill with no text is fine as an element without children.` |
| `brandHover` | class literals | once per token whose variants include `hover`, `focus`, `focus-visible`, `active`, `group-hover` or `peer-hover` and whose base is `bg-[var(--brand)]` | `hover:bg-[var(--brand-soft)]` | `A hover, focus or active ground is bg-[var(--brand-soft)], not the solid brand fill.` |
| `brandText` | every string literal and template element (the `EVERYWHERE` group) | the literal, once, when it holds a token `text-[var(--brand)]` (any variants, optional `/NN` suffix) | `text-[var(--brand-text)]`; `border-[var(--brand)]`; `accent-[var(--brand)]` | `Brand as text is --brand-text: text-[var(--brand-text)].` |
| `figureMono` | `JSXExpressionContainer` | the container (`{formatNumber(...)}`), once, when (1) its parent is a `JSXElement` with a lowercase tag, (2) its expression is a `formatNumber(...)` call or contains one under `?:`, `&&`, `+` or a template literal, (3) every child of that element is whitespace text or an expression container (no prose around the figure), and (4) neither the element nor any `JSXElement` ancestor has a `className` whose source matches `/\btype-(?:mono\|figure)/` | prose around the figure (`Total {formatNumber(v)} draws`); component tags (`<Cell>`); an element or ancestor whose `className` is an identifier, member expression or non-helper call (cannot be read); `formatNumber` passed as an attribute (`<Delta value={formatNumber(v)} />`); other formatters (`formatDate`) | `A figure needs type-mono (cell, row, inline) or type-figure-md / type-figure (KPI), on this element or an ancestor.` |

*The comment window.* For a literal inside a `className` attribute: from the line before the element's opening tag to the last line of the literal. Otherwise: from the line before the literal to its last line. A comment counts when it overlaps the window. So `{/* rounded-full: dot */}` on the line above `<span className="rounded-full" />` counts, a trailing `// rounded-full: track` on the same line counts, and one blank line in between does not. One comment covers one element: a track and its fill each need their own.

*B. Helpers added to the rule file.*

| Function | Returns | Cases | Example |
|---|---|---|---|
| `classTokens(text)` | `string[]` | splits on whitespace, `"`, `'` and the backtick; drops empty items; `[]` for `""` | `classTokens('md:hover:bg-x "y"')` → `["md:hover:bg-x", "y"]` |
| `splitVariants(token)` | `{ variants: string[], base: string }` | a `:` inside `[...]` is not a separator; no variants → `[]` | `splitVariants("md:hover:bg-[var(--brand)]")` → `{ variants: ["md","hover"], base: "bg-[var(--brand)]" }`; `splitVariants("[--main-pad-top:4rem]")` → `{ variants: [], base: "[--main-pad-top:4rem]" }` |
| `classScope(node)` | the `className` `JSXAttribute`, else the outermost `clsx`/`cn`/`twMerge`/`cva` `CallExpression`, `className` `Property` or class-named `VariableDeclarator` that contains `node`; `null` when none | a literal inside `clsx(...)` inside `className={...}` returns the attribute | for `<b className={clsx("a", "b")}/>`, both literals return the same attribute |
| `formatsNumber(expr)` | `boolean` | `true` for `formatNumber(...)`, and for a conditional branch, the right side of `&&`, either side of a binary `+`, or a template-literal expression that is one; `false` for any other node and for `undefined` | `v == null ? "—" : formatNumber(v)` → `true`; `formatDate(v)` → `false` |
| `hasComment(node, scope, re)` (closure in `create`) | `boolean` | window as above | see A |
| `hasNoChildren(scope)` (closure in `create`) | `boolean` | `true` only for a `className` attribute whose element has no children, or only whitespace text and comment-only containers (`{/* x */}`); `false` for any other scope, including `null` | `<div className="h-1 bg-[var(--brand)]" />` → `true`; `<button className="...">Go</button>` → `false` |

*C. `design-baseline.mjs` output.* JSON on stdout: `{ <messageId>: number, …, "total": number, "bySeverity": { "error": number, "warn": number } }`. A messageId with 0 hits is absent. `total` = `error` + `warn`. `error` counts hits the config reports at level 2, `warn` those at level 1; today `warn` is exactly the market exception. Expected after step 6, with the number from step 5 filled in: `{ "typeScale": 59, "deprecatedVar": 162, "hex": 3, "paletteClass": 6, "lengthTypeVar": 3, "fontWeight": 57, "figureMono": 3, "roundedFull": 2, "total": 295, "bySeverity": { "error": 0, "warn": 295 } }`. Arguments are globs (unchanged). It writes nothing.

*D. `tests/e2e/helpers/noPageScroll.ts`.*

| Function | Returns | Cases |
|---|---|---|
| `pageScrollProblems(size: PageSize)` | `string[]`, `[]` when the page fits | vertical when `scrollHeight > innerHeight` (no slack): `vertical: scrollHeight 721 > innerHeight 720`. Horizontal when `scrollWidth > clientWidth + 1` (1 px of sub-pixel slack): `horizontal: scrollWidth 1282 > clientWidth 1280`. Both → vertical first. Pure; no I/O. |
| `measurePage(page)` | `Promise<PageSize>` = `{ scrollHeight, innerHeight, scrollWidth, clientWidth }`, all CSS pixels | `scrollHeight` from `document.scrollingElement`, `scrollWidth`/`clientWidth` from `document.documentElement`; reads only |
| `expectNoPageScroll(page, where)` | `Promise<void>` | fails with message `<where>: the page must not scroll` and the problems array as the received value; passes when `[]` |

*E. `one-screen-no-scroll.spec.ts`.* Produces 1 guard test + 4 `pageScrollProblems` tests + one test per (viewport, route) = 2 × `ONE_SCREEN_ROUTES.length` (today 2 × 1). Side effects: opens each route in a Chromium page with its `DESIGN_SCREENS` mock; no writes. A route in `ONE_SCREEN_ROUTES` without a `DESIGN_SCREENS` entry fails the guard with `["<route>"]`.

*F. `paper-sweep.spec.ts`.* One test per `DESIGN_SCREENS` entry except `/`. `violations` is a sorted-by-first-seen, de-duplicated `string[]`; each item is `<tag>#<id>.<up to 3 classes> <property>: <computed value>`, e.g. `div.bg-red-50 background-color: rgb(254, 242, 242)`. The test passes only when the array is `[]`. HTML elements only: SVG and `.tv-lightweight-charts` are skipped (their colours go through attributes and `resolveCssColor`, which lint covers).

*G. `eslint.config.mjs`.* After the change, `moneyview/no-raw-design-values` is `error` for `app/`, `components/`, `lib/`, `hooks/` except `lib/tokens.generated.ts` (ignored), and `warn` for `components/market/**/*.{ts,tsx}` and `app/page.tsx`. The later block wins.

---

- [ ] **Step 1: Baseline and approval.** On `feat/design-system-paper` with `npm install` already done:
  1. `git status --short` shows no tracked change. Record the current `npm run design:baseline` output (expected total 233, all in `components/market/**`, `app/page.tsx` at 0) and `C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest -q` (the plan expected 1883) in Track D.
  2. Get the owner's approval of the inventory above.

- [ ] **Step 2: RED. Write the rule tests.** In `eslint-rules/__fixtures__/tokens.css` add, before `--old-alias`:

```css
  --brand: #fa3600;
  --brand-soft: #ffe6dc;
  --brand-text: #c42b00;
  --on-brand: #101010;
  --ink: #282828;
  --radius-2: 4px;
```

In `no-raw-design-values.test.mjs` line 17, delete ` rounded-full` from the first valid string, so it ends `rounded-[var(--radius-sm)] shadow-[var(--shadow-modal)]" />',`. Append to the end of the file:

```js
// Task 14a: radius, weight, brand and figure rules.
tester.run("no-raw-design-values (14a: radius, weight, brand, figures)", rule, {
  valid: [
    // rounded-full: an exemption comment on the previous line, or on the same line.
    'const a = (\n  <div>\n    {/* rounded-full: dot */}\n    <span className="h-2 w-2 rounded-full" />\n  </div>\n);',
    'const a = <span className="h-2 w-2 rounded-full" />; // rounded-full: track',
    'const a = (\n  <div>\n    {/* rounded-full: spinner */}\n    <span\n      aria-hidden\n      className="h-3 w-3 rounded-full"\n    />\n  </div>\n);',
    'const a = <div className="rounded-[var(--radius-2)] border" />;',
    'const note = "a rounded-full pill";',
    // font weight: a justification comment, or no weight class at all.
    'const a = <p>Total {/* M2: inline emphasis; the weight separates the label from the text */}<span className="font-semibold">x</span></p>;',
    'const a = (\n  <div>\n    {/* M2: snapshot title differs from the body style */}\n    <p className="font-bold">x</p>\n  </div>\n);',
    'const a = <p className="type-body font-mono font-normal">x</p>;',
    'const s = "font-bold is not allowed here";',
    // brand ground: with on-brand ink, with no children, in a pseudo-element, with a soft hover, in a tone table.
    'const a = <button className="bg-[var(--brand)] text-[var(--on-brand)]">Go</button>;',
    'const a = <button className={clsx("bg-[var(--brand)]", disabled && "opacity-50", "text-[var(--on-brand)]")}>Go</button>;',
    'const a = <div className="h-1 bg-[var(--brand)]" />;',
    'const a = <span className="w-1 bg-[var(--brand)]"></span>;',
    'const a = <a className="after:bg-[var(--brand)]">Tab</a>;',
    'const a = <a className="hover:bg-[var(--brand-soft)] text-[var(--ink)]">Go</a>;',
    'const TONE = { dot: "bg-[var(--brand)]" };',
    'const a = <Icon className="text-[var(--brand-text)]" />;',
    // figures: mono on the element or an ancestor; prose; components; an unreadable className; other attributes and formatters.
    'const a = <td className="type-mono">{formatNumber(v, "integer")}</td>;',
    'const a = <p className="type-figure-md">{formatNumber(v, "percent")}</p>;',
    'const a = <td className="type-mono"><span>{formatNumber(v)}</span></td>;',
    'const a = <p className="type-body">Total {formatNumber(v)} draws</p>;',
    'const a = <Cell>{formatNumber(v)}</Cell>;',
    'const a = <td className={cellClass}>{formatNumber(v)}</td>;',
    'const a = <td className="type-body">{formatDate(v)}</td>;',
    'const a = <Delta value={formatNumber(v)} />;',
  ],
  invalid: [
    { code: 'const a = <span className="h-2 w-2 rounded-full" />;', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = <span className="md:rounded-full" />;', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = clsx("p-2", ok && "rounded-full");', errors: [{ messageId: "roundedFull" }] },
    // The comment must name dot, track, fill or spinner, and sit within one line of the opening tag.
    { code: 'const a = (\n  <div>\n    {/* rounded-full: chip */}\n    <span className="rounded-full" />\n  </div>\n);', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = (\n  <div>\n    {/* rounded-full: a colour-key dot */}\n    <span className="rounded-full" />\n  </div>\n);', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = (\n  <div>\n    {/* rounded-full: dot */}\n\n    <span className="rounded-full" />\n  </div>\n);', errors: [{ messageId: "roundedFull" }] },
    { code: 'const a = <p className="font-bold">x</p>;', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = <p className="md:font-medium">x</p>;', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = clsx("p-2", ok && "font-black");', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = <p className="font-extrabold">x</p>;', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = (\n  <div>\n    {/* bold on purpose */}\n    <p className="font-bold">x</p>\n  </div>\n);', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = (\n  <div>\n    {/* M2: */}\n    <p className="font-bold">x</p>\n  </div>\n);', errors: [{ messageId: "fontWeight" }] },
    { code: 'const a = <button className="bg-[var(--brand)] text-[var(--ink)]">Go</button>;', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = <button className="bg-[var(--brand)]">Go</button>;', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = clsx("bg-[var(--brand)]", "px-2");', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = { className: "bg-[var(--brand)] px-2" };', errors: [{ messageId: "brandGround" }] },
    { code: 'const a = <button className="hover:bg-[var(--brand)]">Go</button>;', errors: [{ messageId: "brandHover" }] },
    { code: 'const a = <button className="bg-[var(--brand-soft)] hover:bg-[var(--brand)] text-[var(--ink)]">Go</button>;', errors: [{ messageId: "brandHover" }] },
    { code: 'const a = <button className="focus-visible:bg-[var(--brand)] text-[var(--on-brand)]">Go</button>;', errors: [{ messageId: "brandHover" }] },
    { code: 'const a = <Icon className="text-[var(--brand)]" />;', errors: [{ messageId: "brandText" }] },
    { code: 'const a = <a className="hover:text-[var(--brand)]">Go</a>;', errors: [{ messageId: "brandText" }] },
    { code: 'const c = "text-[var(--brand)]";', errors: [{ messageId: "brandText" }] },
    { code: 'const a = <td className="type-body tabular-nums">{formatNumber(v, "integer")}</td>;', errors: [{ messageId: "figureMono" }] },
    { code: 'const a = <span>{formatNumber(v)}</span>;', errors: [{ messageId: "figureMono" }] },
    { code: 'const a = <p className="type-body">{v >= 0 ? "+" : ""}{formatNumber(v)}</p>;', errors: [{ messageId: "figureMono" }] },
    { code: 'const a = <span className="type-small">{v == null ? "—" : formatNumber(v)}</span>;', errors: [{ messageId: "figureMono" }] },
  ],
});
```

Run `npm run test:unit`. Expected RED: the 26 `invalid` cases fail (`Should have 1 error but had 0`; the figure and `brandHover` ones too). The `valid` cases pass already, because nothing is flagged yet. They are guarded by the mutation matrix, not by this run.

- [ ] **Step 3: GREEN. Extend the rule** (`eslint-rules/no-raw-design-values.mjs`). Seven edits, each anchored on existing text.

(1) In `EVERYWHERE`, after the `lengthTypeVar` entry, add:

```js
  ["brandText", new RegExp(`${START}text-\\[var\\(--brand\\)\\](?:\\/\\d+)?${END}`)],
```

(2) After `const CLASS_HELPERS = …;` add:

```js
// Exemptions are comments on the same line as the element's opening tag, or the line before it.
//   rounded-full:  {/* rounded-full: dot */}   (dot, track, fill or spinner)
//   font weight:   {/* M2: why the weight differs from the type style */}
const ROUNDED_FULL_OK = /\brounded-full:\s*(?:dot|track|fill|spinner)\b/;
const WEIGHT_OK = /\bM2:\s*\S/;
const WEIGHT_CLASS = /^font-(?:medium|semibold|bold|extrabold|black)$/;
const HOVER_VARIANTS = new Set(["hover", "focus", "focus-visible", "active", "group-hover", "peer-hover"]);
const PSEUDO_VARIANTS = new Set(["before", "after"]);
const MONO_CLASS = /\btype-(?:mono|figure)/;
```

(3) Before `const rule = {` add the three helpers:

```js
const classTokens = (text) => text.split(/[\s"'\x60]+/).filter(Boolean);

/** "md:hover:bg-x" -> { variants: ["md", "hover"], base: "bg-x" }. A colon inside [...] is not a separator. */
function splitVariants(token) {
  const parts = token.split(/:(?![^[]*\])/);
  return { variants: parts.slice(0, -1), base: parts[parts.length - 1] };
}

/** The node whose source holds a literal's whole class list: the className attribute, else the outermost class helper call, className property or class-named declarator. */
function classScope(node) {
  let scope = null;
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "JSXAttribute") return p.name.name === "className" ? p : scope;
    if (p.type === "CallExpression" && p.callee.type === "Identifier" && CLASS_HELPERS.has(p.callee.name)) scope = p;
    else if (p.type === "Property" && (p.key.name === "className" || p.key.value === "className")) scope = p;
    else if (p.type === "VariableDeclarator") return /class(es)?$/i.test(p.id?.name ?? "") ? p : scope;
  }
  return scope;
}

/** True for a formatNumber(...) call, also inside ?:, &&, + and template literals. */
function formatsNumber(e) {
  switch (e?.type) {
    case "CallExpression": return e.callee.type === "Identifier" && e.callee.name === "formatNumber";
    case "ConditionalExpression": return formatsNumber(e.consequent) || formatsNumber(e.alternate);
    case "LogicalExpression": return formatsNumber(e.right);
    case "BinaryExpression": return formatsNumber(e.left) || formatsNumber(e.right);
    case "TemplateLiteral": return e.expressions.some(formatsNumber);
    default: return false;
  }
}
```

(4) In `meta.messages`, after `deprecatedVar`, add the six messages with the exact texts of contract A:

```js
      roundedFull: "rounded-full is for dots, tracks, fills and spinners. Mark one with a comment on the same or previous line, {/* rounded-full: dot */} (or track, fill, spinner), or use rounded-[var(--radius-2)] for a chip.",
      fontWeight: "A bold, semibold, medium or black weight overrides the type style. Delete it, or justify it in a comment on the same or previous line: {/* M2: <why> */}.",
      brandGround: "bg-[var(--brand)] behind text needs text-[var(--on-brand)] in the same className. A fill with no text is fine as an element without children.",
      brandHover: "A hover, focus or active ground is bg-[var(--brand-soft)], not the solid brand fill.",
      brandText: "Brand as text is --brand-text: text-[var(--brand-text)].",
      figureMono: "A figure needs type-mono (cell, row, inline) or type-figure-md / type-figure (KPI), on this element or an ancestor.",
```

(5) In `create`, after `const vars = tokenVars(…);` add:

```js
    const sourceCode = context.sourceCode;
    const comments = sourceCode.getAllComments();
    const hasComment = (node, scope, re) => {
      const opening = scope?.type === "JSXAttribute" && scope.parent?.type === "JSXOpeningElement" ? scope.parent : node;
      const from = opening.loc.start.line - 1;
      const to = node.loc.end.line;
      return comments.some((c) => c.loc.end.line >= from && c.loc.start.line <= to && re.test(c.value));
    };
    // An element with no children cannot hold text, so a brand fill on it (dot, bar, marker) needs no on-brand ink.
    const hasNoChildren = (scope) => {
      const element = scope?.type === "JSXAttribute" ? scope.parent?.parent : null;
      return element?.type === "JSXElement" && element.children.every((c) =>
        (c.type === "JSXText" && c.value.trim() === "") || (c.type === "JSXExpressionContainer" && c.expression.type === "JSXEmptyExpression"));
    };
    const checkClasses = (node, text) => {
      const scope = classScope(node);
      let rounded = false, weight = false, ground = false;
      for (const token of classTokens(text)) {
        const { variants, base } = splitVariants(token);
        if (base === "rounded-full") rounded = true;
        if (WEIGHT_CLASS.test(base)) weight = true;
        if (base === "bg-[var(--brand)]") {
          if (variants.some((v) => HOVER_VARIANTS.has(v))) context.report({ node, messageId: "brandHover" });
          else if (!variants.some((v) => PSEUDO_VARIANTS.has(v))) ground = true;
        }
      }
      if (rounded && !hasComment(node, scope, ROUNDED_FULL_OK)) context.report({ node, messageId: "roundedFull" });
      if (weight && !hasComment(node, scope, WEIGHT_OK)) context.report({ node, messageId: "fontWeight" });
      if (ground && !hasNoChildren(scope) && !(scope && sourceCode.getText(scope).includes("text-[var(--on-brand)]"))) {
        context.report({ node, messageId: "brandGround" });
      }
    };
```

(6) In `check`, inside the `if (inClassContext(node)) { … }` block, after the `CLASS_ONLY` loop, add `checkClasses(node, text);`.

(7) In the returned visitor, before the `'Property[key.name="fontSize"] > Literal'` entry, add:

```js
      // <td>{formatNumber(...)}</td>: an element whose only content is a figure must set it in mono.
      JSXExpressionContainer(node) {
        const element = node.parent;
        if (element.type !== "JSXElement" || !formatsNumber(node.expression)) return;
        const tag = element.openingElement.name;
        if (tag.type !== "JSXIdentifier" || !/^[a-z]/.test(tag.name)) return;
        const onlyExpressions = element.children.every((c) => (c.type === "JSXText" && c.value.trim() === "") || c.type === "JSXExpressionContainer");
        if (!onlyExpressions) return;
        for (let el = element; el; el = el.parent) {
          if (el.type !== "JSXElement") continue;
          const attr = el.openingElement.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === "className");
          if (!attr) continue;
          if (MONO_CLASS.test(sourceCode.getText(attr))) return;
          const e = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : null;
          const opaque = e && (e.type === "Identifier" || e.type === "MemberExpression" || (e.type === "CallExpression" && !(e.callee.type === "Identifier" && CLASS_HELPERS.has(e.callee.name))));
          if (opaque) return;
        }
        context.report({ node, messageId: "figureMono" });
      },
```

Run `npm run test:unit`. Expected: all pass.

**Why `figureMono` is a rule and not only a checklist item.** Measured 2026-10-15 over the app: 13 hits for the "element whose only content is a figure" form, 10 outside market, **none a false positive** (each is a cell, headline or slider value set without a mono style). Two forms stay out of reach of lint and are reviewer checklist items in `DESIGN.md` (step 9): a figure inside a sentence (`Total {formatNumber(v)} draws` needs its own `<span className="type-mono">`), and figures produced by the local `format*` helpers that M5 has not yet replaced (`formatCurrencyCompact`, `fmtMoney`, the `chartConfig` `fmt*`). So the rule narrows the gap and does not close it, and the checklist says so.

- [ ] **Step 4: Baseline script reports severity** (`scripts/design-baseline.mjs`). Replace the counting loop and the last line so the file reads:

```js
// Drift counts per category, from the lint rule itself so the baseline and the gate agree.
// bySeverity splits the same hits by the level eslint.config.mjs gives their file: "error" is
// everything the lock covers, "warn" is the market exception (DS Task 14b removes it).
import { ESLint } from "eslint";

const DEFAULT = ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"];
const patterns = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
const results = await new ESLint().lintFiles(patterns);
const counts = {};
const bySeverity = { error: 0, warn: 0 };
for (const result of results) {
  for (const message of result.messages) {
    if (message.ruleId !== "moneyview/no-raw-design-values") continue;
    counts[message.messageId] = (counts[message.messageId] ?? 0) + 1;
    bySeverity[message.severity === 2 ? "error" : "warn"] += 1;
  }
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(JSON.stringify({ ...counts, total, bySeverity }, null, 2));
```

Run `npm run design:baseline`. Expected now (config still `warn`): the old 233 plus the new categories, every hit under `warn`. Write the output in the commit message later.

- [ ] **Step 5: Error level, with the market exception.** In `eslint.config.mjs` replace the Task 1 block's comment and level, and add the override after it:

```js
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}"],
    ignores: ["lib/tokens.generated.ts"],
    plugins: { moneyview: { rules: { "no-raw-design-values": noRawDesignValues } } },
    rules: { "moneyview/no-raw-design-values": "error" },
  },
  // The market overview still renders the pre-paper classes and deprecated aliases. It is migrated by
  // its own one-screen plan, and DS Task 14b (docs/superpowers/plans/2026-10-12-design-system-formalization.md)
  // deletes this block so the rule is an error everywhere.
  {
    files: ["components/market/**/*.{ts,tsx}", "app/page.tsx"],
    rules: { "moneyview/no-raw-design-values": "warn" },
  },
```

Run `npm run lint`. Expected: **exactly 40 errors**, all `moneyview/no-raw-design-values`: `roundedFull` 27, `figureMono` 10, `fontWeight` 2, `brandText` 1. The warnings are the market's. If the error count differs, the repo moved since `370d254`: re-derive the table in step 6 before fixing anything. Run `npm run design:baseline` and **write the market count into Track D** (expected total 295 = the old 233 + `fontWeight` 57 + `figureMono` 3 + `roundedFull` 2, `bySeverity.warn` 295).

- [ ] **Step 6: Fix the 40 hits at their source.** Never silence one with `eslint-disable`. Line numbers are as of `370d254`.

*`roundedFull`, 27 hits.* 23 elements are dots, tracks, fills or spinners. Put `{/* rounded-full: <kind> */}` on the line directly above each (a comment covers one element, so a track and its fill get one each). Nine of them already have a free-text comment that the new syntax does not match; rewrite those:

| File:line | Kind | Note |
|---|---|---|
| `app/corporate/components/graphs/HurdleRateDecompositionGraph.tsx:59` | dot | rewrite comment at :58 to `{/* rounded-full: dot, a colour key in the legend. */}` |
| `app/dev/monitor/page.tsx:196` / `:198` | track / fill | rewrite the comment at :195 for the track; add one above the fill |
| `app/events/components/EventsTable.tsx:99` | dot | rewrite comment at :98 |
| `app/monte-carlo/components/MonteCarloRunPanel.tsx:58` / `:59` | track / fill | rewrite comment at :57 for the track; add one above the fill |
| `app/monte-carlo/components/shared.tsx:162` | dot | rewrite comment at :161 |
| `app/portfolio/components/StockDetailModal.tsx:468` / `:524` | dot | rewrite the inline `M3:` comments |
| `components/charts/EventFilter.tsx:40` / `:82` | dot / dot | :40 is the loading pulse |
| `components/charts/EventTooltip.tsx:26`, `HistogramPanel.tsx:107`, `OHLCVChartCard.tsx:123`, `PercentileBandPanel.tsx:104` | dot | |
| `components/data/TimelineList.tsx:45` | dot | |
| `components/ui/ActionButton.tsx:52` | spinner | |
| `components/ui/LoadingState.tsx:21` / `:37` / `:39` | spinner / track / fill | |
| `components/ui/MetricQualityBadge.tsx:27`, `components/ui/StatusBadge.tsx:63` | dot | |
| `components/workbenches/DCFWorkbench.tsx:170` | dot | the bouncing loader |

Four are not dots and change shape (M3):

| File:line | Element | Change |
|---|---|---|
| `components/charts/OHLCVChartCard.tsx:120` | legend chip | `rounded-full` → `rounded-[var(--radius-2)]` |
| `components/data/TimelineList.tsx:35` | date pill | `rounded-full` → `rounded-[var(--radius-2)]` |
| `components/workbenches/DCFWorkbench.tsx:159` | stale badge | `rounded-full` → `rounded-[var(--radius-2)]` |
| `components/ui/ErrorBoundary.tsx:60` | icon disc | delete `rounded-full` (square; it is not a dot, track or fill) |

*`figureMono`, 10 hits.* Add `type-mono` to the element (`type-figure-md` for the four headline figures in `PortfolioAttributionSummary.tsx`, which sit in `type-panel-title` today; check the capture): `app/cases/components/SimulateResults.tsx:54`, `app/portfolio/components/PortfolioAllocationEditor.tsx:120` (this span also has `font-semibold`, already justified), `PortfolioAttributionSummary.tsx:73,84,95,106`, `StockDetailModal.tsx:376`, `components/ui/Sliders.tsx:40,57,74`. Where the element had `tabular-nums`, delete it: the mono style carries it.

*`fontWeight`, 2 hits.* `components/ui/TopNav.tsx:131` and `:136`. `tests/e2e/sidebar-contrast.spec.ts` pins bold ink on the menu labels, so keep the weight and justify it with `{/* M2: menu labels are bold ink in every state; sidebar-contrast.spec.ts pins it. */}`. Confirm which of the two lines the spec reads and say so in each comment; if one is not pinned, delete its weight.

*`brandText`, 1 hit.* `components/providers/AppProvider.tsx:87`: `text-[var(--brand)]` → `text-[var(--brand-text)]`.

Then: `npm run lint` shows 0 errors, and `npm run design:baseline` shows `bySeverity.error` 0 and `bySeverity.warn` equal to the number written in step 5. Run the specs the edits can break (HARNESS test scope; `components/ui/**` is a shared surface, so step 14's full run is the check for it): `grep -l` the changed components and testids in `tests/e2e`, plus at least `components-paper.spec.ts`, `sidebar-contrast.spec.ts`, `responsive-accessibility.spec.ts`, `i18n.spec.ts`, `event*.spec.ts`, `candle-colour.spec.ts`, `portfolio-*.spec.ts`, `cases.spec.ts`, `monte-carlo-*.spec.ts`, `dev-monitor.spec.ts`, `decisions.spec.ts`, `corporate-*.spec.ts`, with `--workers=2`. List the specs run in the report.

- [ ] **Step 7: Commit the rules and their fixes.**

```bash
git add apps/web/eslint-rules apps/web/eslint.config.mjs apps/web/scripts/design-baseline.mjs apps/web/components apps/web/app
git commit -m "chore(design): rounded-full, font weight, brand ground, brand text and figure rules; error level outside market" -m "Market overview stays at warn (<N> hits recorded in Track D) until DS Task 14b." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Replace `<N>` with the recorded number before running.

- [ ] **Step 8: RED. The shared no-page-scroll test.** Create `tests/e2e/one-screen-no-scroll.spec.ts` first:

```ts
import { expect, test } from "@playwright/test";
import { ONE_SCREEN_ROUTES } from "../../components/ui/oneScreenRoutes";
import { DESIGN_SCREENS } from "./helpers/designScreens";
import { expectNoPageScroll, pageScrollProblems } from "./helpers/noPageScroll";

// HARNESS fixed rule: every page in ONE_SCREEN_ROUTES fits 1280x720 with no page scroll. Sideways is
// checked too, because both 390 px regressions of the corporate page (ERROR-LOG 2026-10-14) widened
// the page instead of lengthening it. A later one-screen page joins by adding its route to the list;
// its mock comes from DESIGN_SCREENS.
const SCREENS = new Map(DESIGN_SCREENS);
const VIEWPORTS = [{ width: 1280, height: 720 }, { width: 390, height: 844 }] as const;

test("every one-screen route has a mock in DESIGN_SCREENS", () => {
  expect(ONE_SCREEN_ROUTES.filter((route) => !SCREENS.has(route))).toEqual([]);
});

test.describe("pageScrollProblems", () => {
  const fits = { scrollHeight: 720, innerHeight: 720, scrollWidth: 1280, clientWidth: 1280 };

  test("a page that fits has no problems", () => {
    expect(pageScrollProblems(fits)).toEqual([]);
  });
  test("one pixel too tall is a vertical problem", () => {
    expect(pageScrollProblems({ ...fits, scrollHeight: 721 })).toEqual(["vertical: scrollHeight 721 > innerHeight 720"]);
  });
  test("one pixel of sideways slack is allowed, two is not", () => {
    expect(pageScrollProblems({ ...fits, scrollWidth: 1281 })).toEqual([]);
    expect(pageScrollProblems({ ...fits, scrollWidth: 1282 })).toEqual(["horizontal: scrollWidth 1282 > clientWidth 1280"]);
  });
  test("both axes are reported, vertical first", () => {
    expect(pageScrollProblems({ ...fits, scrollHeight: 900, scrollWidth: 1500 })).toEqual([
      "vertical: scrollHeight 900 > innerHeight 720",
      "horizontal: scrollWidth 1500 > clientWidth 1280",
    ]);
  });
});

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const route of ONE_SCREEN_ROUTES) {
      test(`${route} does not scroll the page`, async ({ page }) => {
        await SCREENS.get(route)!(page);
        await page.goto(route, { waitUntil: "networkidle" });
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
        await page.evaluate(() => document.fonts.ready);
        await expectNoPageScroll(page, route);
      });
    }
  });
}
```

Run `npx playwright test tests/e2e/one-screen-no-scroll.spec.ts --workers=2`. Expected RED: the file fails to load, `Cannot find module './helpers/noPageScroll'`.

- [ ] **Step 9: GREEN. The helper** (`tests/e2e/helpers/noPageScroll.ts`):

```ts
import { expect, type Page } from "@playwright/test";

export type PageSize = { scrollHeight: number; innerHeight: number; scrollWidth: number; clientWidth: number };

/** Why a page counts as scrolling, one string per axis; [] when it fits. Sideways gets 1 px of sub-pixel slack. */
export function pageScrollProblems(size: PageSize): string[] {
  const problems: string[] = [];
  if (size.scrollHeight > size.innerHeight) problems.push(`vertical: scrollHeight ${size.scrollHeight} > innerHeight ${size.innerHeight}`);
  if (size.scrollWidth > size.clientWidth + 1) problems.push(`horizontal: scrollWidth ${size.scrollWidth} > clientWidth ${size.clientWidth}`);
  return problems;
}

export function measurePage(page: Page): Promise<PageSize> {
  return page.evaluate(() => ({
    scrollHeight: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
}

export async function expectNoPageScroll(page: Page, where: string): Promise<void> {
  expect(await measurePage(page).then(pageScrollProblems), `${where}: the page must not scroll`).toEqual([]);
}
```

Run the spec again. Expected: 7 passed (1 guard, 4 unit, 2 corporate).

- [ ] **Step 10: The token-colour sweep, market excluded** (`tests/e2e/paper-sweep.spec.ts`). On every captured screen except the market overview, every computed colour of every HTML element must be a token value, and radii and shadows must follow the redesign.

```ts
import { expect, test } from "@playwright/test";
import { tokens } from "../../lib/tokens.generated";
import { DESIGN_SCREENS } from "./helpers/designScreens";

// The market overview still renders pre-paper classes. DS Task 14b deletes this exclusion.
const MARKET_ROUTE = "/";

/** Every colour token as the computed-style string Chrome reports. */
function allowedColours(): Set<string> {
  const out = new Set(["rgba(0, 0, 0, 0)"]);
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      const hex = /^#([0-9a-f]{6})$/i.exec(node);
      if (hex) out.add(`rgb(${[0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).join(", ")})`);
      const fn = /^rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)$/.exec(node);
      if (fn) out.add(`rgba(${fn[1]}, ${fn[2]}, ${fn[3]}, ${fn[4]})`);
    } else if (node && typeof node === "object") {
      Object.values(node).forEach(visit);
    }
  };
  visit(tokens);
  return out;
}

for (const [route, mock] of DESIGN_SCREENS.filter(([r]) => r !== MARKET_ROUTE)) {
  test(`${route}: only token colours, redesign radii, no shadows`, async ({ page }) => {
    await mock(page);
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    const allowed = [...allowedColours()];
    const violations = await page.evaluate((ok) => {
      const allowedSet = new Set(ok);
      const RADII = new Set(["0px", "2px", "4px"]);
      const label = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${[...el.classList].slice(0, 3).join(".")}`;
      const out: string[] = [];
      for (const el of document.querySelectorAll("body *")) {
        // SVG and canvas get chart colours through attributes and resolveCssColor (lint-checked);
        // lightweight-charts builds its own DOM.
        if (el.closest("svg, .tv-lightweight-charts")) continue;
        const s = getComputedStyle(el);
        if (s.display === "none") continue;
        const colours: [string, string][] = [["color", s.color], ["background-color", s.backgroundColor]];
        for (const side of ["top", "right", "bottom", "left"]) {
          if (parseFloat(s.getPropertyValue(`border-${side}-width`)) > 0) colours.push([`border-${side}-color`, s.getPropertyValue(`border-${side}-color`)]);
        }
        for (const [prop, value] of colours) if (!allowedSet.has(value)) out.push(`${label(el)} ${prop}: ${value}`);
        const radius = s.borderTopLeftRadius;
        if (!RADII.has(radius) && parseFloat(radius) < 999) out.push(`${label(el)} border-radius: ${radius}`);
        const visibleShadow = s.boxShadow !== "none" && s.boxShadow.split(/,(?![^(]*\))/).some((part) => !/rgba\(\d+, \d+, \d+, 0\)/.test(part));
        if (visibleShadow) out.push(`${label(el)} box-shadow: ${s.boxShadow}`);
      }
      return [...new Set(out)];
    }, allowed);
    expect(violations).toEqual([]);
  });
}
```

The old plan's fixed 600 ms sleep is gone: the wait is `networkidle`, a visible `main` and `document.fonts.ready`. (Colours in SVG are skipped, so recharts' 400 ms animation does not matter here.)

Run `npx playwright test tests/e2e/paper-sweep.spec.ts --workers=2`. Each violation names an element and a value. Fix it at its source by M1–M3, not in the test. (`rgba(0, 0, 0, 0)` is `transparent`. Tailwind's resting ring and shadow variables compose transparent shadows, which the shadow check ignores.) Expected after fixing: 7 screens pass.

**Escape hatch.** This sweep has not been run against the non-market app. If the first run lists more than 15 distinct violation strings, stop: write the list into Track D and ask the owner whether the sweep moves to 14b as a whole. Do not loosen the test and do not exempt a screen.

- [ ] **Step 11: Commit the tests.**

```bash
git add apps/web/tests/e2e/one-screen-no-scroll.spec.ts apps/web/tests/e2e/helpers/noPageScroll.ts apps/web/tests/e2e/paper-sweep.spec.ts
git commit -m "test(design): shared no-page-scroll check for one-screen routes; token-colour sweep outside market" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

If step 10 needed source fixes, add those files to this commit.

- [ ] **Step 12: `DESIGN.md`** (repo root)

```markdown
# MoneyView design rules

Source of truth: `apps/web/tokens/moneyview.tokens.json` (the paper theme of the 2026-10 redesign,
`docs/design/redesign-2026-10/`). Everything else is generated by `npm run tokens` (in apps/web)
and checked by `npm run lint`. Look at `/dev/design` in the running app for every component.
How work is done (stages, owner gates, test scope, model routing) is `guideline/HARNESS.md`; this
file does not repeat it.

## How to reference a value
| Kind | Write | Never |
|---|---|---|
| Colour | `bg-[var(--surface-raised)]`, `text-[var(--ink-muted)]`, `border-[var(--line)]` | hex, rgb(), `bg-red-50`, `text-white`, `/NN` opacity |
| Type | `type-heading-5`, `type-panel-title`, `type-body`, `type-label`, `type-small`, `type-figure`, `type-figure-md`, `type-mono`, `type-mono-link`, `type-caption` | `text-xs`, `text-[11px]`, extra `leading-*`/`tracking-*` |
| Weight | none: the `type-*` utility carries it. A different weight needs `{/* M2: why */}` on the same or previous line | `font-bold`, `font-semibold`, `font-medium`, `font-black` without that comment |
| Radius | none (square) for panels, tables, charts, modals; `rounded-[var(--radius-1)]` controls; `rounded-[var(--radius-2)]` tooltips, menus, chips, badges | `rounded`, `rounded-md` |
| Round shapes | `rounded-full` only on a dot, track, fill or spinner, marked `{/* rounded-full: dot */}` (or `track`, `fill`, `spinner`) on the same or previous line, one comment per element | `rounded-full` on a chip, badge, pill or avatar |
| Shadow | none; elevation is `border border-[var(--line)]` | any `shadow-*` |
| Focus | nothing: globals.css draws a 2px brand ring | `focus-visible:ring-*`, `outline-none` |
| Spacing | Tailwind's numeric scale (`p-6` = `--space-6` = 24px) | `p-[13px]` |
| Canvas / SVG attribute | `tokens.<path>` from `lib/tokens.generated.ts`; canvas colours via `resolveCssColor` | literals |
| Numbers | `formatNumber(value, kind, { locale })`, set in a mono style (`type-mono`, or `type-figure-md` / `type-figure` for headline figures) | `toFixed`, `toLocaleString` |
| Text | `t("namespace.key")`; Korean follows `docs/design/MoneyView_Glossary.md` | JSX string literals |
| Small labels | `<Eyebrow label>`, `<BilingualLabel k>`, `DenseTable` column `label` ("종목 NAME") | single-language headers |

## Fixed decisions
- Paper (light) theme only. There is no dark mode; the redesign's `void` theme is not carried.
- Korean market convention: up = `--up` red with ▲ and +, down = `--down` blue with ▼ and -,
  unchanged = `--flat` with ■. Never colour alone.
- Brand orange `--brand` is for fills (primary button, selection, focus ring, the subject chart
  series, the active nav marker), never for price changes. Text on a brand fill is `--on-brand`;
  brand as text is `--brand-text`; a hover, focus or active ground is `--brand-soft`.
- Fonts: Host Grotesk (Latin), Pretendard (Hangul), Geist Mono (figures); all SIL OFL 1.1.
- Charts: `--chart-1` is the subject series; at most five series (`--chart-1…5`), a sixth
  category folds into "Other" in `--chart-4`; fills at `--chart-area-opacity`; heatmaps use
  `--chart-heat-1…7` (down → neutral → up).
- Landing-only type styles (`display`, `heading-1…4`, `body-lg`) exist as tokens without
  utilities until a landing page is built.
- Every page in `ONE_SCREEN_ROUTES` (`apps/web/components/ui/oneScreenRoutes.ts`) fits 1280x720 and
  390x844 with no page scroll, vertical or sideways; overflow belongs to a panel. A page joins by
  adding its route to the list, which `tests/e2e/one-screen-no-scroll.spec.ts` then covers.
- Known exception, until the market one-screen plan lands: `components/market/**` and `app/page.tsx`
  still hold pre-paper classes and deprecated aliases. The lint rule is `warn` there and `error`
  everywhere else, and `tests/e2e/paper-sweep.spec.ts` skips the `/` route.

## What `npm run lint` checks (rule `moneyview/no-raw-design-values`)
| Message | Means | Fix |
|---|---|---|
| `hex`, `colorFn`, `paletteClass` | a raw colour | a colour token |
| `typeScale`, `arbitraryPx`, `lengthTypeVar`, `numericFontSize` | a raw type size | a `type-*` utility, or `tokens.type.<style>._` |
| `rawShadow`, `rawRadius` | a Tailwind shadow or radius | see the table above |
| `unknownVar`, `deprecatedVar` | a `var(--x)` that is undefined or an alias | the token the message names |
| `roundedFull` | `rounded-full` with no `rounded-full: dot\|track\|fill\|spinner` comment | mark it, or use `rounded-[var(--radius-2)]` |
| `fontWeight` | a bold, semibold, medium, extrabold or black class with no `M2: reason` comment | delete it, or justify it |
| `brandGround` | `bg-[var(--brand)]` behind text without `text-[var(--on-brand)]` in the same className (an element with no children is a fill and passes) | add the ink, or use a soft ground |
| `brandHover` | `hover:` / `focus:` / `active:` on `bg-[var(--brand)]` | `bg-[var(--brand-soft)]` |
| `brandText` | `text-[var(--brand)]` | `text-[var(--brand-text)]` |
| `figureMono` | an element whose only content is `{formatNumber(…)}` with no `type-mono` / `type-figure*` on it or an ancestor | add the mono style |

## What review checks (lint cannot)
- A figure inside a sentence (`Total {formatNumber(v)} draws`) is wrapped in `<span className="type-mono">`.
- Figures from a local `format*` helper that M5 has not replaced are set in mono too.
- An exemption comment tells the truth: the element really is a dot, track, fill or spinner, and the weight really differs from the style.
- A brand fill with no children is really a marker, not a button whose label sits in a sibling.
- The `hasNoChildren` and "ink anywhere in the className" leniencies of `brandGround` are not used to hide ink that is not on the ground (a `hover:text-[var(--on-brand)]` does not count as ink).

## Adding a value
If no token fits, add one to the token file first: a primitive under `palette`, the meaning in a
semantic group. Run `npm run tokens`, then use it. Do not add a synonym for an existing meaning.
```

- [ ] **Step 13: `.claude/CLAUDE.md`.** Append (§9 is the Work Harness, so this is §10):

```markdown
## 10. Design Tokens

**Colours, type, radius and component sizes come only from `apps/web/tokens/moneyview.tokens.json`.**
Read `DESIGN.md` before writing UI. If a screen needs a value with no token, propose the token
first; do not write the value into code. `npm run lint` rejects raw values, undefined and deprecated
`var()` references, `rounded-full` outside dots, tracks and fills, unjustified bold weights, brand
fills without on-brand ink, and figures without a mono style. Every page in `ONE_SCREEN_ROUTES` fits
1280x720 with no page scroll. How a task is run (stages, owner gates, test scope) is
`guideline/HARNESS.md`; do not restate it here.
```

- [ ] **Step 14: Docs.**
- `docs/INDEX.md`: add rows, if missing, for this plan, the spec, `docs/design/redesign-2026-10/`, `docs/design/MoneyView_Glossary.md` and `DESIGN.md`.
- `docs/design/MoneyView_Design_Tokens.md`: replace the prose above the generated table with two sentences. The values are the paper redesign and are generated from the token file. There is no dark mode.
- `MoneyView_Component_System.md` and `MoneyView_Chart_System.md`: add a first line after the title: `> Values and component looks are superseded by DESIGN.md and /dev/design (2026-10 paper redesign).`
- `guideline/sop/todo.md`, Track D: replace `- [ ] D14 lock-down` with `- [ ] D14a lock-down outside market  - [ ] D14b aliases and market override removed (after the market one-screen plan)`. Tick the two "DS Task 14 lint/test rules" and "shared rule and automated no page scroll check" follow-ups, and record the market count from step 5 and the review verdicts from step 16.

- [ ] **Step 15: Claude Design System (owner, in claude.ai).** The redesign was made in Claude Design. Update that project's design system from `DESIGN.md` and the generated token table: paper only, with the 10 app type styles. Record the date in Track D.

- [ ] **Step 16: Mutation matrix.** For every row: back the file up outside the repo, apply the mutation, run the named command, confirm it fails for the stated reason, restore the original bytes and prove it with `cmp` (HARNESS fixed rule: no git restore, no stash).

```bash
MUT=$(mktemp -d)                    # outside the repo
cp <file> "$MUT/orig"               # before the mutation
# ... mutate <file> ...
cp "$MUT/orig" <file> && cmp "$MUT/orig" <file> && echo restored
```

*Rule mutations* (edit `eslint-rules/no-raw-design-values.mjs`; run `npm run test:unit`; all 18 were run on 2026-10-15 against a scratch copy and each failed the case named):

| Mutation | Must fail |
|---|---|
| remove `track` from `ROUNDED_FULL_OK` | valid `… rounded-full" />; // rounded-full: track` |
| remove `spinner` from `ROUNDED_FULL_OK` | valid `{/* rounded-full: spinner */}` |
| `const from = opening.loc.start.line - 1` → `- 2` | invalid "`rounded-full: dot` then a blank line" (comment now reaches too far) |
| same line → `const from = opening.loc.start.line` | valid previous-line `rounded-full: dot` |
| `WEIGHT_OK` → `/\bM2:/` | invalid `{/* M2: */}` (empty reason accepted) |
| remove `black` from `WEIGHT_CLASS` | invalid `clsx("p-2", ok && "font-black")` |
| remove `medium` from `WEIGHT_CLASS` | invalid `md:font-medium` |
| `hasNoChildren` returns `false` | valid `<div className="h-1 bg-[var(--brand)]" />` and the `<span …></span>` case |
| the `HOVER_VARIANTS` branch never reports | invalid `hover:bg-[var(--brand)]` (three cases) |
| remove `focus-visible` from `HOVER_VARIANTS` | invalid `focus-visible:bg-[var(--brand)] …` |
| `!variants.some((v) => PSEUDO_VARIANTS.has(v))` → `true` | valid `after:bg-[var(--brand)]` |
| `sourceCode.getText(scope).includes(` → `text.includes(` | valid `clsx("bg-[var(--brand)]", …, "text-[var(--on-brand)]")` (ink in a sibling literal) |
| change `text-` to `texx-` in the `brandText` regex | invalid `text-[var(--brand)]` (three cases) |
| remove `if (!onlyExpressions) return;` | valid `Total {formatNumber(v)} draws` |
| the ancestor loop stops at the element itself | valid `<td className="type-mono"><span>{formatNumber(v)}</span></td>` |
| remove `if (opaque) return;` | valid `<td className={cellClass}>{formatNumber(v)}</td>` |
| remove the lowercase-tag check | valid `<Cell>{formatNumber(v)}</Cell>` |
| remove the `ConditionalExpression` case of `formatsNumber` | invalid `v == null ? "—" : formatNumber(v)` |

*Repo mutations* (one at a time; revert before the next):

| Mutation | Must fail |
|---|---|
| add `rounded-full` to the badge at `app/news/components/NewsFeedList.tsx:95` | `npm run lint`: `roundedFull` error |
| add `font-bold` to the primary class in `components/ui/ActionButton.tsx` | `npm run lint`: `fontWeight` error |
| in `NewsFeedList.tsx:95` change `bg-[var(--brand-soft)]` to `bg-[var(--brand)]` (its text is `--brand-text`) | `npm run lint`: `brandGround` error |
| in the same badge change `text-[var(--brand-text)]` to `text-[var(--brand)]` | `npm run lint`: `brandText` error |
| delete `type-mono` from `app/cases/components/SimulateResults.tsx:54` | `npm run lint`: `figureMono` error |
| delete the market override block in `eslint.config.mjs` | `npm run lint`: errors in `components/market/MarketOverviewClient.tsx` |
| add `font-bold` to `NewsFeedList.tsx:95` **and** change the main block to `"warn"` | `npm run lint` passes, but `npm run design:baseline` shows `bySeverity.warn` one above the recorded market count: the exact-count gate catches it |
| in `app/corporate/page.tsx:902` replace `h-[calc(100dvh_-_var(--main-pad-top,0px)_-_var(--main-pad-bottom,0px))]` with `h-[1400px]` | `one-screen-no-scroll.spec.ts`: `/corporate does not scroll the page` at both viewports, with a `vertical:` problem |
| on the same element add `min-w-[1500px]` | the same test, with a `horizontal:` problem |
| `ONE_SCREEN_ROUTES = ["/corporate", "/news"]` | the guard test, received `["/news"]` |
| in `pageScrollProblems` change `>` to `>=` on the vertical check | `a page that fits has no problems` |
| in `pageScrollProblems` change `+ 1` to `+ 2` | `one pixel of sideways slack is allowed, two is not` |
| add `shadow-[0_1px_2px_black]` to `Card` | `paper-sweep.spec.ts` on every screen with a card (`box-shadow`); lint is silent here, which is why the sweep exists |
| `Card` gets `rounded-[6px]` | `paper-sweep.spec.ts` (`border-radius: 6px`) |
| add `className="bg-red-50"` to any non-market component | `npm run lint` with `paletteClass` as an error |

- [ ] **Step 17: Final gate for 14a** (HARNESS: full suite at the end of a plan stage). One Playwright run at a time: first check `netstat -ano | grep -E ":(3101|8110) "` shows nothing listening; if it does, `taskkill //PID <pid> //T //F` that process tree.

```bash
cd apps/web && npm run tokens:check && npm run test:unit && npm run typecheck && npm run lint && npm run design:baseline && npx playwright test --workers=2
cd ../.. && C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest -q
```

Expected:
- `npm run lint`: 0 errors (warnings are the market's)
- `design:baseline`: `bySeverity.error` 0, and `bySeverity.warn` exactly the market count recorded in step 5 (expected 295). Cross-check: `npm run design:baseline -- "components/market/**/*.{ts,tsx}" "app/page.tsx"` prints the same `total`.
- Playwright: all passing, at the last full count plus 14 new tests (7 in `one-screen-no-scroll`, 7 in `paper-sweep`); the last recorded full run was 469 passed, 8 skipped (Task 11)
- pytest: the number recorded in step 1

Then run the `guideline/sop/code-reviewer.md` checklist over the 14a diff. Run `DESIGN_CAPTURE=after-14a npx playwright test tests/e2e/design-capture.spec.ts`, then `node scripts/capture-review.mjs <Task 13 label from Track D> after-14a`, and give the owner the review page. The four changed shapes (chip, pill, badge, icon disc) are what to look at. Record verdicts in Track D.

- [ ] **Step 18: Commit the documents.**

```bash
git add DESIGN.md .claude/CLAUDE.md docs guideline/sop/todo.md
git commit -m "docs(design): DESIGN.md, CLAUDE.md section 10 and Track D for the 14a lock-down" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14b: Aliases removed, market override removed, final gate

> **Start only after the market one-screen plan has merged into `feat/design-system-paper`** (owner, 2026-10-15). 14b changes nothing the market plan does not already allow: its first step proves that.

> **2026-10-16:** that plan is `docs/superpowers/plans/2026-10-16-market-one-screen.md`. Its Task 7 records `design:baseline` warn 0 and `ONE_SCREEN_ROUTES` containing `"/"`, which are this task's preconditions 1–3. It does not touch `paper-sweep.spec.ts`; step 5 here still removes the `/` exclusion and fixes any computed-style violation it finds in the market files.

**Files:**
- Modify: `eslint.config.mjs`; `tokens/moneyview.tokens.json` (deprecated tokens removed, root `moneyview.themeReset`); regenerate
- Modify: `components/ui/DenseTable.tsx` (`label` required, `header` removed), `scripts/build-tokens.test.mjs` (legacy test removed), `tests/e2e/paper-sweep.spec.ts` (market exclusion removed), `DESIGN.md`, `guideline/sop/todo.md`; Delete: `scripts/__fixtures__/globals-root-vars.baseline.json`
- Create: `tests/e2e/theme-reset.spec.ts`
- Modify, conditional (step 7): `eslint.config.mjs`, `lib/i18n/messages/*`

**Output contracts:**
- `theme-reset.spec.ts`: one test per utility kept outside the theme. Each returns pass when the element's computed style equals the stated value (`rounded-full` → `border-top-left-radius` parsed ≥ 999 px; `bg-transparent` → `rgba(0, 0, 0, 0)`; any other utility found by step 4's grep, with the value the grep shows it needs). Side effects: none; the pages open with their existing mock helpers.
- The alias prune script (step 3) rewrites `tokens/moneyview.tokens.json` in place: every token with `$deprecated` is deleted, and any group left with no token is deleted. Exit code 0 always; `npm run tokens:check` is the real check.
- `ColumnDef` in `DenseTable.tsx`: `{ label: LabelKey; … }` with no `header`. A caller that still passes `header` is a `typecheck` error.

- [ ] **Step 1: Preconditions.** All must hold, or stop:
  1. `git log --oneline` on the branch contains the market plan's final commit, and `ONE_SCREEN_ROUTES` contains `"/"` if that plan made the market a one-screen page.
  2. With the override still in place, `npm run design:baseline -- "components/market/**/*.{ts,tsx}" "app/page.tsx"` prints `total` 0. (If not, the market plan is not finished: removing the override would turn those hits into lint errors.)
  3. `npm run design:baseline` prints `bySeverity.warn` 0 and `bySeverity.error` 0, with `deprecatedVar` absent.

- [ ] **Step 2: Remove the market override.** In `eslint.config.mjs`, delete the whole second block (the `// The market overview still renders …` comment and the `components/market/**` / `app/page.tsx` block). Run `npm run lint`. Expected: 0 errors. Any error is a real hit the market plan missed: fix it in the market files, do not restore the block.

- [ ] **Step 3: Remove the deprecated aliases.** `design:baseline` must report `deprecatedVar` 0 before this step (step 1 proves it).

```bash
node -e '
const fs = require("fs"); const f = "tokens/moneyview.tokens.json";
const tree = JSON.parse(fs.readFileSync(f, "utf8"));
const prune = (node) => {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("$") || v === null || typeof v !== "object") continue;
    if ("$value" in v) { if (v.$deprecated) delete node[k]; }
    else { prune(v); if (!Object.keys(v).some((x) => !x.startsWith("$"))) delete node[k]; }
  }
};
prune(tree);
fs.writeFileSync(f, JSON.stringify(tree, null, 2) + "\n");'
git rm apps/web/scripts/__fixtures__/globals-root-vars.baseline.json
```

In `scripts/build-tokens.test.mjs`, delete the test `every pre-migration variable still resolves until Task 14 removes the aliases`; its fixture is gone. In `DenseTable.tsx`'s `ColumnDef`, delete `header` and make `label: LabelKey` required. Change the header cell to `<BilingualLabel k={col.label} />`. `typecheck` must pass: every caller migrated in Tasks 9–13 and the market plan (M7). Run `npm run tokens`, then `npm run tokens:check`.

- [ ] **Step 4: Remove Tailwind's defaults**, so a raw class has no effect even if lint is skipped. Add to the token file root:

```json
"$extensions": { "moneyview.themeReset": ["--color-*", "--text-*", "--shadow-*", "--radius-*"] }
```

Run `npm run tokens`. Then prove that the utilities kept outside the theme still work:
1. Find their uses with `git grep -nE "\b(bg|text|border)-(transparent|current|inherit)\b|rounded-full" -- app components`.
2. In `tests/e2e/theme-reset.spec.ts`, open `/dev/design` plus one page per utility found (with its existing mock helper). Assert with `page.evaluate` the computed style of one element using each utility: `rounded-full` gives a border radius of at least 999 px, and `bg-transparent` gives `rgba(0, 0, 0, 0)`.
3. If an assertion fails, map that utility's theme variable back through a token with `moneyview.theme`.

- [ ] **Step 5: Sweep the market too.** In `tests/e2e/paper-sweep.spec.ts` delete `const MARKET_ROUTE = "/";` and its comment, and change the loop to `for (const [route, mock] of DESIGN_SCREENS) {`. Run `npx playwright test tests/e2e/paper-sweep.spec.ts --workers=2`: 8 screens. Fix each violation at its source (M1–M3), in the market files.

- [ ] **Step 6: Remove every market exception.** Each of these must be gone, and the grep must show nothing:

```bash
git grep -n -i "market" -- apps/web/eslint.config.mjs apps/web/tests/e2e/paper-sweep.spec.ts DESIGN.md
```

Edit `DESIGN.md` to delete the "Known exception" bullet, and Track D to close the market notes. `design-baseline.mjs` keeps its `bySeverity` output; from now on `warn` is always 0.

- [ ] **Step 7: i18n lock, conditional.** Run the check below. If the count is 0, add the rules to the same `eslint.config.mjs` block as `error`. If it is not 0, do not add them: leave this step open in Track D and list the count by file. The M6 leftovers of Tasks 9–12 (option A) are separate work and must not block 14b. Measured 2026-10-15 outside market: 416 and 118 hits in 59 files.

```bash
npx eslint --rule '{"react/jsx-no-literals":["error",{"noStrings":true,"ignoreProps":true,"allowedStrings":["—","·","/","%","(",")",":","×","▲","▼","■","→","…","|","+","-"]}]}' app components lib hooks
```

When it is 0, add to the block:

```js
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true,
        allowedStrings: ["—", "·", "/", "%", "(", ")", ":", "×", "▲", "▼", "■", "→", "…", "|", "+", "-"] }],
      "no-restricted-syntax": ["error", {
        selector: "JSXAttribute[name.name=/^(aria-label|title|placeholder|alt)$/] > Literal[value=/[A-Za-z가-힣]/]",
        message: "User-visible attribute text belongs in lib/i18n/messages.",
      }],
```

`LanguageToggle` reads its labels from a constant, and `BilingualLabel` from `LABELS`, so `jsx-no-literals` does not flag them.

- [ ] **Step 8: Docs.** In `DESIGN.md` the `unknownVar, deprecatedVar` row now reads `unknownVar` only (the aliases are gone), and "Adding a value" stays. In `guideline/sop/todo.md` tick D14b.

- [ ] **Step 9: Mutation matrix of the lock** (same backup-and-`cmp` protocol as 14a step 16):

| Mutation | Must fail |
|---|---|
| add `className="bg-red-50"` to `components/market/MarketOverviewClient.tsx` | `npm run lint` with `paletteClass` (proves the override is gone) |
| add `className="bg-[var(--text-primary)]"` to any component (alias now deleted) | `npm run lint` with `unknownVar` |
| add `<p>Hello</p>` to any component (only if step 7 added the rule) | `npm run lint` with `react/jsx-no-literals` |
| add `shadow-[0_1px_2px_black]` to a market card | `paper-sweep.spec.ts` on `/` (`box-shadow`) |
| `Card` gets `rounded-[6px]` | `paper-sweep.spec.ts` (`border-radius: 6px`) |
| remove `"--radius-*"` from `themeReset` and add `rounded-md` to a card | `paper-sweep.spec.ts` (with the reset in place, `rounded-md` has no effect) |
| in `theme-reset.spec.ts` change the `rounded-full` bound from `999` to `100000`, and the `bg-transparent` expectation to `rgb(0, 0, 0)` | `theme-reset.spec.ts` fails on both (the assertions read the computed style; a test that stays green here proves nothing) |
Remove each mutation.

- [ ] **Step 10: Final gate** over the whole app:

```bash
cd apps/web && npm run tokens:check && npm run test:unit && npm run typecheck && npm run lint && npm run design:baseline && npx playwright test --workers=2
cd ../.. && C:/Users/eajwa/anaconda3/envs/moneyview/python.exe -m pytest -q
```

Expected:
- `design:baseline`: `total` 0, `bySeverity` `{ "error": 0, "warn": 0 }`; lint 0 errors and no `moneyview/no-raw-design-values` warning anywhere
- Playwright: all passing, at the 14a count plus the new specs (`theme-reset`, the extra sweep screen, and any no-scroll test the market route adds)
- pytest: unchanged from 14a step 1

Then run the `guideline/sop/code-reviewer.md` checklist over the whole branch. Run `DESIGN_CAPTURE=final npx playwright test tests/e2e/design-capture.spec.ts` and `node scripts/capture-review.mjs before final`, and give the owner the review page. Fill the baseline table's "after" column in the spec appendix.

- [ ] **Step 11: Commit**

```bash
git add apps/web/eslint.config.mjs apps/web/tokens apps/web/app/tokens.generated.css apps/web/lib/tokens.generated.ts apps/web/components/ui/DenseTable.tsx apps/web/scripts apps/web/tests/e2e/theme-reset.spec.ts apps/web/tests/e2e/paper-sweep.spec.ts DESIGN.md docs guideline/sop/todo.md
git commit -m "chore(design): remove legacy aliases and the market exception; theme reset; sweep every screen for token colours" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Follow-ups (not in this plan)

- **Landing page** (decision 3): build `Main.dc.html` as a route. That includes the hero, the risk-appetite (fear/greed) panel, the market pulse, foreign-flow and macro-regime sections, `mv-ticker` and `mv-live-dot`. Its sample data is illustrative and needs real sources before it shows numbers. Adding `moneyview.utility` to `display`, `heading-1…4` and `body-lg` gives it its type.
- **Brand review before any public release** (provenance note): the palette and type scale derive from heronaiapp.com.
- Dark mode, if ever wanted: the redesign's `void` values are in `docs/design/redesign-2026-10/ds/moneyview/tokens.json`. The semantic tier would take a second value set.
- A sequential palette (spec), when a chart needs one.
- A Dembrandt URL-based drift check (old D10).
- A density (compact) mode: the spec asked, and it is undecided. The `component.*` tokens make it a token switch.
- Corporate residue of the paper migration (from `2026-10-14-corporate-one-screen.md`, N9): M5 (`moneyText`/`pct`/`numberText` → `formatNumber`) across `app/corporate/**`; the English prose in `buildCalculationDetails.ts` → `corporate.*` catalog keys; bilingual headers for the comparison, batch-report, sensitivity-grid and DCF-report tables, which need their own approved test-change list (they are pinned by XPath/`columnheader` assertions).


## Self-review (2026-10-13)

**Spec coverage.**

| Spec stage | Covered by |
|---|---|
| 0, diagnosis and baseline | Task 1 |
| 1, reference | Replaced by the redesign (R16) |
| 2, three tiers | `palette` → semantic → `component` (Task 5) |
| 2, gain/loss | `up`/`down` (R7) |
| 2, number notation | Task 6 |
| 2, chart palette and band | R6, R19, R20 |
| 2, contrast | Task 5 test |
| 3, build pipeline | Tasks 2, 5 |
| 3, local fonts | Task 4 |
| 3, format function | Task 6 |
| 4, Claude Design System, DESIGN.md, CLAUDE.md | Task 14 |
| 4, Dembrandt MCP | Follow-up |
| 5, screen migration and Recharts colours | Tasks 8–13 |
| 6, Korean copy | Task 7 and M6, glossary first, 합니다체 binding |
| 7, drift prevention | Lint error (Task 14) and the sweep test |

Additions table:
- density: follow-up
- accessibility: ▲▼■ with sign, 4.5:1 test, single focus ring, screen-reader direction words
- dark mode: dropped by the owner

**Owner decisions coverage:**
- paper only: Task 5 void test
- bilingual labels plus toggle: Task 7, M7
- landing out: Follow-ups
- OFL fonts: Task 4 licence check
- 합니다체: glossary
- Heron note: decisions section and README notes

**Placeholder scan.** No "TBD", "similar to Task N" or "add appropriate". Four steps act on the actual content of files that were not opened while writing this plan. Each names the file, the line and the exact replacement:
- the mock-helper arguments (Task 1)
- the `ModalShell`/`Sidebar`/`StatusBadge` class strings, mapped by element (Task 8)
- the volatile-capture masks (Task 1, conditional)
- the per-screen M1–M7 edits

**Name consistency across tasks:**
- `--brand` (Task 3 rename, Task 5 value)
- `type.small` (Task 3 rename, Task 5 style)
- `type-*` utilities (Task 5 list = Task 8 use = M2 = DESIGN.md = test `APP`, 10 entries)
- `DESIGN_SCREENS` (Task 1, used by Tasks 8 and 14)
- `fieldInputClass` (Task 8, M3, Task 9)
- `LABELS` keys `market`, `name`, `price` (Task 7) and `change`, `case`, `devRuntime`, `monteCarlo` (Task 8), `verdict` (Task 11)
- `component.*` tokens (Task 5 file = Task 8 classes)
- `PATHS.redesign` (Task 5)
- capture labels: `before` → `after-tokens` → `after-rename` → `after-font` → `after-paper` → `after-components` → task ids → `final`

**Checked against the repo on 2026-10-13:**
- Font package names and file paths (`npm pack`).
- Contrast and OKLab distances of every paper colour.
- Zero references to `--space-5…8`.
- The `--bg-muted` defect.
- The JS `1024` breakpoints.
- Every test viewport width.
- `PageHeader` eyebrow callers.

**Not checked:**
- How `next/font/local` names its families. Task 4 step 5 handles it.
- Whether Tailwind 4 accepts `@utility` from an `@import`ed file. If `npm run tokens` followed by the build rejects it, emit the utilities into `globals.css` between generated markers, using the same `spliceDoc` mechanism.
