import { expect, test, type Page } from "@playwright/test";
import { stableInkProfile } from "./helpers/chartInk";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { FOMC_CATEGORY, mockEventsApi } from "./helpers/eventsApiMock";
import { addedColumns } from "./helpers/lineColor";

/**
 * One filter for every chart, remembered across reloads. Market Overview has several spread
 * charts and an index detail chart, so all three surfaces are exercised on one page.
 */

function spread(id: string, label: string) {
  return {
    id, label, numerator: "BOTZ", denominator: "^GSPC", requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
    basis: `(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15`,
    series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
    latest: 103.4, refused_reason: null,
  };
}

async function openOverview(page: Page, options: Parameters<typeof mockEventsApi>[1]) {
  await mockMarketPageApi(page);
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([spread("ai", "AI"), spread("cloud", "Cloud")]) }),
  );
  const state = await mockEventsApi(page, options);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("spread-chart-ai")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("spread-chart-cloud")).toBeVisible();
  return state;
}

const FOMC_EVENT = {
  id: "fomc-2026-06-15", label: "FOMC: hold at 3.50–3.75%", category: "fomc", start_date: "2026-06-15",
  source: "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260615a.htm",
};

test("unchecking a category removes its lines from every chart, and stays unchecked after a reload", async ({ page }) => {
  const state = await openOverview(page, { events: [FOMC_EVENT], categories: [FOMC_CATEGORY] });
  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/);

  const charts = ['[data-testid="spread-chart-ai"]', '[data-testid="spread-chart-cloud"]'];
  const withLines = await Promise.all(charts.map((chart) => stableInkProfile(page, chart)));

  await filter.click();
  await page.getByTestId("spreads-events-filter-option-fomc").uncheck();
  await expect(filter).toHaveText(/Events · 0 of 1/);
  await filter.click();

  for (const [index, chart] of charts.entries()) {
    const without = await stableInkProfile(page, chart);
    expect(addedColumns(withLines[index], without).length, `${chart}: the line is still drawn`).toBeGreaterThan(0);
  }
  expect(state.patches).toEqual([{ id: "fomc", body: { visible: false } }]);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("spreads-events-filter")).toHaveText(/Events · 0 of 1/, { timeout: 60_000 });
  const afterReload = await stableInkProfile(page, charts[0]);
  expect(addedColumns(withLines[0], afterReload).length, "after reload the line must still be hidden").toBeGreaterThan(0);

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog").getByTestId("market-events-filter"), "the modal shares the filter").toHaveText(/Events · 0 of 1/);
});

test("a failed categories request says Events unavailable while the charts still render", async ({ page }) => {
  await openOverview(page, { events: [FOMC_EVENT], categories: [FOMC_CATEGORY], categoriesStatus: 500 });

  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toHaveText("Events unavailable", { timeout: 15_000 });
  await expect.poll(() => page.locator('[data-testid="spread-chart-ai"] canvas').count()).toBeGreaterThan(0);

  await filter.click();
  await expect(page.getByTestId("spreads-events-filter-retry")).toBeVisible();
});

test("a failed filter save is undone and says so", async ({ page }) => {
  await openOverview(page, { events: [FOMC_EVENT], categories: [FOMC_CATEGORY] });
  await page.route("**/api/v1/market/event-categories/fomc", (route) =>
    route.request().method() === "PATCH" ? route.fulfill({ status: 500, body: "" }) : route.fallback(),
  );

  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/);
  await filter.click();
  await page.getByTestId("spreads-events-filter-option-fomc").uncheck();

  await expect(page.getByTestId("spreads-events-filter-error")).toBeVisible();
  await expect(filter).toHaveText(/Events · 1 of 1/);
  await expect(page.getByTestId("spreads-events-filter-option-fomc")).toBeChecked();
});
