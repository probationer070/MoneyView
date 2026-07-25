import { expect, test, type Page } from "@playwright/test";

const API = "**/api/v1/dev/performance/**";

const EMPTY_INDEX = { requests: [], limit: 50, buffer_used: 0, buffer_limit: 20000 };
const EMPTY_BREAKDOWN = { scopes: [], total_ms: 0, unattributed_ms: 0, overlap_detected: false };
const EMPTY_TICKER_TABLE = {
  rows: [], ticker_count: 0, total_self_ms: 0, p50_ms: 0, p95_ms: 0, max_ms: 0, cv: 0,
  distribution: "uniform",
};
const EMPTY_CACHE = { caches: [] };

function spanNode(overrides: Record<string, unknown> = {}) {
  return {
    id: "root", parent_id: null, operation: "api.request", scope: "api", status: "success",
    total_ms: 100, self_ms: 40, offset_ms: 0, clock_skew: false, orphaned: false,
    ticker: null, table: null, component: null, rows: null, bytes: null,
    series_points: null, cache_state: null, children: [], ...overrides,
  };
}

// Each of these always fires on page load (requests, breakdown, by-ticker, cache).
// Registering one narrow glob per endpoint -- rather than a broad catch-all
// alongside a specific one -- avoids depending on Playwright's route
// registration-order precedence (see task-12 brief, correction 8).
async function mockDefaults(page: Page, overrides: Partial<{
  requests: unknown;
  breakdown: unknown;
  byTicker: unknown;
  cache: unknown;
}> = {}) {
  await page.route("**/performance/requests*", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ data: overrides.requests ?? EMPTY_INDEX }) })
  );
  await page.route("**/performance/breakdown*", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ data: overrides.breakdown ?? EMPTY_BREAKDOWN }) })
  );
  await page.route("**/performance/by-ticker*", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ data: overrides.byTicker ?? EMPTY_TICKER_TABLE }) })
  );
  await page.route("**/performance/cache*", (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ data: overrides.cache ?? EMPTY_CACHE }) })
  );
}

test("renders the disabled state, not an error, when instrumentation is off", async ({ page }) => {
  await page.route(API, (route) => route.fulfill({ status: 404, body: "{}" }));
  await page.goto("/dev/performance");
  await expect(page.getByText("Instrumentation disabled")).toBeVisible();
  await expect(page.getByText(/MONEYVIEW_DEV_MONITOR=true/)).toBeVisible();
});

test("renders the empty state when the buffer holds nothing", async ({ page }) => {
  await mockDefaults(page);
  await page.goto("/dev/performance");
  await expect(page.getByText("No requests recorded yet")).toBeVisible();
});

test("shows the buffer-full badge as a diagnostic, not an error", async ({ page }) => {
  await mockDefaults(page, { requests: { ...EMPTY_INDEX, buffer_used: 20000 } });
  await page.goto("/dev/performance");
  await expect(page.getByText(/buffer full/)).toBeVisible();
});

test("renders a collapsed node rather than an absence", async ({ page }) => {
  await mockDefaults(page, {
    requests: {
      ...EMPTY_INDEX,
      buffer_used: 5,
      requests: [{
        request_id: "req-1", route: "/x", method: "GET", started_at: new Date().toISOString(),
        ended_at: null, total_ms: 100, span_count: 3, ticker_count: 0, status: "success", partial: false,
      }],
    },
  });
  await page.route("**/performance/waterfall/*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          request_id: "req-1", route: "/x", total_ms: 100, span_count: 3,
          partial: false, truncated: true, overlap_detected: false,
          root: spanNode({
            children: [{ collapsed_count: 27, total_ms: 340, deepest_scope: "db" }],
          }),
        },
      }),
    })
  );
  await page.goto("/dev/performance");
  await page.getByText("/x").click();
  await expect(page.getByText(/27 spans collapsed/)).toBeVisible();
  await expect(page.getByText(/truncated at 2,000 spans/)).toBeVisible();
});

test("clock_skew renders a marker and never a negative-width bar", async ({ page }) => {
  await mockDefaults(page, {
    requests: {
      ...EMPTY_INDEX, buffer_used: 2,
      requests: [{
        request_id: "req-1", route: "/x", method: "GET", started_at: new Date().toISOString(),
        ended_at: null, total_ms: 100, span_count: 2, ticker_count: 0, status: "success", partial: true,
      }],
    },
  });
  await page.route("**/performance/waterfall/*", (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: {
          request_id: "req-1", route: "/x", total_ms: 100, span_count: 2,
          partial: true, truncated: false, overlap_detected: false,
          root: spanNode({
            children: [spanNode({ id: "c", operation: "skewed", parent_id: "root", clock_skew: true, offset_ms: 0, total_ms: 10, self_ms: 10 })],
          }),
        },
      }),
    })
  );
  await page.goto("/dev/performance");
  await page.getByText("/x").click();
  await expect(page.getByText(/partial/).first()).toBeVisible();
  const widths = await page.locator(".absolute.h-3").evaluateAll((nodes) =>
    nodes.map((node) => Number.parseFloat((node as HTMLElement).style.width))
  );
  expect(widths.every((width) => width >= 0)).toBe(true);
});

test("overlap_detected renders a note and a non-negative unattributed value", async ({ page }) => {
  await mockDefaults(page, {
    breakdown: {
      scopes: [{ scope: "db", self_ms: 80, pct_of_total: 80, event_count: 2, slow_count: 0 }],
      total_ms: 100, unattributed_ms: 0, overlap_detected: true,
    },
  });
  await page.goto("/dev/performance");
  await expect(page.getByText(/spans overlapped/)).toBeVisible();
  await expect(page.getByText(/unattributed 0\.0 ms/)).toBeVisible();
});

test("per-stock panel leads with distribution and keeps the table collapsed", async ({ page }) => {
  await mockDefaults(page, {
    byTicker: {
      rows: [{ ticker: "AAPL", self_ms: 20, span_count: 2, db_ms: 12, calculation_ms: 8,
               external_ms: 0, cache_hits: 0, cache_misses: 0, rows_read: 863,
               bytes: null, series_points: 862 }],
      ticker_count: 138, total_self_ms: 2847, p50_ms: 18.2, p95_ms: 24.1,
      max_ms: 31, cv: 0.09, distribution: "uniform",
    },
  });
  await page.goto("/dev/performance");
  const panel = page.getByTestId("per-stock-panel");
  await expect(panel.getByText("uniform")).toBeVisible();
  await expect(panel.getByText(/p50 18\.2 ms/)).toBeVisible();
  await expect(panel.getByText("AAPL")).toBeHidden();
});

test("the dashboard does not instrument its own requests", async ({ page }) => {
  const clientEvents: string[] = [];
  await page.route("**/performance/client-event", (route) => {
    clientEvents.push(route.request().url());
    return route.fulfill({ status: 200, body: "{}" });
  });
  await mockDefaults(page);
  await page.goto("/dev/performance");
  await expect(page.getByText("No requests recorded yet")).toBeVisible();
  expect(clientEvents).toHaveLength(0);
});
