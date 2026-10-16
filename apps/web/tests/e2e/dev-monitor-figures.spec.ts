import { expect, test } from "@playwright/test";

// The dev monitor's KPI figures keep their decimal places through formatNumber: a cache hit
// rate of 0.5 reads "50.0%" (one decimal, fraction in), and a 182.4 ms average reads "182.4 ms".
test("dev monitor KPI figures keep one decimal place", async ({ page }) => {
  await page.route("**/api/v1/dev/performance/recent?limit=200", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { events: [], limit: 200 }, meta: { last_updated_at: "2026-05-04T09:00:00Z", request_id: "recent-request" } }),
    }),
  );
  await page.route("**/api/v1/dev/performance/summary", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { active_requests: 0, avg_api_latency_ms: 182.4, p95_api_latency_ms: 182.4, slow_operations: 0, errors: 0, cache_hit_rate: 0.5 },
        meta: { last_updated_at: "2026-05-04T09:00:00Z", request_id: "summary-request" },
      }),
    }),
  );
  await page.route("**/api/v1/dev/performance/slow?limit=100", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { events: [], limit: 100 }, meta: { last_updated_at: "2026-05-04T09:00:00Z", request_id: "slow-request" } }),
    }),
  );
  await page.route("**/api/v1/dev/log-stream", (route) =>
    route.fulfill({ status: 200, contentType: "text/event-stream", body: ": no events\n\n" }),
  );

  await page.goto("/dev/monitor", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Dev Monitor" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Cache Hit Rate", { exact: true })).toBeVisible();

  await expect(page.getByText("50.0%", { exact: true })).toBeVisible();
  await expect(page.getByText("182.4 ms", { exact: true }).first()).toBeVisible();
});
