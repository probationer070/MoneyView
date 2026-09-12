import { expect, test, type Page } from "@playwright/test";

/**
 * The section's contract is that a reader can never see a theme figure without seeing what
 * produced it, and that a refused pair is visibly refused rather than absent or flat.
 */

// Market Overview renders from `apps/web/app/page.tsx`, so its route is `/` and not
// `/market`. Every existing spec for this page (market-overview.spec.ts) uses `/` too.
async function mockSpreads(page: Page, rows: unknown[]) {
  await page.route("**/api/v1/market/spreads**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

function computed(overrides: Record<string, unknown> = {}) {
  return {
    id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC",
    requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11",
    actual_window_days: 88, observations: 62,
    basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
    series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
    latest: 103.4, refused_reason: null,
    ...overrides,
  };
}

function refused(overrides: Record<string, unknown> = {}) {
  return {
    ...computed(),
    id: "defence", label: "Defence", numerator: "ITA", denominator: "^GSPC",
    actual_window_start: null, actual_window_end: null, actual_window_days: null,
    observations: 0, series: [], latest: null,
    refused_reason: "insufficient overlapping history",
    ...overrides,
  };
}

test("every spread card names the tickers and window that produced it", async ({ page }) => {
  // A figure labelled "AI +3.4%" asserts a fact about AI. "BOTZ vs ^GSPC" lets a reader
  // reject the proxy instead.
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("BOTZ");
  await expect(card).toContainText("^GSPC");
  await expect(card).toContainText("90d");
});

test("a refused pair keeps its card and shows the reason", async ({ page }) => {
  // Not an empty chart, not a line flat at 100 -- which is indistinguishable from a real
  // result showing no relative movement -- and never hidden.
  await mockSpreads(page, [computed(), refused()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-defence");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Unavailable");
  await expect(card).toContainText("insufficient overlapping history");
  await expect(card).toContainText("ITA");
  await expect(card.getByTestId("spread-chart-defence")).toHaveCount(0);
  await expect(card).not.toContainText("100.0");
});

test("a computed pair renders its latest value and its chart", async ({ page }) => {
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toContainText("103.4");
  await expect(card.getByTestId("spread-chart-ai")).toBeVisible();
});
