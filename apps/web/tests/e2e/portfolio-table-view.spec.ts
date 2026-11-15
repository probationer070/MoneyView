import { expect, test, type Page, type Request } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import type { PortfolioStockFixture } from "./fixtures/shared";

// The Stocks tab shows the same watchlist as cards or as a table (D6). Both views share one
// filter, one search and one follow handler; these tests pin that they do.

function stock(ticker: string, name: string, group: string, id: number): PortfolioStockFixture {
  return {
    ticker, name, sector: "Technology", group_name: group, weight: 0,
    last_close: 100 + id, delta: { delta_pct: 0.5 }, sparkline: [95, 97, 99, 100 + id], id, theme: "",
  };
}

const WATCHLIST = [
  stock("KEEP1", "Followed One", "custom", 1),
  stock("KEEP2", "Followed Two", "custom", 2),
  stock("REST1", "Rest One", "total", 3),
  stock("REST2", "Rest Two", "total", 4),
];

async function gotoStocks(page: Page) {
  await mockPortfolioPageApi(page, undefined, { watchlist: WATCHLIST });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("stock-tile-KEEP1")).toBeVisible({ timeout: 60_000 });
}

const showTable = (page: Page) => page.getByRole("button", { name: "Table", exact: true }).click();
const tableRow = (page: Page, ticker: string) => page.getByRole("tabpanel").locator("tbody tr", { hasText: ticker });

/** Collects what a follow click sends, so the two views can be compared request for request. */
function recordWrites(page: Page): string[] {
  const writes: string[] = [];
  page.on("request", (request: Request) => {
    if (request.method() !== "GET" && request.url().includes("/watchlist")) {
      writes.push(`${request.method()} ${new URL(request.url()).pathname} ${request.postData() ?? ""}`);
    }
  });
  return writes;
}

test("the toggle sits in a View group with Cards pressed by default", async ({ page }) => {
  await gotoStocks(page);
  const group = page.getByRole("group", { name: "View" });
  await expect(group.getByRole("button", { name: "Cards", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Table", exact: true })).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("tabpanel").locator("table")).toHaveCount(0);
});

test("the toggle is only on the Stocks tab", async ({ page }) => {
  await gotoStocks(page);
  await page.getByRole("tab", { name: "Weights", exact: true }).click();
  await expect(page.getByRole("group", { name: "View" })).toHaveCount(0);
});

test("pressing Table shows a table with a follow column", async ({ page }) => {
  await gotoStocks(page);
  await showTable(page);
  await expect(page.getByRole("button", { name: "Table", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("stock-tile-KEEP1")).toHaveCount(0);
  await expect(page.getByRole("columnheader", { name: "Follow", exact: true })).toBeVisible();
  // Default group filter is the followed group, so the unfollowed stock is not listed.
  await expect(tableRow(page, "KEEP1")).toBeVisible();
  await expect(tableRow(page, "REST1")).toHaveCount(0);
});

test("a row's star sends the same follow request as a tile's button", async ({ page }) => {
  await gotoStocks(page);
  const writes = recordWrites(page);

  await page.getByTestId("grid-filter").selectOption("all");
  await page.getByTestId("stock-tile-follow-REST1").click();
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  const fromTile = [...writes];
  writes.length = 0;

  // A second unfollowed stock, since the mock keeps the first one's new group across a reload.
  await showTable(page);
  await page.getByTestId("table-follow-REST2").click();
  await expect.poll(() => writes.length).toBeGreaterThan(0);
  expect(writes).toEqual(fromTile.map((write) => write.replace("REST1", "REST2")));
});

test("a click on the star does not open the stock modal, a click on the row does", async ({ page }) => {
  await gotoStocks(page);
  await showTable(page);
  await page.getByTestId("table-follow-KEEP1").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await tableRow(page, "KEEP2").click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("group filter and search narrow the table rows the way they narrow the cards", async ({ page }) => {
  await gotoStocks(page);
  await showTable(page);
  await page.getByTestId("grid-filter").selectOption("all");
  await expect(page.getByRole("tabpanel").locator("tbody tr")).toHaveCount(4);

  await page.getByTestId("grid-filter").selectOption("custom");
  await expect(page.getByRole("tabpanel").locator("tbody tr")).toHaveCount(2);

  await page.getByTestId("grid-search").fill("two");
  await expect(page.getByRole("tabpanel").locator("tbody tr")).toHaveCount(1);
  await expect(tableRow(page, "KEEP2")).toBeVisible();
  await expect(page.getByTestId("grid-count")).toHaveText("1 of 4 · 2 followed");
});

test("the chosen view survives a reload", async ({ page }) => {
  await gotoStocks(page);
  await showTable(page);
  await expect(tableRow(page, "KEEP1")).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Table", exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 60_000 });
  await expect(tableRow(page, "KEEP1")).toBeVisible();
});
