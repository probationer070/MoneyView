import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { stableInkProfile } from "./helpers/chartInk";
import { FOMC_CATEGORY, GEOPOLITICAL, mockEventsApi, setAllEventCategories, type MockEvent } from "./helpers/eventsApiMock";
import { addedColumns, colorDistance, columnRuns, lineColorAt, pagePointForColumn } from "./helpers/lineColor";

const CHART = '[role="dialog"] [data-testid="tv-chart"]';
const FILTER = "chart-events-filter";
const BARS = [
  "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27",
  "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
];

async function openChartWith(page: Page, events: MockEvent[], categories = [GEOPOLITICAL, FOMC_CATEGORY]) {
  await mockPortfolioPageApi(page);
  await page.route("**/api/v1/portfolio/stock/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ticker: "AAPL",
        prices: BARS.map((date, i) => ({ date, open: 100 + i, high: 106 + i, low: 98 + i, close: 102 + i, volume: 1_000_000 })),
        news: [],
      }),
    }),
  );
  await mockEventsApi(page, { events, categories });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("stock-tile-AAPL").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByTestId(FILTER)).toHaveText(new RegExp(`Events · ${categories.length} of ${categories.length}`));
  return dialog;
}

/** Each line's centre column, found by diffing the canvas against every category hidden. */
async function lineCentres(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const withLines = await stableInkProfile(page, CHART);
  await setAllEventCategories(dialog, FILTER, false);
  const without = await stableInkProfile(page, CHART);
  await setAllEventCategories(dialog, FILTER, true);
  await expect.poll(async () => JSON.stringify((await stableInkProfile(page, CHART)).ink)).toBe(JSON.stringify(withLines.ink));
  return columnRuns(addedColumns(withLines, without)).map((run) => ({ first: run[0], centre: run[Math.floor(run.length / 2)] }));
}

test("hovering an event line shows its label, date, category and source", async ({ page }) => {
  const dialog = await openChartWith(page, [
    { id: "iran", label: "U.S. strikes on Iran begin", category: "geopolitical", start_date: "2026-02-28", source: "https://en.wikipedia.org/wiki/Timeline", note: "Operation Epic Fury." },
  ]);
  const [line] = await lineCentres(page, dialog);
  expect(line, "no line was drawn to hover").toBeDefined();

  const tooltip = page.getByTestId("event-tooltip");
  await expect(tooltip, "no tooltip before hovering").toHaveCount(0);
  const point = await pagePointForColumn(page, CHART, line.centre);
  await page.mouse.move(point.x, point.y);

  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("U.S. strikes on Iran begin");
  await expect(tooltip).toContainText("2026-02-28 · Geopolitical");
  await expect(tooltip).toContainText("Operation Epic Fury.");
  await expect(tooltip).toContainText("Source: en.wikipedia.org");

  await page.mouse.move(point.x + 60, point.y);
  await expect(tooltip, "the tooltip leaves with the pointer").toHaveCount(0);
});

test("a user's own unsourced event says so in its tooltip", async ({ page }) => {
  const dialog = await openChartWith(page, [
    { id: "user-1", label: "Bought more", category: "geopolitical", start_date: "2026-03-03", origin: "user", source: null },
  ]);
  const [line] = await lineCentres(page, dialog);
  const point = await pagePointForColumn(page, CHART, line.centre);
  await page.mouse.move(point.x, point.y);

  await expect(page.getByTestId("event-tooltip")).toContainText("Added by you, no source");
});

test("each category's line is painted in that category's colour", async ({ page }) => {
  const dialog = await openChartWith(page, [
    { id: "iran", label: "Iran", category: "geopolitical", start_date: "2026-02-24", source: "https://example.com/a" },
    { id: "fomc-2026-03-04", label: "FOMC", category: "fomc", start_date: "2026-03-04", source: "https://example.com/b" },
  ]);
  const lines = await lineCentres(page, dialog);
  expect(lines, "expected two separate lines").toHaveLength(2);

  const [left, right] = lines;
  const leftColor = await lineColorAt(page, CHART, left.first);
  const rightColor = await lineColorAt(page, CHART, right.first);
  expect(leftColor && colorDistance(leftColor, GEOPOLITICAL.color), `left line is ${leftColor}`).toBeLessThanOrEqual(12);
  expect(rightColor && colorDistance(rightColor, FOMC_CATEGORY.color), `right line is ${rightColor}`).toBeLessThanOrEqual(12);
});
