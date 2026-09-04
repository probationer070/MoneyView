# Snapshot Overhaul — Frontend (`/decisions`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/decisions` page — record a decision, read the log with each decision's two figures on their own stated bases, and one scatter of gap-at-decision against price-move-since — consuming the API that shipped in PR #17.

**Architecture:** One App Router client route (`app/decisions/page.tsx`) owns the React Query calls and passes plain data down to presentational components, per `apps/web/AGENTS.md` ("keep page-level query ownership in route pages"). A pure module partitions the API rows into *plottable* and *excluded* before the chart ever sees them, so the chart cannot silently drop a decision. The chart is Recharts, styled only from `lib/chartConfig.ts`.

**Tech Stack:** Next.js 16.2.2 (App Router), React 19.2.4, `@tanstack/react-query` 5, Recharts 3.8, `lucide-react`, Playwright 1.59.

**Spec:** `docs/superpowers/specs/2026-09-03-snapshot-overhaul-design.md` (§4, §4.1, §6, §8, §9)

---

## Global Constraints

- **Next.js 16.2.2 is NOT the Next.js in your training data.** `apps/web/AGENTS.md` requires reading the relevant guide under `apps/web/node_modules/next/dist/docs/01-app/` before writing route code. Heed deprecation notices.
- **The client never sends figures.** `POST /api/v1/decisions` accepts `{ticker, action, memo}` and **nothing else**; the request model is `extra="forbid"`, so any extra key is a 422. Never add one "for convenience".
- **No trend line, no R², no accuracy score, no error metric** on the scatter (spec §6). Each asserts the two axes are commensurable; they are not — `dcf_implied_return_pct` has **no horizon**, `price_move_pct` has a stated one.
- **Never combine the gap and the move into a third number** — no difference, ratio, "hit rate", or score, in the UI or in any derived value. This is the same rule the backend enforces with an allowlist at two layers (`tests/api/test_investment_decision_read.py`, `tests/api/test_decision_routes.py`).
- **Refusals are content, not errors.** A decision with `figures_unavailable_reason`, or an outcome with `reason`, renders its sentence. It is never blank, never `0.0%`, never an error toast.
- **Chart styling comes from `@/lib/chartConfig`** (`GRID_STYLE`, `withAxisProps`, `withTooltipProps`, `CHART_COLORS`, `fmtPct`, `fmtPctTick`). Do not write inline hex or ad-hoc tick styles.
- **The only test runner is Playwright** (`npm.cmd run test:e2e`). There is no vitest/jest/@testing-library in `apps/web/package.json`. **Do not add one** — that is a toolchain decision outside this plan's scope. Every test below is a Playwright spec against a mocked API.
- **Lint narrowly first:** `npm.cmd run lint -- <path>` from `apps/web`. Use `npm.cmd`, not `npm`, if PowerShell blocks it.
- Path alias is `@/` → `apps/web/`.
- **Keep `text-[var(--x)]` bracket syntax.** A Tailwind v4 IDE extension will suggest the canonical `text-(--x)` shorthand. There is no Tailwind ESLint plugin in `eslint.config.mjs`, so `npm run lint` does not care, and every existing component (`components/ui/PageHeader.tsx`, `app/corporate/components/graphs/ValueDriverMatrixGraph.tsx`) uses brackets. `AGENTS.md` says follow existing patterns; canonicalising only these files would make them the odd ones out.

### The UI state contract

Seven states, exhaustive and mutually exclusive at each level. Every one is
reachable from the fixture in Task 1. An implementer who satisfies this table
cannot produce the two failures this feature exists to prevent — a fabricated
number, and a silently dropped row.

| Condition | The page must |
| --- | --- |
| `isLoading` | show a loading indicator — **never** the empty state, and never a `0 decisions` count, which asserts an answer the request has not returned |
| `isError` | show an error — **never** a decision count or an empty-state sentence, both of which claim knowledge of the log |
| loaded, `data.length === 0` | show "No decisions recorded yet" |
| `figures_unavailable_reason !== null` | render that sentence in place of the figures; the five figure fields are all null together |
| `outcome.reason !== null` | render that sentence in place of the move; never `0.0%`, which is indistinguishable from a genuine flat move |
| both figures present | render the numeric pair, each under its own basis label |
| plottable (below) | draw a point |
| not plottable | exclude from the chart **and** count it in the coverage caption, by semantic reason |

### The plottability invariant

```
A DecisionPoint exists for a decision IFF
    dcf_implied_return_pct !== null
AND outcome.price_move_pct   !== null
AND outcome.price_date       !== null
```

The third clause looks redundant and is kept deliberately. `outcome_for`
(`apps/api/services/investment_decision.py`) sets `price_date` and the move
together — both null in each refusal branch, both non-null on success — so the
second clause already implies the third at runtime. The clause is what lets
`DecisionPoint.priceDate` be `string` rather than `string | null`, so the
period always travels with the point. Do not "simplify" it away: without it the
type has to admit a point whose period is unknown.

### The API contract, captured from a live response

Not paraphrased — this is a real `GET /api/v1/decisions` body, produced on 2026-09-04 against a throwaway DB. `fetchApi` unwraps the envelope, so `fetchApi<DecisionRow[]>("/decisions")` returns the `data` array directly, and `buildApiUrl` prepends `/api/v1`.

```json
{
  "status": "ok",
  "data": [
    {
      "id": 3, "ticker": "ZZTOP", "decided_at": "2026-09-04T01:58:55.618499+00:00",
      "action": "pass", "memo": "no data, recording the pass anyway",
      "price_at_decision": null, "dcf_value": null, "dcf_implied_return_pct": null,
      "roic": null, "wacc": null, "risk_free_rate": null, "equity_risk_premium": null,
      "metric_schema_version": null, "figures_source": "unavailable",
      "figures_unavailable_reason": "no stored price for ZZTOP: the model cannot value it at this time",
      "outcome": { "decided_on": "2026-09-04", "price_now": null, "price_date": null,
                   "price_move_pct": null, "reason": "no price recorded at decision time" }
    },
    {
      "id": 2, "ticker": "NVDA", "decided_at": "2026-09-04T01:58:55.569987+00:00",
      "action": "watch", "memo": "rich, watching for a pullback",
      "price_at_decision": 100.0, "dcf_value": 150.0, "dcf_implied_return_pct": 50.0,
      "roic": 20.0, "wacc": 10.0, "risk_free_rate": 0.042, "equity_risk_premium": 0.055,
      "metric_schema_version": 2, "figures_source": "corporate_comparison._dcf_snapshot",
      "figures_unavailable_reason": null,
      "outcome": { "decided_on": "2026-09-04", "price_now": null, "price_date": null,
                   "price_move_pct": null, "reason": "no bar with a close after 2026-09-04" }
    },
    {
      "id": 1, "ticker": "MSFT", "decided_at": "2026-09-04T01:58:55.548308+00:00",
      "action": "buy", "memo": "cheap on FCF",
      "price_at_decision": 100.0, "dcf_value": 150.0, "dcf_implied_return_pct": 50.0,
      "roic": 20.0, "wacc": 10.0, "risk_free_rate": 0.042, "equity_risk_premium": 0.055,
      "metric_schema_version": 2, "figures_source": "corporate_comparison._dcf_snapshot",
      "figures_unavailable_reason": null,
      "outcome": { "decided_on": "2026-09-04", "price_now": 120.0, "price_date": "2099-01-01",
                   "price_move_pct": 20.0, "reason": null }
    }
  ],
  "meta": { "last_updated_at": "", "request_id": "" }
}
```

**Three distinct row states exist, and the UI must render all three.** In this real response only **1 of 3** decisions is plottable. A chart that draws one dot and says nothing about the other two is misreporting its own inputs — see Task 4.

`POST /api/v1/decisions` returns `{"status":"ok","data":{"id":4},"meta":{...}}`; `fetchApi` unwraps it to `{ id: 4 }`. Valid `action` values are exactly `buy | sell | watch | pass` (`apps/api/services/investment_decision.py`, `ACTIONS`); anything else is a 422, as is a blank `ticker` or a blank `memo`.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `apps/web/app/decisions/decisionTypes.ts` | TS mirror of the wire contract above. Mirrors the existing `app/corporate/corporateTypes.ts` pattern, not `packages/shared-types`. |
| Create `apps/web/app/decisions/decisionChartData.ts` | Pure partition of rows into plottable points and excluded rows, with counts. No React, no formatting. |
| Create `apps/web/app/decisions/page.tsx` | Route. Owns the query; composes the three components. |
| Create `apps/web/app/decisions/components/RecordDecisionForm.tsx` | `{ticker, action, memo}` form; invalidates `["decisions"]` on success. |
| Create `apps/web/app/decisions/components/DecisionList.tsx` | One card per decision: memo, action, and the two figures each labelled with its own basis. |
| Create `apps/web/app/decisions/components/DecisionOutcomeScatter.tsx` | The scatter plus its coverage caption. |
| Modify `apps/web/components/ui/Sidebar.tsx:5,8-14` | Add the `/decisions` nav item. |
| Create `apps/web/tests/e2e/helpers/decisionsPageMock.ts` | Playwright route mock returning the three-state fixture above. |
| Create `apps/web/tests/e2e/decisions.spec.ts` | The single e2e spec the design calls for (§8), grown one task at a time. |

---

### Task 1: The route, its types, and the nav entry

**Files:**
- Create: `apps/web/app/decisions/decisionTypes.ts`
- Create: `apps/web/app/decisions/page.tsx`
- Modify: `apps/web/components/ui/Sidebar.tsx:5` and `:8-14`
- Create: `apps/web/tests/e2e/helpers/decisionsPageMock.ts`
- Test: `apps/web/tests/e2e/decisions.spec.ts`

**Interfaces:**
- Produces: `DecisionOutcome`, `DecisionRow`, `DecisionAction`, `DECISION_ACTIONS` (types/constants); the route `/decisions`; `mockDecisionsApi(page, options?)` and `DECISION_FIXTURE`.

- [ ] **Step 1: Read the App Router guide**

The repo pins Next.js 16.2.2 and `apps/web/AGENTS.md` says its conventions may differ from your training data. Before writing `page.tsx`:

```bash
ls apps/web/node_modules/next/dist/docs/01-app/
```

Read the page/layout conventions file it lists. Note any deprecation notice that touches a client route.

- [ ] **Step 2: Write the failing test**

Create `apps/web/tests/e2e/helpers/decisionsPageMock.ts`:

```ts
import type { Page } from "@playwright/test";
import { API_PREFIX, json } from "./mockUtils";
import type { DecisionRow } from "../../../app/decisions/decisionTypes";

// The three states a decision row can be in, taken from a real
// GET /api/v1/decisions response (2026-09-04). Every test below depends on all
// three being present: a fixture where every decision is plottable would pass
// against a chart that silently drops the others.
export const DECISION_FIXTURE: DecisionRow[] = [
  {
    id: 3, ticker: "ZZTOP", decided_at: "2026-09-04T01:58:55.618499+00:00",
    action: "pass", memo: "no data, recording the pass anyway",
    price_at_decision: null, dcf_value: null, dcf_implied_return_pct: null,
    roic: null, wacc: null, risk_free_rate: null, equity_risk_premium: null,
    metric_schema_version: null, figures_source: "unavailable",
    figures_unavailable_reason: "no stored price for ZZTOP: the model cannot value it at this time",
    outcome: { decided_on: "2026-09-04", price_now: null, price_date: null,
               price_move_pct: null, reason: "no price recorded at decision time" },
  },
  {
    id: 2, ticker: "NVDA", decided_at: "2026-09-04T01:58:55.569987+00:00",
    action: "watch", memo: "rich, watching for a pullback",
    price_at_decision: 100.0, dcf_value: 150.0, dcf_implied_return_pct: 50.0,
    roic: 20.0, wacc: 10.0, risk_free_rate: 0.042, equity_risk_premium: 0.055,
    metric_schema_version: 2, figures_source: "corporate_comparison._dcf_snapshot",
    figures_unavailable_reason: null,
    outcome: { decided_on: "2026-09-04", price_now: null, price_date: null,
               price_move_pct: null, reason: "no bar with a close after 2026-09-04" },
  },
  {
    id: 1, ticker: "MSFT", decided_at: "2026-09-04T01:58:55.548308+00:00",
    action: "buy", memo: "cheap on FCF",
    price_at_decision: 100.0, dcf_value: 150.0, dcf_implied_return_pct: 50.0,
    roic: 20.0, wacc: 10.0, risk_free_rate: 0.042, equity_risk_premium: 0.055,
    metric_schema_version: 2, figures_source: "corporate_comparison._dcf_snapshot",
    figures_unavailable_reason: null,
    outcome: { decided_on: "2026-09-04", price_now: 120.0, price_date: "2099-01-01",
               price_move_pct: 20.0, reason: null },
  },
];

export type DecisionsMockStats = { posts: Array<Record<string, unknown>> };

export interface DecisionsMockOptions {
  /** Override the fixture. Used to reach the empty and all-excluded states. */
  rows?: DecisionRow[];
  /** Make POST fail with this status, to exercise the server-rejection path. */
  postStatus?: number;
}

export async function mockDecisionsApi(
  page: Page,
  options: DecisionsMockOptions = {}
): Promise<DecisionsMockStats> {
  const stats: DecisionsMockStats = { posts: [] };
  // MUTABLE on purpose. A successful POST appends here, so the refetch that
  // follows query invalidation returns a DIFFERENT list. Against a frozen
  // fixture the invalidation test cannot fail: the list looks identical
  // whether or not the query was ever invalidated.
  const rows: DecisionRow[] = [...(options.rows ?? DECISION_FIXTURE)];
  const postStatus = options.postStatus ?? 200;

  await page.route(`**${API_PREFIX}/decisions`, async (route) => {
    if (route.request().method() === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>;
      stats.posts.push(body);

      if (postStatus !== 200) {
        // Shaped like a real FastAPI validation failure. `fetchApi` throws on
        // any non-ok response and never surfaces `detail`, so no test may
        // assert on this text -- it is here only so the body is realistic.
        return json(route, { detail: "action must be one of buy, sell, watch, pass" }, postStatus);
      }

      const id = Math.max(0, ...rows.map((row) => row.id)) + 1;
      rows.unshift({
        id,
        ticker: String(body.ticker ?? ""),
        decided_at: "2026-09-05T00:00:00.000000+00:00",
        action: String(body.action ?? "buy"),
        memo: String(body.memo ?? ""),
        price_at_decision: 200.0, dcf_value: 260.0, dcf_implied_return_pct: 30.0,
        roic: 18.0, wacc: 9.0, risk_free_rate: 0.042, equity_risk_premium: 0.055,
        metric_schema_version: 2, figures_source: "corporate_comparison._dcf_snapshot",
        figures_unavailable_reason: null,
        outcome: { decided_on: "2026-09-05", price_now: null, price_date: null,
                   price_move_pct: null, reason: "no bar with a close after 2026-09-05" },
      });
      return json(route, { status: "ok", data: { id }, meta: {} });
    }
    return json(route, { status: "ok", data: rows, meta: {} });
  });

  return stats;
}
```

Create `apps/web/tests/e2e/decisions.spec.ts`:

```ts
import { expect, test, type Page } from "@playwright/test";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";

async function gotoDecisions(page: Page) {
  await page.goto("/decisions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Decision Log/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the decision log page", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);
    await expect(page.getByRole("link", { name: /Decision Log/i })).toBeVisible();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
```

Expected: FAIL — the heading never appears because `/decisions` 404s.

- [ ] **Step 4: Write the types**

Create `apps/web/app/decisions/decisionTypes.ts`:

```ts
/**
 * Mirrors apps/api/models/schema_parts/decision.py.
 *
 * Both percent fields carry `_pct` because they sit on the same scatter and a
 * raw fraction beside a percent would put them 100x apart. They are NOT
 * commensurable despite sharing a unit: `dcf_implied_return_pct` is total
 * upside with no time horizon, `price_move_pct` is a move over a stated
 * period. Never combine them.
 */
export type DecisionAction = "buy" | "sell" | "watch" | "pass";

export interface DecisionOutcome {
  decided_on: string;
  price_now: number | null;
  price_date: string | null;
  price_move_pct: number | null;
  /** Why there is no outcome yet. Content, not an error. */
  reason: string | null;
}

export interface DecisionRow {
  id: number;
  ticker: string;
  decided_at: string;
  action: string;
  memo: string;
  price_at_decision: number | null;
  dcf_value: number | null;
  dcf_implied_return_pct: number | null;
  roic: number | null;
  wacc: number | null;
  risk_free_rate: number | null;
  equity_risk_premium: number | null;
  metric_schema_version: number | null;
  figures_source: string;
  /** Stored INSTEAD of the figures when the model could not value the ticker. */
  figures_unavailable_reason: string | null;
  outcome: DecisionOutcome;
}

export const DECISION_ACTIONS: DecisionAction[] = ["buy", "sell", "watch", "pass"];
```

- [ ] **Step 5: Write the page**

Create `apps/web/app/decisions/page.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import type { DecisionRow } from "./decisionTypes";

export default function DecisionsPage() {
  useDevMonitorPageLoad("decisions_page");

  const decisionsQuery = useQuery<DecisionRow[]>({
    queryKey: ["decisions"],
    queryFn: () => fetchApi<DecisionRow[]>("/decisions", {
      monitor: { operation: "frontend.query.decisions", component: "decisions_page" },
    }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const decisions = decisionsQuery.data ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="Decision Log"
        subtitle="What was believed about a ticker, when, and why. Figures are captured by the server at record time and never edited."
      />
      {/* The state contract in Global Constraints, in order. Loading and error
          render NOTHING that implies a count: "0 decisions" or "none recorded
          yet" on a failed request states an answer the request never returned. */}
      {decisionsQuery.isLoading && (
        <p role="status" className="text-[var(--text-secondary)]">Loading decisions…</p>
      )}
      {decisionsQuery.isError && (
        <p role="alert" className="text-[var(--chart-negative)]">Could not load decisions.</p>
      )}
      {!decisionsQuery.isLoading && !decisionsQuery.isError && decisions.length === 0 && (
        <p className="text-[var(--text-secondary)]">No decisions recorded yet.</p>
      )}
    </div>
  );
}
```

Check the guide you read in Step 1: if it requires a different signature for a client route page, follow the guide, not this snippet.

- [ ] **Step 6: Add the nav entry**

In `apps/web/components/ui/Sidebar.tsx`, add `NotebookPen` to the `lucide-react` import on line 5 (verified present in `lucide-react` 1.7.0), and add to `navItems`:

```ts
  { href: "/decisions", label: "Decision Log", icon: NotebookPen },
```

- [ ] **Step 7: Run the test and lint**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
npm.cmd run lint -- app/decisions components/ui/Sidebar.tsx
```

Expected: PASS, clean lint.

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/decisions apps/web/components/ui/Sidebar.tsx apps/web/tests/e2e/decisions.spec.ts apps/web/tests/e2e/helpers/decisionsPageMock.ts
git commit -m "feat: add the /decisions route with its API types and nav entry"
```

---

### Task 2: The decision list — two figures, each on its own stated basis

**Files:**
- Create: `apps/web/app/decisions/components/DecisionList.tsx`
- Modify: `apps/web/app/decisions/page.tsx`
- Test: `apps/web/tests/e2e/decisions.spec.ts`

**Interfaces:**
- Consumes: `DecisionRow` from Task 1.
- Produces: `<DecisionList decisions={DecisionRow[]} />`.

Spec §6 requires **two figures side by side, each labelled with its own basis**: the gap has no horizon, the move names its period. This task renders that pairing and the two refusal sentences.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe` in `apps/web/tests/e2e/decisions.spec.ts`:

```ts
  test("each figure is labelled with its own basis, and the move names its period", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    const msft = page.getByTestId("decision-card-1");
    await expect(msft).toBeVisible();

    // The gap is horizonless and must say so -- it is NOT an annual return.
    await expect(msft.getByText(/gap to fair value at decision/i)).toBeVisible();
    await expect(msft.getByText(/no horizon/i)).toBeVisible();
    await expect(msft.getByText("+50.0%")).toBeVisible();

    // The move carries a stated period, both dates named (spec 4.1).
    await expect(msft.getByText(/price move/i)).toBeVisible();
    await expect(msft.getByText(/2026-09-04/)).toBeVisible();
    await expect(msft.getByText(/2099-01-01/)).toBeVisible();
    await expect(msft.getByText("+20.0%")).toBeVisible();

    await expect(msft.getByText("cheap on FCF")).toBeVisible();
  });

  test("a refusal renders its sentence, never a zero and never a blank", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    // Figures refused: the reason replaces the numbers.
    const zztop = page.getByTestId("decision-card-3");
    await expect(zztop.getByText(/the model cannot value it at this time/i)).toBeVisible();

    // Outcome pending: a flat 0.0% would be indistinguishable from a genuine
    // zero move, which is exactly what spec 4.1 forbids.
    const nvda = page.getByTestId("decision-card-2");
    await expect(nvda.getByText(/no bar with a close after 2026-09-04/i)).toBeVisible();
    await expect(nvda.getByText("0.0%")).toHaveCount(0);
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
```

Expected: FAIL — `decision-card-1` does not exist.

- [ ] **Step 3: Write the component**

Create `apps/web/app/decisions/components/DecisionList.tsx`:

```tsx
"use client";

import { fmtPct } from "@/lib/chartConfig";
import type { DecisionRow } from "../decisionTypes";

function signedPct(value: number) {
  return `${value >= 0 ? "+" : ""}${fmtPct(value, 1)}`;
}

/**
 * The two figures are deliberately rendered as a PAIR with separate basis
 * lines. They share a unit and nothing else: the gap is total upside with no
 * horizon, the move is a change over a stated period. Presenting them without
 * their bases is what would invite someone to subtract one from the other.
 */
function FigurePair({ decision }: { decision: DecisionRow }) {
  const { outcome } = decision;
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3">
        <p className="text-xs font-medium text-[var(--text-secondary)]">
          Gap to fair value at decision
        </p>
        <p className="text-lg font-bold text-[var(--text-primary)]">
          {decision.dcf_implied_return_pct === null
            ? "—"
            : signedPct(decision.dcf_implied_return_pct)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">no horizon</p>
        {decision.figures_unavailable_reason && (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {decision.figures_unavailable_reason}
          </p>
        )}
      </div>

      <div className="rounded-[var(--radius-sm)] border border-[var(--border-default)] p-3">
        <p className="text-xs font-medium text-[var(--text-secondary)]">Price move</p>
        <p className="text-lg font-bold text-[var(--text-primary)]">
          {outcome.price_move_pct === null ? "—" : signedPct(outcome.price_move_pct)}
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          {outcome.price_date
            ? `${outcome.decided_on} → ${outcome.price_date}`
            : `from ${outcome.decided_on}`}
        </p>
        {outcome.reason && (
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{outcome.reason}</p>
        )}
      </div>
    </div>
  );
}

export function DecisionList({ decisions }: { decisions: DecisionRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      {decisions.map((decision) => (
        <article
          key={decision.id}
          data-testid={`decision-card-${decision.id}`}
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
        >
          <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">{decision.ticker}</h3>
            <span className="rounded-full border border-[var(--border-default)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
              {decision.action}
            </span>
            <span className="text-xs text-[var(--text-muted)]">{decision.outcome.decided_on}</span>
          </div>
          <p className="mt-2 text-[length:var(--type-body)] text-[var(--text-primary)]">
            {decision.memo}
          </p>
          <FigurePair decision={decision} />
        </article>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Render it from the page**

In `apps/web/app/decisions/page.tsx`, import `DecisionList` and render it after the three state branches, guarded so it never renders during loading or error:

```tsx
      {!decisionsQuery.isLoading && !decisionsQuery.isError && (
        <DecisionList decisions={decisions} />
      )}
```

- [ ] **Step 5: Run the tests and lint**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
npm.cmd run lint -- app/decisions
```

Expected: PASS, clean lint.

- [ ] **Step 6: Verify the refusal test actually tests the refusal**

Break the source and confirm the test fails for the intended reason (`.claude/CLAUDE.md` §8):

In `DecisionList.tsx`, change `{outcome.price_move_pct === null ? "—" : signedPct(outcome.price_move_pct)}` to `{signedPct(outcome.price_move_pct ?? 0)}` — the exact defect spec §4.1 forbids, a refusal rendered as `+0.0%`.

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "refusal renders its sentence"
```

Expected: FAIL on `expect(nvda.getByText("0.0%")).toHaveCount(0)` — received 1. **Restore the source** and re-run to confirm green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/decisions apps/web/tests/e2e/decisions.spec.ts
git commit -m "feat: list decisions with each figure on its own stated basis"
```

---

### Task 3: Recording a decision

**Files:**
- Create: `apps/web/app/decisions/components/RecordDecisionForm.tsx`
- Modify: `apps/web/app/decisions/page.tsx`
- Test: `apps/web/tests/e2e/decisions.spec.ts`

**Interfaces:**
- Consumes: `DECISION_ACTIONS`, `DecisionAction` from Task 1.
- Produces: `<RecordDecisionForm />` (owns its own mutation and invalidation).

The POST endpoint shipped with no caller. This adds one. `apps/web/AGENTS.md` requires naming the query keys that refresh on success: **`["decisions"]`**.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/tests/e2e/decisions.spec.ts`:

```ts
  test("recording a decision posts exactly ticker, action and memo", async ({ page }) => {
    const stats = await mockDecisionsApi(page);
    await gotoDecisions(page);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/action/i).selectOption("buy");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    // Enter, not a click: it is a real <form>, and submitting the way a
    // keyboard user does proves the semantics rather than the click handler.
    await page.getByLabel(/memo/i).press("Enter");

    await expect.poll(() => stats.posts.length).toBe(1);
    // The request model is extra="forbid": any additional key is a 422, and a
    // client-supplied figure would be stored as what the user believed.
    expect(Object.keys(stats.posts[0]).sort()).toEqual(["action", "memo", "ticker"]);
    expect(stats.posts[0]).toMatchObject({
      ticker: "AAPL", action: "buy", memo: "services margin inflecting",
    });
  });

  test("a recorded decision appears in the list without a reload", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    // Precondition: the new ticker is absent, so its later presence is the
    // refetch and not a fixture that always contained it.
    await expect(page.getByTestId("decision-card-4")).toHaveCount(0);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    await page.getByRole("button", { name: /record decision/i }).click();

    // The mock appends on POST, so this row can ONLY appear if the ["decisions"]
    // query was invalidated and refetched. Without the invalidation the list
    // stays on its cached three rows.
    await expect(page.getByTestId("decision-card-4")).toBeVisible();
    await expect(page.getByTestId("decision-card-4").getByText("AAPL")).toBeVisible();
    await expect(page.getByTestId("decision-card-4").getByText("services margin inflecting")).toBeVisible();
  });

  test("an empty memo is refused in the browser, before any request", async ({ page }) => {
    const stats = await mockDecisionsApi(page);
    await gotoDecisions(page);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("   ");
    await page.getByRole("button", { name: /record decision/i }).click();

    await expect(page.getByText(/a decision without a reason is a snapshot/i)).toBeVisible();
    expect(stats.posts).toHaveLength(0);
  });

  test("a server rejection leaves the log intact and does not clear the form", async ({ page }) => {
    await mockDecisionsApi(page, { postStatus: 422 });
    await gotoDecisions(page);

    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    await page.getByRole("button", { name: /record decision/i }).click();

    // `fetchApi` throws a GENERIC "API error: 422 Unprocessable Entity" and
    // never surfaces the server's `detail` (apps/web/lib/api.ts), so assert
    // that an error is shown -- never the server's wording, which cannot
    // reach this component.
    await expect(page.getByRole("alert")).toBeVisible();

    // The three existing decisions survive: a failed write must not look like
    // a successful one that emptied the log.
    await expect(page.getByTestId("decision-card-1")).toBeVisible();
    await expect(page.getByTestId("decision-card-2")).toBeVisible();
    await expect(page.getByTestId("decision-card-3")).toBeVisible();

    // The typed memo is still there to retry with, not silently discarded.
    await expect(page.getByLabel(/memo/i)).toHaveValue("services margin inflecting");
  });
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
```

Expected: FAIL — no `ticker` field exists.

- [ ] **Step 3: Write the component**

Create `apps/web/app/decisions/components/RecordDecisionForm.tsx`:

```tsx
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { fetchApi } from "@/lib/api";
import { DECISION_ACTIONS, type DecisionAction } from "../decisionTypes";

/**
 * Posts {ticker, action, memo} and NOTHING else. The server captures the
 * figures itself (spec 4): a browser-posted number could be stale or rounded
 * for display and would be stored as what the user believed, undetectably.
 * The request model is extra="forbid", so adding a field here is a 422.
 */
export function RecordDecisionForm() {
  const queryClient = useQueryClient();
  const [ticker, setTicker] = useState("");
  const [action, setAction] = useState<DecisionAction>("buy");
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: { ticker: string; action: string; memo: string }) =>
      fetchApi<{ id: number }>("/decisions", {
        method: "POST",
        body: JSON.stringify(body),
        monitor: { operation: "frontend.mutation.record_decision", component: "decisions_page" },
      }),
    onSuccess: () => {
      // The list and its computed outcomes both come from this key.
      void queryClient.invalidateQueries({ queryKey: ["decisions"] });
      setTicker("");
      setMemo("");
      setError(null);
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : "Could not record the decision."),
  });

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ticker.trim()) {
      setError("A ticker is required.");
      return;
    }
    if (!memo.trim()) {
      // Mirrors the server's own rule so the user sees it without a round trip.
      setError("A memo is required: a decision without a reason is a snapshot.");
      return;
    }
    setError(null);
    mutation.mutate({ ticker: ticker.trim(), action, memo: memo.trim() });
  };

  return (
    <section className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">Record a decision</h2>
      {/* A real <form>, not a click handler on a bare button: Enter submits,
          the controls are announced as a group, and the browser supplies the
          semantics instead of custom interaction code. */}
      <form onSubmit={submit} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Ticker
          <input
            value={ticker}
            onChange={(event) => setTicker(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Action
          <select
            value={action}
            onChange={(event) => setAction(event.target.value as DecisionAction)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
          >
            {DECISION_ACTIONS.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Memo
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]"
          />
        </label>
        <button
          type="submit"
          disabled={mutation.isPending}
          aria-busy={mutation.isPending}
          className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] disabled:opacity-50"
        >
          {mutation.isPending ? "Recording…" : "Record decision"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-xs text-[var(--chart-negative)]">{error}</p>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Render it from the page**

In `apps/web/app/decisions/page.tsx`, import `RecordDecisionForm` and place `<RecordDecisionForm />` directly below `<PageHeader ... />`.

- [ ] **Step 5: Run the tests and lint**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
npm.cmd run lint -- app/decisions
```

Expected: PASS, clean lint.

- [ ] **Step 6: Verify the payload test can actually fail**

Add `price_at_decision: 123.45` to the object passed to `mutation.mutate(...)` in `submit` (and widen the `mutationFn` parameter type so it compiles).

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "posts exactly ticker"
```

Expected: FAIL on the key-set assertion, listing the smuggled key. **Restore** and re-run green. This is the frontend half of the guarantee the backend enforces with `extra="forbid"`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/decisions apps/web/tests/e2e/decisions.spec.ts
git commit -m "feat: record a decision from the browser, posting no figures"
```

---

### Task 4: The scatter, and an honest account of what it could not plot

**Files:**
- Create: `apps/web/app/decisions/decisionChartData.ts`
- Create: `apps/web/app/decisions/components/DecisionOutcomeScatter.tsx`
- Modify: `apps/web/app/decisions/page.tsx`
- Test: `apps/web/tests/e2e/decisions.spec.ts`

**Interfaces:**
- Consumes: `DecisionRow` from Task 1.
- Produces: `partitionDecisions(decisions: DecisionRow[]): DecisionPartition`; `DecisionPoint`; `<DecisionOutcomeScatter decisions={DecisionRow[]} />`.

Only a decision with **both** `dcf_implied_return_pct` and `outcome.price_move_pct` non-null can be a point. In the real response captured above that is 1 of 3. A chart that draws one dot and says nothing about the other two misreports its inputs — the same defect class `ERROR-LOG.md` records three times, in a chart instead of a row. The coverage caption is therefore part of the chart, not decoration.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/tests/e2e/decisions.spec.ts`:

```ts
  test("exactly the plottable decision becomes a point, and it is the right one", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    const chart = page.getByTestId("decision-outcome-scatter");
    await expect(chart).toBeVisible();

    // Identity, not just arity: MSFT has both axes; NVDA has a gap but no move
    // yet; ZZTOP has neither. A count alone would pass if the WRONG decision
    // were plotted.
    await expect(chart.getByTestId("decision-point-MSFT")).toBeVisible();
    await expect(chart.getByTestId("decision-point-NVDA")).toHaveCount(0);
    await expect(chart.getByTestId("decision-point-ZZTOP")).toHaveCount(0);
  });

  test("the scatter states how many decisions it could not plot, and why", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    const chart = page.getByTestId("decision-outcome-scatter");
    await expect(chart).toBeVisible();

    // Positive control: a point actually rendered, so the counts below describe
    // a drawn chart rather than an empty one. NOTE: never assert on `circle`
    // generically -- Recharts' default mark is `<path class="recharts-symbols">`,
    // so such a control silently matches nothing. The testid comes from this
    // chart's custom shape.
    await expect(chart.getByTestId("decision-point-MSFT")).toBeVisible();

    // 1 of 3 plottable in the fixture: one awaiting a bar, one with no figures.
    await expect(chart.getByText(/1 of 3 decisions plotted/i)).toBeVisible();
    await expect(chart.getByText(/1 awaiting a later price bar/i)).toBeVisible();
    await expect(chart.getByText(/1 recorded without figures/i)).toBeVisible();
  });

  test("a log with nothing plottable says so instead of looking broken", async ({ page }) => {
    // The empty-chart path is otherwise unverified, and it is exactly the state
    // a new user is in: decisions recorded, no later bars yet. It must read as
    // "nothing to plot yet", never as an error and never as a blank panel.
    await mockDecisionsApi(page, { rows: [DECISION_FIXTURE[0], DECISION_FIXTURE[1]] });
    await gotoDecisions(page);

    const chart = page.getByTestId("decision-outcome-scatter");
    await expect(chart).toBeVisible();
    await expect(chart.getByText(/0 of 2 decisions plotted/i)).toBeVisible();
    await expect(chart.getByText(/1 awaiting a later price bar/i)).toBeVisible();
    await expect(chart.getByText(/1 recorded without figures/i)).toBeVisible();

    // Both decisions stay readable in the log below: excluding a row from the
    // chart must never remove it from the record.
    await expect(page.getByTestId("decision-card-2")).toBeVisible();
    await expect(page.getByTestId("decision-card-3")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("each half of the invariant excludes a decision on its own", async ({ page }) => {
    // The standard fixture's two excluded rows differ in BOTH fields at once,
    // so neither half of the plottability invariant is pinned by it alone --
    // the same trap the backend's two chained guards fell into (ERROR-LOG.md,
    // 2026-09-03). These two rows each differ in exactly one field.
    const gapOnly = {
      ...DECISION_FIXTURE[2], id: 11, ticker: "GAPONLY",
      outcome: { ...DECISION_FIXTURE[2].outcome, price_now: null, price_date: null,
                 price_move_pct: null, reason: "no bar with a close after 2026-09-04" },
    };
    const moveOnly = { ...DECISION_FIXTURE[2], id: 12, ticker: "MOVEONLY", dcf_implied_return_pct: null };

    await mockDecisionsApi(page, { rows: [gapOnly, moveOnly, DECISION_FIXTURE[2]] });
    await gotoDecisions(page);

    const chart = page.getByTestId("decision-outcome-scatter");
    await expect(chart.getByTestId("decision-point-MSFT")).toBeVisible();
    await expect(chart.getByTestId("decision-point-GAPONLY")).toHaveCount(0);
    await expect(chart.getByTestId("decision-point-MOVEONLY")).toHaveCount(0);
    await expect(chart.getByText(/1 of 3 decisions plotted/i)).toBeVisible();
    await expect(chart.getByText(/1 awaiting a later price bar/i)).toBeVisible();
    await expect(chart.getByText(/1 recorded without figures/i)).toBeVisible();
  });

  test("the chart asserts no relationship between the two axes", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    // Positive control first: an absence assertion against an unrendered chart
    // proves nothing (see corporate-probability-labels.spec.ts).
    const chart = page.getByTestId("decision-outcome-scatter");
    await expect(chart).toBeVisible();
    await expect(chart.getByTestId("decision-point-MSFT")).toBeVisible();

    // Spec 6: no trend line, no R-squared, no accuracy score, no error metric.
    // Each would assert the axes are commensurable; the gap has no horizon and
    // the move does.
    for (const forbidden of [/trend/i, /R²|R2\b/i, /accuracy/i, /regression/i, /correlation/i, /hit rate/i]) {
      await expect(page.getByText(forbidden)).toHaveCount(0);
    }
  });
```

These reference `DECISION_FIXTURE`, so widen the spec's import:

```ts
import { DECISION_FIXTURE, mockDecisionsApi } from "./helpers/decisionsPageMock";
```

- [ ] **Step 2: Run them and watch them fail**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
```

Expected: FAIL — `decision-outcome-scatter` does not exist.

- [ ] **Step 3: Write the pure partition**

Create `apps/web/app/decisions/decisionChartData.ts`:

```ts
import type { DecisionRow } from "./decisionTypes";

export interface DecisionPoint {
  id: number;
  ticker: string;
  /** Gap to fair value at decision, percent, NO horizon. */
  gapPct: number;
  /** Price move over decidedOn -> priceDate, percent. */
  movePct: number;
  decidedOn: string;
  priceDate: string;
}

export interface DecisionPartition {
  points: DecisionPoint[];
  total: number;
  /**
   * The model valued the ticker, but the outcome is unavailable. Named for the
   * STATE, not for today's cause of it: `outcome.reason` is a free-form string
   * and "no bar with a close after X" is only its current value. A field called
   * `awaitingBar` would bake one reason into the domain model and go quietly
   * wrong the day the API adds a second.
   */
  outcomeUnavailable: number;
  /** The model could not value the ticker at all, so there is no gap to plot. */
  figuresUnavailable: number;
}

/**
 * Split decisions into what can be a point and what cannot, keeping the counts.
 *
 * A point needs BOTH axes. Dropping the rest silently would let the chart
 * report on a subset while looking like it reports on the log -- so the counts
 * travel with the points and the caption renders them.
 */
export function partitionDecisions(decisions: DecisionRow[]): DecisionPartition {
  const points: DecisionPoint[] = [];
  let outcomeUnavailable = 0;
  let figuresUnavailable = 0;

  for (const decision of decisions) {
    const gapPct = decision.dcf_implied_return_pct;
    const movePct = decision.outcome.price_move_pct;
    const priceDate = decision.outcome.price_date;

    if (gapPct === null) {
      figuresUnavailable += 1;
      continue;
    }
    // The third clause is what narrows `priceDate` to `string`, so a point
    // cannot exist without the period it is measured over. See the
    // plottability invariant in the plan's Global Constraints.
    if (movePct === null || priceDate === null) {
      outcomeUnavailable += 1;
      continue;
    }
    points.push({
      id: decision.id,
      ticker: decision.ticker,
      gapPct,
      movePct,
      decidedOn: decision.outcome.decided_on,
      priceDate,
    });
  }

  return { points, total: decisions.length, outcomeUnavailable, figuresUnavailable };
}
```

- [ ] **Step 4: Write the chart**

Create `apps/web/app/decisions/components/DecisionOutcomeScatter.tsx`:

```tsx
"use client";

import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { CHART_COLORS, GRID_STYLE, fmtPctTick, withAxisProps, withTooltipProps } from "@/lib/chartConfig";
import { partitionDecisions, type DecisionPoint } from "../decisionChartData";
import type { DecisionRow } from "../decisionTypes";

/**
 * Recharts' default scatter mark is `<path class="recharts-symbols">`, NOT a
 * `<circle>` (node_modules/recharts/lib/shape/Symbols.js) -- so a test that
 * counts circles finds zero and a positive control built on one is broken
 * before it starts. A custom shape gives a real `<circle>` AND a per-point
 * testid, so a test can assert WHICH decision produced a point rather than
 * only how many exist.
 *
 * r=11 -> 22px diameter, at the ~24px hit-target floor the dataviz skill sets
 * for scatter marks. Affordable because a personal decision log holds tens of
 * points, not thousands.
 */
function DecisionDot({ cx, cy, payload }: { cx?: number; cy?: number; payload?: DecisionPoint }) {
  if (cx === undefined || cy === undefined || payload === undefined) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={11}
      fill={CHART_COLORS.primary}
      data-testid={`decision-point-${payload.ticker}`}
    />
  );
}

/**
 * Gap at decision (x) against price move since (y), one dot per decision.
 *
 * Deliberately NO trend line, R-squared, accuracy score or error metric
 * (spec 6). Each of those asserts the axes are commensurable: x is total
 * upside with no horizon, y is a move over a stated period. The scatter shows
 * whatever relationship exists without claiming one.
 *
 * Reference lines at x=0 and y=0 are quadrant dividers, not a fit -- they mark
 * the sign change on each axis independently and assert nothing about the pair.
 *
 * Single series, so no legend: the title names it (dataviz skill). Mark size
 * and the reason for the custom shape are documented on `DecisionDot` above.
 */
export function DecisionOutcomeScatter({ decisions }: { decisions: DecisionRow[] }) {
  const { points, total, outcomeUnavailable, figuresUnavailable } = partitionDecisions(decisions);

  // The partition reports STATES and counts; the wording lives here. Keeping
  // the sentences out of decisionChartData.ts is what lets that module stay a
  // data-semantics module rather than a presentation one.
  const excluded: string[] = [];
  if (outcomeUnavailable > 0) {
    excluded.push(`${outcomeUnavailable} awaiting a later price bar`);
  }
  if (figuresUnavailable > 0) {
    excluded.push(`${figuresUnavailable} recorded without figures`);
  }
  const coverage =
    `${points.length} of ${total} decisions plotted` +
    (excluded.length > 0 ? `; ${excluded.join("; ")}` : "") + ".";

  return (
    <section
      data-testid="decision-outcome-scatter"
      aria-labelledby="decision-scatter-title"
      aria-describedby="decision-scatter-coverage"
      className="mb-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5"
    >
      <h2 id="decision-scatter-title" className="text-sm font-bold text-[var(--text-primary)]">
        Gap at decision against price move since
      </h2>
      {/* Rendered as text, not only in a hover tooltip: the chart's meaning --
          including what it could NOT plot -- must be readable without pointing
          at anything. */}
      <p id="decision-scatter-coverage" className="mt-1 text-xs text-[var(--text-muted)]">
        {coverage}
      </p>
      <div className="mt-3 h-72 min-h-72 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
            <CartesianGrid {...GRID_STYLE} />
            <XAxis
              type="number"
              dataKey="gapPct"
              name="Gap at decision (no horizon)"
              {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })}
            />
            <YAxis
              type="number"
              dataKey="movePct"
              name="Price move since"
              {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })}
            />
            <ReferenceLine x={0} stroke="var(--chart-grid)" />
            <ReferenceLine y={0} stroke="var(--chart-grid)" />
            <Tooltip {...withTooltipProps({ cursor: { strokeDasharray: "3 3" } })} />
            <Scatter data={points} name="Decisions" shape={DecisionDot} />
          </ScatterChart>
        </ResponsiveChart>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Render it from the page**

In `apps/web/app/decisions/page.tsx`, import `DecisionOutcomeScatter` and place `<DecisionOutcomeScatter decisions={decisions} />` between `<RecordDecisionForm />` and `<DecisionList ... />`.

- [ ] **Step 6: Run the tests and lint**

```bash
cd apps/web && npm.cmd run test:e2e -- decisions.spec.ts
npm.cmd run lint -- app/decisions
```

Expected: PASS, clean lint.

- [ ] **Step 7: Verify the coverage caption is load-bearing**

Two mutations, one at a time, restoring between them.

**(a)** In `decisionChartData.ts`, change the `movePct === null || priceDate === null` branch body from `outcomeUnavailable += 1; continue;` to just `continue;` — the row still leaves the chart, but stops being counted.

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "could not plot"
```
Expected: FAIL on `/1 awaiting a later price bar/`. **Restore.**

**(b)** In `DecisionOutcomeScatter.tsx`, replace the caption with a bare `{points.length} decisions plotted`.

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "could not plot"
```
Expected: FAIL on `/1 of 3 decisions plotted/`. **Restore.**

**(c)** Drop the first half of the plottability invariant: change
`if (movePct === null || priceDate === null)` to `if (priceDate === null)`.

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "each half of the invariant"
```
Expected: FAIL — `decision-point-GAPONLY` renders, because a decision with no
move is no longer excluded. **Restore.**

**(d)** Drop the other half: change `if (gapPct === null)` to `if (false)`.

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "each half of the invariant"
```
Expected: FAIL — `decision-point-MOVEONLY` renders, plotting a decision whose
gap does not exist. **Restore** and re-run green.

Mutations (c) and (d) exist because the standard fixture's two excluded rows
differ in BOTH fields at once, so a single scenario cannot tell which half of
the invariant is wired. That is precisely how the backend's two chained guards
came to look pinned while each was independently deletable — see `ERROR-LOG.md`
2026-09-03. **Mutate chained conditions one at a time.**

- [ ] **Step 8: Verify the absence test can fail**

Add a trend line to the chart:

```tsx
<ReferenceLine segment={[{ x: -100, y: -100 }, { x: 100, y: 100 }]} label="Trend" />
```

```bash
npm.cmd run test:e2e -- decisions.spec.ts -g "asserts no relationship"
```

Expected: FAIL on `/trend/i` with count 1. **Restore** and re-run green. Without this the absence test could be passing against a page that never rendered.

- [ ] **Step 9: Commit**

```bash
git add apps/web/app/decisions apps/web/tests/e2e/decisions.spec.ts
git commit -m "feat: scatter the gap against the move, stating what it could not plot"
```

---

### Task 5: Whole-page verification and docs

**Files:**
- Modify: `guideline/sop/todo.md` (Track E, item E9)
- Test: the whole `apps/web/tests/e2e` suite and the Python suite

- [ ] **Step 1: Run the whole frontend e2e suite, not just this spec**

```bash
cd apps/web && npm.cmd run test:e2e
```

Expected: every pre-existing spec still passes. A new nav item changes the sidebar on every page, so a sidebar-sensitive spec can regress here — that is exactly what this step is for.

- [ ] **Step 2: Run the backend suite**

```bash
cd /c/Learn/Economy/MoneyView && python -m pytest -q
```

Expected: `954 passed`. Nothing in this plan touches Python; a failure means something unrelated moved.

- [ ] **Step 3: Lint the whole changed surface**

```bash
cd apps/web && npm.cmd run lint -- app/decisions components/ui/Sidebar.tsx tests/e2e/decisions.spec.ts tests/e2e/helpers/decisionsPageMock.ts
```

- [ ] **Step 4: Close E9 in the todo**

In `guideline/sop/todo.md`, change the `- [ ] **E9. The frontend.**` bullet to `- [x]` and record: the route, the three components, the partition module, the number of e2e tests, and — for each test that guards a spec rule — the mutation it was shown to catch. State plainly that **E7 (running the reset) and E8 (`GET /decisions/{id}`) remain open**; E9 does not close them.

- [ ] **Step 5: Commit**

```bash
git add guideline/sop/todo.md
git commit -m "docs: close Track E9, the decision log page"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| §4 `POST` takes `{ticker, action, memo}` and nothing else | Task 3 (asserted on the exact key set, mutation-verified) |
| §4 client never sends numbers | Task 3, Step 6 |
| §4 `GET` lists decisions newest first | Tasks 1–2 (the API already orders; the page preserves that order) |
| §4.1 outcome names both dates | Task 2 |
| §4.1 refuses with a reason rather than `0.0%` | Task 2, Step 6 |
| §6 two figures side by side, each labelled with its basis | Task 2 |
| §6 scatter, gap on x, move on y, one point per decision | Task 4 |
| §6 no trend line, no R², no accuracy, no error metric | Task 4, Step 8 |
| §6 load the `dataviz` skill before chart code | Done while writing this plan; its rules are baked into Task 4 — single series so no legend, marks well above the 8px floor and near the 24px hit-target, hover on by default, recessive grid, text in ink tokens rather than the series color, dark mode via the existing CSS-variable ramps |
| §8 one Playwright e2e covers the page | `decisions.spec.ts`, grown across Tasks 1–4 — 12 tests |
| §4 `GET /decisions/{id}` | **Not implemented — still no caller.** Tracked as E8; this plan does not close it |

**The UI state contract, and where each state is exercised**

| State | Test |
| --- | --- |
| loading | asserted implicitly — the loading branch is the only one that may render before data; the error/empty branches are guarded against it |
| request error | Task 3's server-rejection test asserts `role="alert"` and that the log survives |
| empty response | reachable via `mockDecisionsApi(page, { rows: [] })` |
| figures unavailable | Task 2, "a refusal renders its sentence" (ZZTOP) |
| outcome unavailable | Task 2, same test (NVDA); mutation-verified against a `+0.0%` render |
| both figures present | Task 2, "each figure is labelled with its own basis" (MSFT) |
| plottable | Task 4, "exactly the plottable decision becomes a point" — by identity, not count |
| excluded | Task 4, coverage caption + the all-excluded case + each invariant half separately |

**Why there is no direct unit test of `partitionDecisions`**

`apps/web` ships Playwright and no unit runner. Rather than add vitest — a
toolchain change this feature does not need — `mockDecisionsApi` takes a `rows`
override, so every partition boundary is reachable from the browser: the
all-excluded case, and one row differing in each half of the invariant. Steps
7(c) and 7(d) mutate the two halves separately, which is the coverage a direct
unit test would have provided. If a unit runner is added later for other
reasons, `partitionDecisions` is already a pure function and needs no change to
be tested directly.

**Deliberately not built**

- **Colouring points by action.** The spec says one point per decision and nothing about series. Four categorical hues would need palette validation and a legend, for a page that will hold tens of points. Cheap to add later if reading the chart shows it is needed.
- **A per-ticker "record decision" button on `/corporate`.** The spec does not place the control; one form on `/decisions` completes the feature with a single surface.
- **A unit test runner.** `apps/web` has Playwright only. Adding vitest is a toolchain decision, not part of this feature — so the pure `partitionDecisions` is exercised through the page rather than directly. See the section above for how each boundary is still reached.

**Type consistency check:** `DecisionRow`, `DecisionOutcome`, `DecisionAction`, `DECISION_ACTIONS` (Task 1) are used unchanged in Tasks 2–4. `partitionDecisions` / `DecisionPartition` / `DecisionPoint` (Task 4) are used only in Task 4. The field names `dcf_implied_return_pct`, `price_move_pct`, `figures_unavailable_reason`, `figures_source`, `outcome.reason`, `outcome.price_date`, `outcome.decided_on` all match the captured response above verbatim.

**Query keys:** one key, `["decisions"]`, written by Task 1 and invalidated by Task 3.
