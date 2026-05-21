import { expect, test } from "@playwright/test";

test("dev monitor renders mocked local events and exports visible rows as jsonl", async ({ page }) => {
  const recentEvents = [
    {
      id: "evt-1",
      timestamp: "2026-05-04T09:00:00Z",
      request_id: "req-monitor-1",
      parent_id: null,
      level: "info",
      scope: "api",
      operation: "api.request_complete",
      status: "success",
      duration_ms: 182.4,
      ticker: "AAPL",
      route: "/api/v1/portfolio/watchlist",
      method: "GET",
      table: null,
      provider: null,
      component: "portfolio",
      warning_code: null,
      error_code: null,
      message: "watchlist loaded",
      metadata: {},
    },
    {
      id: "evt-2",
      timestamp: "2026-05-04T09:00:01Z",
      request_id: "req-monitor-2",
      parent_id: null,
      level: "warn",
      scope: "data_quality",
      operation: "data_quality.roic",
      status: "warning",
      duration_ms: null,
      ticker: "AAPL",
      route: null,
      method: null,
      table: null,
      provider: "yfinance",
      component: "corporate_metric_audit",
      warning_code: "roic_suspicious",
      error_code: null,
      message: "ROIC sanity fallback triggered.",
      metadata: {
        metric: "roic",
        source_mode: "default_model",
        audit_link: "/corporate",
      },
    },
  ];

  await page.route("**/api/v1/dev/performance/recent?limit=200", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          events: recentEvents,
          limit: 200,
        },
        meta: {
          last_updated_at: "2026-05-04T09:00:00Z",
          request_id: "recent-request",
        },
      }),
    });
  });

  await page.route("**/api/v1/dev/performance/summary", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          active_requests: 0,
          avg_api_latency_ms: 182.4,
          p95_api_latency_ms: 182.4,
          slow_operations: 0,
          errors: 0,
          cache_hit_rate: 0.5,
        },
        meta: {
          last_updated_at: "2026-05-04T09:00:00Z",
          request_id: "summary-request",
        },
      }),
    });
  });

  await page.route("**/api/v1/dev/performance/slow?limit=100", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          events: [],
          limit: 100,
        },
        meta: {
          last_updated_at: "2026-05-04T09:00:00Z",
          request_id: "slow-request",
        },
      }),
    });
  });

  await page.route("**/api/v1/dev/log-stream", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify(recentEvents[0])}\n\n`,
    });
  });

  await page.goto("/dev/monitor", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Dev Monitor" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("api.request_complete").first()).toBeVisible();
  await expect(page.getByText("data_quality.roic").first()).toBeVisible();

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Live updates are paused")).toBeVisible();
  await page.getByRole("button", { name: "Resume live stream" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSONL" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/moneyview-dev-monitor-.*\.jsonl$/);
});
