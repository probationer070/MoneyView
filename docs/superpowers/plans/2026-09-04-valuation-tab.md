# The Valuation Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `/valuation` — a page showing the four-row evidence panel for one ticker, each row carrying its own value, its own basis, and its full source sentence.

**Architecture:** One App Router client route owning two React Query calls (the panel, and the watchlist used only for ticker suggestions). A pure formatting module gives each row its own formatter, because the four rows are in four different units. The panel component renders computed and refused rows through the same path, since refusal is the majority state rather than a fallback.

**Tech Stack:** Next.js 16.2.2 (App Router), React 19.2.4, `@tanstack/react-query` 5, `lucide-react`, Playwright 1.59.

**Spec:** `docs/superpowers/specs/2026-09-04-valuation-tab-design.md`

---

## Global Constraints

- **Next.js 16.2.2 is NOT the Next.js in your training data.** `apps/web/AGENTS.md` requires reading the relevant guide under `apps/web/node_modules/next/dist/docs/01-app/` before writing route code.
- **There is no shared value formatter.** The four rows are in four different units (§4 of the spec). One formatter applied to all of them renders `volume`'s `1.1951` as `119.5%`, which states something false.
- **A refused row is content, not an error state.** It renders its `reason` as ordinary text. Never `0`, never a dash styled as a value, never an error colour, never hidden.
- **`source` is always visible, in full, on every row** — including refused ones. It is never behind a click or a hover. The number without its basis is what the panel exists to avoid presenting.
- **`comparison` is rendered verbatim.** It arrives pre-formatted from the backend (`"peer mean -12.9%"`) and is that layer's own attribution wording. Never reformat, re-round, or recompute it.
- **Invent no rollup.** No verdict badge, no score, no count of "good" signals, no colour-coding by favourability, no sorting rows by magnitude. `direction` is a fixed constant string identical for every ticker; the backend deliberately computes no verdict, and the UI must not compute one over four incommensurable units.
- **`dcf_gap` is horizonless.** It is `(intrinsic - price) / price`, a total gap with no time period. Never combine it with, subtract it from, or rank it against anything carrying a horizon.
- **Only Playwright** (`npm.cmd run test:e2e`). There is no vitest/jest in `apps/web`. **Do not add one.**
- **`npx.cmd tsc --noEmit` is a required gate.** `eslint-config-next` does not typecheck and the Playwright harness runs Next in dev mode, so type regressions are otherwise invisible.
- **Keep `text-[var(--x)]` Tailwind bracket syntax.** An IDE extension suggests `text-(--x)`; every existing component uses brackets and there is no Tailwind ESLint rule.
- Path alias is `@/` → `apps/web/`. Use `npm.cmd` if PowerShell blocks `npm`.

### The API contract, captured live

A real `GET /api/v1/valuation/verdict/AEP` on 2026-09-04. `fetchApi` unwraps the envelope, so `fetchApi<VerdictPanel>("/valuation/verdict/AEP")` returns the `data` object.

```json
{
  "ticker": "AEP",
  "direction": "Testing UNDERVALUATION. Each row states the basis it was compared against, and those bases differ: …",
  "rows": {
    "drawdown":    { "value": -0.09395437797260045, "comparison": "peer mean -12.9%", "source": "own window: last 252 of 2513 bars; peers: 8 of 8 within 2025-09-04..2026-09-03", "reason": null },
    "volume":      { "value": 1.1951446405779511,  "comparison": null, "source": "own bars: 90/252 bars", "reason": null },
    "trailing_pe": { "value": null, "comparison": null, "source": "Damodaran", "reason": "no_vintage: no industry benchmark data has been loaded" },
    "dcf_gap":     { "value": null, "comparison": null, "source": "conservative case", "reason": "no_vintage: no industry benchmark data has been loaded" }
  }
}
```

**`source` is present on refused rows too** — a refused `trailing_pe` still reports `"Damodaran"`, naming where the figure would have come from.

### The watchlist endpoint — two gotchas, both measured

`GET /api/v1/portfolio/watchlist` returns a **bare JSON array, not the `{status, data}` envelope**. `fetchApi` handles this already: it unwraps `.data` only when the payload is an object carrying that key, and returns the payload otherwise. So `fetchApi<WatchlistItem[]>("/portfolio/watchlist")` is correct.

It also takes **2–3.5 seconds**, because it fetches a live quote per ticker (and logs a 404 for `PSTG` on every call — that symbol is stale). **The panel must never wait on it.** Suggestions are a convenience that arrives late; typing a ticker and reading its panel must work from the first paint.

### The four units

| Row | Raw value | What it is | Renders as |
| --- | --- | --- | --- |
| `drawdown` | `-0.0939` | fractional decline from the running peak | `-9.4%` |
| `volume` | `1.1951` | recent mean volume ÷ baseline mean volume | `×1.20` |
| `trailing_pe` | `24.3` | price ÷ EPS, a multiple | `24.3` |
| `dcf_gap` | `0.182` | gap to fair value, **no horizon** | `+18.2%` |

---

## File Structure

| File | Responsibility |
| --- | --- |
| Create `apps/web/app/valuation/verdictTypes.ts` | TS mirror of the wire contract. |
| Create `apps/web/app/valuation/verdictFormat.ts` | One formatter per row, plus the row's display label. No React. |
| Create `apps/web/app/valuation/page.tsx` | Route. Owns both queries and the state contract. |
| Create `apps/web/app/valuation/components/TickerPicker.tsx` | Input with watchlist suggestions; never blocks. |
| Create `apps/web/app/valuation/components/VerdictPanel.tsx` | `direction` framing + the four rows. |
| Modify `apps/web/components/ui/Sidebar.tsx:5,8-15` | Nav entry. |
| Create `apps/web/tests/e2e/helpers/valuationPageMock.ts` | Route mock + a fixture carrying BOTH row states. |
| Create `apps/web/tests/e2e/valuation.spec.ts` | The page's e2e spec, grown one task at a time. |

---

### Task 1: The route, its types, the picker, and the state contract

**Files:**
- Create: `apps/web/app/valuation/verdictTypes.ts`, `apps/web/app/valuation/page.tsx`, `apps/web/app/valuation/components/TickerPicker.tsx`
- Modify: `apps/web/components/ui/Sidebar.tsx`
- Create: `apps/web/tests/e2e/helpers/valuationPageMock.ts`, `apps/web/tests/e2e/valuation.spec.ts`

**Interfaces:**
- Produces: `VerdictRow`, `VerdictPanel`, `WatchlistItem`, `SIGNAL_ORDER`; the route `/valuation`; `mockValuationApi(page, options?)` and `VERDICT_FIXTURE`.

- [ ] **Step 1: Read the App Router guide**

```bash
ls apps/web/node_modules/next/dist/docs/01-app/
```

Read the page/layout conventions file. If it contradicts the snippet below, follow the guide and say so in your report.

- [ ] **Step 2: Write the failing tests**

Create `apps/web/tests/e2e/helpers/valuationPageMock.ts`:

```ts
import type { Page } from "@playwright/test";
import { API_PREFIX, json } from "./mockUtils";
import type { VerdictPanel } from "../../../app/valuation/verdictTypes";

// BOTH row states are present on purpose: two computed, two refused. A fixture
// where every row computes would pass against a UI that drops refusals -- and
// refusal is the majority state in the real data (2 of 4 rows refuse for every
// one of the 139 watchlist tickers as of 2026-09-04).
export const VERDICT_FIXTURE: VerdictPanel = {
  ticker: "AEP",
  direction:
    "Testing UNDERVALUATION. Each row states the basis it was compared against, and those bases differ.",
  rows: {
    drawdown: {
      value: -0.09395437797260045,
      comparison: "peer mean -12.9%",
      source: "own window: last 252 of 2513 bars; peers: 8 of 8 within 2025-09-04..2026-09-03",
      reason: null,
    },
    volume: {
      value: 1.1951446405779511,
      comparison: null,
      source: "own bars: 90/252 bars",
      reason: null,
    },
    trailing_pe: {
      value: null,
      comparison: null,
      source: "Damodaran",
      reason: "no_vintage: no industry benchmark data has been loaded",
    },
    dcf_gap: {
      value: null,
      comparison: null,
      source: "conservative case",
      reason: "no_vintage: no industry benchmark data has been loaded",
    },
  },
};

export const WATCHLIST_FIXTURE = [
  { ticker: "AEP", name: "American Electric Power", sector: "Utilities" },
  { ticker: "AAPL", name: "Apple", sector: "Technology" },
];

export interface ValuationMockOptions {
  panel?: VerdictPanel;
  /** Non-200 makes the verdict request fail, for the error-state test. */
  verdictStatus?: number;
  /** Hold the watchlist response open, to prove the panel never waits on it. */
  stallWatchlist?: boolean;
}

export async function mockValuationApi(page: Page, options: ValuationMockOptions = {}) {
  const panel = options.panel ?? VERDICT_FIXTURE;
  const verdictStatus = options.verdictStatus ?? 200;

  await page.route(`**${API_PREFIX}/portfolio/watchlist`, async (route) => {
    if (options.stallWatchlist) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    // A BARE ARRAY, not the {status, data} envelope -- that is what this
    // endpoint actually returns, and fetchApi passes it through unchanged.
    return json(route, WATCHLIST_FIXTURE);
  });

  await page.route(`**${API_PREFIX}/valuation/verdict/**`, async (route) => {
    if (verdictStatus !== 200) {
      return json(route, { detail: "boom" }, verdictStatus);
    }
    return json(route, { status: "ok", data: panel, meta: {} });
  });
}
```

Create `apps/web/tests/e2e/valuation.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

async function gotoValuation(page: Page) {
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the valuation tab", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await expect(page.getByRole("link", { name: /Valuation/i })).toBeVisible();
  });

  test("no ticker chosen shows a prompt, not an empty panel", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await expect(page.getByTestId("verdict-panel")).toHaveCount(0);
    await expect(page.getByText(/choose a ticker/i)).toBeVisible();
  });

  test("a failed verdict request shows an error and no rows", async ({ page }) => {
    await mockValuationApi(page, { verdictStatus: 500 });
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    // Positive control: the error branch actually rendered.
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("verdict-panel")).toHaveCount(0);
    await expect(page.getByTestId("verdict-row-drawdown")).toHaveCount(0);
  });
});
```

- [ ] **Step 3: Run them and watch them fail**

```bash
cd apps/web && npm.cmd run test:e2e -- valuation.spec.ts
```

Expected: FAIL — `/valuation` 404s.

- [ ] **Step 4: Write the types**

Create `apps/web/app/valuation/verdictTypes.ts`:

```ts
/**
 * Mirrors apps/api/models/schema_parts/valuation.py.
 *
 * `value` and `reason` are MUTUALLY EXCLUSIVE -- the model's own docstring says
 * so. `source` is present on every row, including refused ones: a refused
 * trailing_pe still reports "Damodaran", naming where the figure would have
 * come from.
 */
export interface VerdictRow {
  value: number | null;
  comparison: string | null;
  source: string;
  reason: string | null;
}

export interface VerdictPanel {
  ticker: string;
  /** A FIXED constant string, identical for every ticker. Framing, not a verdict. */
  direction: string;
  rows: Record<string, VerdictRow>;
}

/** Fixed display order. Never sorted by magnitude -- see the plan's constraints. */
export const SIGNAL_ORDER = ["drawdown", "volume", "trailing_pe", "dcf_gap"] as const;

export type SignalName = (typeof SIGNAL_ORDER)[number];

/** Only the fields the picker needs; the endpoint returns more. */
export interface WatchlistItem {
  ticker: string;
  name: string;
  sector?: string;
}
```

- [ ] **Step 5: Write the ticker picker**

Create `apps/web/app/valuation/components/TickerPicker.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { WatchlistItem } from "../verdictTypes";

/**
 * A plain input with a datalist of watchlist suggestions.
 *
 * The suggestions are OPTIONAL by construction: `items` may be empty while the
 * watchlist request is still in flight (2-3.5s in production, because that
 * endpoint fetches a live quote per ticker), and the input still accepts any
 * symbol typed in. The panel must never wait on suggestions.
 */
export function TickerPicker({
  items,
  onSubmit,
}: {
  items: WatchlistItem[];
  onSubmit: (ticker: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (ticker) onSubmit(ticker);
  };

  return (
    <form onSubmit={submit} className="mb-6 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
        Ticker
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          list="valuation-ticker-suggestions"
          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
        />
      </label>
      <datalist id="valuation-ticker-suggestions">
        {items.map((item) => (
          <option key={item.ticker} value={item.ticker}>{item.name}</option>
        ))}
      </datalist>
      <button
        type="submit"
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)]"
      >
        Show panel
      </button>
    </form>
  );
}
```

- [ ] **Step 6: Write the page**

Create `apps/web/app/valuation/page.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { TickerPicker } from "./components/TickerPicker";
import type { VerdictPanel, WatchlistItem } from "./verdictTypes";

export default function ValuationPage() {
  useDevMonitorPageLoad({ component: "valuation_page" });
  const [ticker, setTicker] = useState<string | null>(null);

  // Suggestions only. Deliberately NOT awaited by anything below: this endpoint
  // fetches a live quote per ticker and takes 2-3.5s.
  const watchlistQuery = useQuery<WatchlistItem[]>({
    queryKey: ["watchlist-tickers"],
    queryFn: () => fetchApi<WatchlistItem[]>("/portfolio/watchlist", {
      monitor: { operation: "frontend.query.watchlist_tickers", component: "valuation_page" },
    }),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });

  const verdictQuery = useQuery<VerdictPanel>({
    queryKey: ["verdict", ticker],
    enabled: ticker !== null,
    queryFn: () => fetchApi<VerdictPanel>(`/valuation/verdict/${ticker}`, {
      monitor: { operation: "frontend.query.verdict", component: "valuation_page", ticker },
    }),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="p-6">
      <PageHeader
        title="Valuation"
        subtitle="One evidence panel per ticker. Every row states the basis it was compared against, and a row that cannot be computed says why."
      />

      <TickerPicker items={watchlistQuery.data ?? []} onSubmit={setTicker} />

      {/* The state contract. Loading and error render NO rows and no partial
          panel: either would state an answer the request never returned. */}
      {ticker === null && (
        <p className="text-[var(--text-secondary)]">Choose a ticker to see its evidence panel.</p>
      )}
      {ticker !== null && verdictQuery.isLoading && (
        <p role="status" className="text-[var(--text-secondary)]">Loading the panel…</p>
      )}
      {ticker !== null && verdictQuery.isError && (
        <p role="alert" className="text-[var(--chart-negative)]">
          Could not load the panel for {ticker}.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Add the nav entry**

In `apps/web/components/ui/Sidebar.tsx`, add `Scale` to the `lucide-react` import (verified present in `lucide-react` 1.7.0) and add to `navItems`:

```ts
  { href: "/valuation", label: "Valuation", icon: Scale },
```

- [ ] **Step 8: Run the tests, lint and typecheck**

```bash
cd apps/web && npm.cmd run test:e2e -- valuation.spec.ts
npm.cmd run lint -- app/valuation components/ui/Sidebar.tsx
npm.cmd run typecheck
```

Expected: PASS, clean.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/valuation apps/web/components/ui/Sidebar.tsx apps/web/tests/e2e/valuation.spec.ts apps/web/tests/e2e/helpers/valuationPageMock.ts
git commit -m "feat: add the /valuation route, its types and a non-blocking ticker picker"
```

---

### Task 2: The formatters and the panel — four rows, both states, source always

**Files:**
- Create: `apps/web/app/valuation/verdictFormat.ts`
- Create: `apps/web/app/valuation/components/VerdictPanel.tsx`
- Modify: `apps/web/app/valuation/page.tsx`
- Test: `apps/web/tests/e2e/valuation.spec.ts`

**Interfaces:**
- Consumes: `VerdictPanel`, `SIGNAL_ORDER`, `SignalName`, `WatchlistItem` (Task 1).
- Produces: `formatSignalValue`, `SIGNAL_LABELS`, `SIGNAL_UNIT_NOTE`; `<VerdictPanelView panel={VerdictPanel} />`.

> **Merged from the plan's original Tasks 2 and 3.** The formatter module has no
> consumer and no passing test until the panel renders it, so splitting them put
> a knowingly-red suite behind a commit. They ship together.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/tests/e2e/valuation.spec.ts`:

```ts
  test("each row is formatted in its own unit", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible();

    // drawdown is a FRACTION of the peak -> a percent.
    await expect(page.getByTestId("verdict-row-drawdown")).toContainText("-9.4%");

    // volume is a RATIO of two means -> a multiplier, NOT a percent.
    // Formatted as a percent this reads "119.5%" or "+19.5%", either of which
    // states something the number does not say.
    await expect(page.getByTestId("verdict-row-volume")).toContainText("×1.20");
    await expect(page.getByTestId("verdict-row-volume")).not.toContainText("119.5%");
    await expect(page.getByTestId("verdict-row-volume")).not.toContainText("19.5%");
  });

test("the panel renders without waiting for the watchlist", async ({ page }) => {
    // The watchlist takes 2-3.5s in production because it fetches a live quote
    // per ticker. Suggestions are a convenience; the panel is the product.
    await mockValuationApi(page, { stallWatchlist: true });
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("a refused row renders its reason as content, not as a value", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    const pe = page.getByTestId("verdict-row-trailing_pe");
    await expect(pe).toBeVisible();
    await expect(pe).toContainText("no industry benchmark data has been loaded");
    // A refusal rendered as a number is indistinguishable from a real figure.
    await expect(pe).not.toContainText("0.0");
    await expect(pe).not.toContainText("×");
  });

  test("every row shows its full source, refused rows included", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible();

    // Computed: the full sentence, not a truncation.
    await expect(page.getByTestId("verdict-row-drawdown")).toContainText(
      "own window: last 252 of 2513 bars; peers: 8 of 8 within 2025-09-04..2026-09-03"
    );
    // Refused: source still names where the figure WOULD have come from.
    await expect(page.getByTestId("verdict-row-trailing_pe")).toContainText("Damodaran");
    await expect(page.getByTestId("verdict-row-dcf_gap")).toContainText("conservative case");
  });

  test("the comparison string is rendered verbatim", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    // Exactly as the backend wrote it -- that string is its attribution wording.
    await expect(page.getByTestId("verdict-row-drawdown")).toContainText("peer mean -12.9%");
  });

  test("the page invents no verdict of its own", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    // Positive control first: an absence assertion against an unrendered page
    // proves nothing (see corporate-probability-labels.spec.ts).
    await expect(page.getByTestId("verdict-panel")).toBeVisible();
    await expect(page.getByTestId("verdict-row-drawdown")).toBeVisible();

    // `direction` is a fixed constant; the backend computes no verdict, and
    // four signals in four units cannot be rolled into one without inventing
    // a basis none of them share.
    for (const forbidden of [/\bundervalued\b/i, /\bovervalued\b/i, /\bscore\b/i,
                             /\bverdict:/i, /\brating\b/i, /\bsignals? passed\b/i]) {
      await expect(page.getByText(forbidden)).toHaveCount(0);
    }
    // The framing text itself IS shown, and says what it is testing.
    await expect(page.getByTestId("verdict-direction")).toContainText("Testing UNDERVALUATION");
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd apps/web && npm.cmd run test:e2e -- valuation.spec.ts
```

Expected: FAIL — no `verdict-panel`.

- [ ] **Step 3: Write the formatter module**

Create `apps/web/app/valuation/verdictFormat.ts`:

```ts
import type { SignalName } from "./verdictTypes";

/**
 * One formatter per signal. There is deliberately NO shared formatValue().
 *
 * The four rows arrive as bare JSON numbers in four different units:
 *
 *   drawdown    -0.0939  fractional decline from the running peak  -> -9.4%
 *   volume       1.1951  recent mean volume / baseline mean volume -> x1.20
 *   trailing_pe 24.3     price / EPS, a multiple                   -> 24.3
 *   dcf_gap      0.182   (intrinsic - price) / price, NO horizon   -> +18.2%
 *
 * A single formatter across all four renders volume's 1.1951 as "119.5%",
 * which states a proportion the number is not. The panel's whole purpose is
 * that a figure travels with its basis; formatting it in the wrong unit
 * breaks that at the last step.
 */

export const SIGNAL_LABELS: Record<SignalName, string> = {
  drawdown: "Drawdown from peak",
  volume: "Volume vs baseline",
  trailing_pe: "Trailing PE",
  dcf_gap: "Gap to fair value",
};

/** The basis line under each figure. `dcf_gap` names its lack of a horizon. */
export const SIGNAL_UNIT_NOTE: Record<SignalName, string> = {
  drawdown: "percent of the 252-bar peak",
  volume: "multiple of the baseline mean",
  trailing_pe: "price ÷ earnings, a multiple",
  dcf_gap: "total gap, no time horizon",
};

function percent(value: number, decimals = 1): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(decimals)}%`;
}

export function formatSignalValue(signal: SignalName, value: number): string {
  switch (signal) {
    case "drawdown":
      // A decline is already negative; percent() supplies the sign.
      return percent(value);
    case "dcf_gap":
      return percent(value);
    case "volume":
      // A ratio. "x1.20" cannot be misread as a proportion.
      return `×${value.toFixed(2)}`;
    case "trailing_pe":
      return value.toFixed(1);
  }
}
```

- [ ] **Step 4: Write the panel**

Create `apps/web/app/valuation/components/VerdictPanel.tsx`:

```tsx
"use client";

import { SIGNAL_LABELS, SIGNAL_UNIT_NOTE, formatSignalValue } from "../verdictFormat";
import { SIGNAL_ORDER, type SignalName, type VerdictPanel } from "../verdictTypes";

/**
 * The evidence panel. Computed and refused rows go through the SAME path:
 * refusal is the majority state in the real data (2 of 4 rows refuse for every
 * watchlist ticker as of 2026-09-04), so it is the main case, not a fallback.
 *
 * No badge, no score, no colour-coding, no sorting by magnitude. `direction` is
 * a fixed constant identical for every ticker; the backend deliberately
 * computes no verdict and neither does this component.
 */
export function VerdictPanelView({ panel }: { panel: VerdictPanel }) {
  return (
    <section data-testid="verdict-panel" className="flex flex-col gap-4">
      {/* Framing, rendered as prose. Not a headline verdict. */}
      <p
        data-testid="verdict-direction"
        className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 text-xs leading-relaxed text-[var(--text-secondary)]"
      >
        {panel.direction}
      </p>

      {SIGNAL_ORDER.map((name) => {
        const row = panel.rows[name];
        if (!row) return null;
        return <SignalRow key={name} name={name} row={panel.rows[name]} />;
      })}
    </section>
  );
}

function SignalRow({ name, row }: { name: SignalName; row: VerdictPanel["rows"][string] }) {
  const refused = row.value === null;
  return (
    <article
      data-testid={`verdict-row-${name}`}
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">{SIGNAL_LABELS[name]}</h3>
        {!refused && (
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {formatSignalValue(name, row.value as number)}
          </p>
        )}
      </div>

      {!refused && (
        <p className="text-xs text-[var(--text-muted)]">{SIGNAL_UNIT_NOTE[name]}</p>
      )}

      {/* Verbatim: this is the backend's own attribution wording. */}
      {row.comparison && (
        <p className="mt-2 text-[length:var(--type-body)] text-[var(--text-primary)]">
          {row.comparison}
        </p>
      )}

      {/* Content, not an error state. */}
      {row.reason && (
        <p className="mt-2 text-[length:var(--type-body)] text-[var(--text-primary)]">
          {row.reason}
        </p>
      )}

      {/* ALWAYS, in full, on every row. Never behind a click. */}
      <p className="mt-3 text-xs text-[var(--text-secondary)]">{row.source}</p>
    </article>
  );
}
```

- [ ] **Step 5: Render it from the page**

In `apps/web/app/valuation/page.tsx`, import `VerdictPanelView` and add, after the three state branches:

```tsx
      {ticker !== null && !verdictQuery.isLoading && !verdictQuery.isError && verdictQuery.data && (
        <VerdictPanelView panel={verdictQuery.data} />
      )}
```

- [ ] **Step 6: Run the tests, lint and typecheck**

```bash
cd apps/web && npm.cmd run test:e2e -- valuation.spec.ts
npm.cmd run lint -- app/valuation
npm.cmd run typecheck
```

Expected: PASS, clean.

- [ ] **Step 7: Verify the units test is load-bearing**

In `verdictFormat.ts`, change the `volume` case to `return percent(value);` — the shared-formatter mistake this whole design exists to prevent.

```bash
npm.cmd run test:e2e -- valuation.spec.ts
```

Expected: FAIL on `"×1.20"` (received `+119.5%`). **Restore** and re-run green.

- [ ] **Step 8: Verify the refusal test is load-bearing**

In `VerdictPanel.tsx`, change `const refused = row.value === null;` to `const refused = false;` and the value line to `formatSignalValue(name, row.value ?? 0)`.

```bash
npm.cmd run test:e2e -- valuation.spec.ts
```

Expected: FAIL — the refused `trailing_pe` row renders `0.0`. **Restore.**

- [ ] **Step 9: Verify the source test is load-bearing**

In `VerdictPanel.tsx`, wrap the `source` paragraph so it renders only when `!refused`.

```bash
npm.cmd run test:e2e -- valuation.spec.ts
```

Expected: FAIL — `trailing_pe` no longer contains "Damodaran". **Restore.**

- [ ] **Step 10: Verify the no-verdict test is load-bearing**

Add a rollup badge to `VerdictPanelView`, above the rows:

```tsx
<p>Verdict: UNDERVALUED</p>
```

```bash
npm.cmd run test:e2e -- valuation.spec.ts
```

Expected: FAIL on `/\bundervalued\b/i` and `/\bverdict:/i`. **Restore** and re-run green.

- [ ] **Step 11: Commit**

```bash
git add apps/web/app/valuation apps/web/tests/e2e/valuation.spec.ts
git commit -m "feat: render the evidence panel with every row on its own basis"
```

---

### Task 3: Whole-suite verification and docs

**Files:**
- Modify: `guideline/sop/todo.md` (Track C, item C1)

- [ ] **Step 1: Run the WHOLE frontend suite**

```bash
cd apps/web && npm.cmd run test:e2e
```

A new nav item changes the sidebar on every page, so a sidebar-sensitive spec elsewhere can regress. Expect the 24 pre-existing specs plus this one. Report any failure; do not fix unrelated specs without saying so.

- [ ] **Step 2: Run the backend suite**

```bash
cd /c/Learn/Economy/MoneyView && python -m pytest -q
```

Expected: `967 passed`. Nothing here touches Python; a failure means something unrelated moved.

- [ ] **Step 3: Lint and typecheck**

```bash
cd apps/web
npm.cmd run lint -- app/valuation components/ui/Sidebar.tsx tests/e2e/valuation.spec.ts tests/e2e/helpers/valuationPageMock.ts
npm.cmd run typecheck
```

- [ ] **Step 4: Close C1 in the todo**

Change `- [ ] **C1. 3d - the valuation tab.**` to `- [x]` and record: the route, the four files, the test count, and — for each test guarding a spec rule — the mutation it was shown to catch (the shared formatter, the zeroed refusal, the hidden source, the invented verdict). State plainly that **C2 remains open**, and that the panel currently shows two computed rows and two refusals for every ticker because `no_vintage` is Track A1.

- [ ] **Step 5: Commit**

```bash
git add guideline/sop/todo.md
git commit -m "docs: close Track C1, the valuation tab"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §2 scope: one route, one ticker, nav entry | Task 1 |
| §3 contract: `value`/`reason` exclusive, `source` on refusals, `comparison` verbatim | Tasks 1, 3 |
| §4 four different units, no shared formatter | Task 2, mutation-verified in Task 2 |
| §5 `direction` is framing; no badge/score/colour/sort | Task 2, mutation-verified |
| §6 row anatomy; `source` always visible | Task 2, mutation-verified |
| §7 ticker selection, suggestions never block | Task 1 (component) + Task 2 (`stallWatchlist` test) |
| §8 UI state contract | Task 1 |
| §9 testing, positive controls, mutations | Tasks 1–2 |
| §10 out of scope | not implemented, deliberately |

**Deliberately not built**

- **A unit test runner.** `apps/web` has Playwright only; `verdictFormat.ts` is pure and is exercised through the page. Adding vitest is a toolchain decision outside this feature.
- **A `dcf_gap` computed-row test.** It refuses for every ticker today (`no_vintage`), so the fixture would assert on a state the real API cannot currently produce. Its formatter is covered by the same `percent()` path as `drawdown`. When A1 lands, add the case then.
- **Ranking, sorting, filtering tickers.** All require the rollup §5 forbids.

**Type consistency:** `VerdictRow`, `VerdictPanel`, `SIGNAL_ORDER`, `SignalName`, `WatchlistItem` (Task 1) are used unchanged in Tasks 2–3. `formatSignalValue`, `SIGNAL_LABELS`, `SIGNAL_UNIT_NOTE` are created and consumed within Task 2. Row keys `value`/`comparison`/`source`/`reason` match the captured response verbatim.

**Query keys:** `["watchlist-tickers"]` and `["verdict", ticker]`. The verdict query is `enabled: ticker !== null`, so no request fires before a ticker is chosen.
