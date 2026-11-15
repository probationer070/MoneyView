import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import type { PortfolioStockFixture } from "./fixtures/shared";

// The portfolio header shows one "Export" menu: Print PDF, then CSV. Both are built in the
// browser from the holdings the Stocks tab shows (owner D17); nothing is requested from the API.

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
];

async function gotoStocks(page: Page) {
  await mockPortfolioPageApi(page, undefined, { watchlist: WATCHLIST });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("stock-tile-KEEP1")).toBeVisible({ timeout: 60_000 });
}

function exportTrigger(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i += 1; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function downloadCsv(page: Page) {
  await exportTrigger(page, "Export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "CSV", exact: true }).click(),
  ]);
  const path = await download.path();
  return { name: download.suggestedFilename(), text: readFileSync(path, "utf8") };
}

test("the header shows one export trigger and no standalone export buttons", async ({ page }) => {
  await gotoStocks(page);
  await expect(exportTrigger(page, "Export")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Export JSON", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print PDF", exact: true })).toHaveCount(0);
});

test("the menu lists exactly Print PDF then CSV", async ({ page }) => {
  await gotoStocks(page);
  await exportTrigger(page, "Export").click();
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["Print PDF", "CSV"]);
});

test("CSV downloads the holdings shown, matching the table", async ({ page }) => {
  await gotoStocks(page);
  const apiCalls: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/report/export")) apiCalls.push(request.url()); });
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const closeText = await page.getByRole("tabpanel").locator("tbody tr", { hasText: "KEEP1" }).locator("td").nth(2).innerText();
  const tableClose = closeText.match(/\$[\d,.]+/)![0];

  const { name, text } = await downloadCsv(page);
  expect(name).toBe(`moneyview-holdings-${new Date().toISOString().slice(0, 10)}.csv`);
  expect(text.charCodeAt(0)).toBe(0xfeff);
  const rows = parseCsv(text.slice(1));
  expect(rows).toHaveLength(3); // header + the two followed holdings
  expect(rows[0][0]).toBe("Ticker");
  const keep1 = rows.find((row) => row[0] === "KEEP1")!;
  expect(keep1).toContain(tableClose);
  expect(rows.map((row) => row[0])).not.toContain("REST1");
  expect(apiCalls).toEqual([]);
});

test("searching narrows the CSV rows", async ({ page }) => {
  await gotoStocks(page);
  await page.getByTestId("grid-search").fill("KEEP2");
  await expect(page.getByTestId("stock-tile-KEEP1")).toHaveCount(0);
  const { text } = await downloadCsv(page);
  const rows = parseCsv(text.slice(1));
  expect(rows.map((row) => row[0])).toEqual(["Ticker", "KEEP2"]);
});

test("Print PDF opens a window holding the table rows and prints it", async ({ page, context }) => {
  await context.addInitScript(() => { (window as unknown as { __printed: number }).__printed = 0; window.print = () => { (window as unknown as { __printed: number }).__printed += 1; }; });
  await gotoStocks(page);
  await exportTrigger(page, "Export").click();
  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("menuitem", { name: "Print PDF", exact: true }).click(),
  ]);
  await expect(popup.locator("table tbody tr")).toHaveCount(2);
  await expect(popup.locator("table tbody tr", { hasText: "KEEP1" })).toHaveCount(1);
  expect(await popup.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBeGreaterThan(0);
});

test("Escape closes the export menu and returns focus to the trigger", async ({ page }) => {
  await gotoStocks(page);
  const trigger = exportTrigger(page, "Export");
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test.describe("ko locale", () => {
  test("the menu is 내보내기 with PDF 인쇄 then CSV", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "ko"));
    await gotoStocks(page);
    await expect(exportTrigger(page, "내보내기")).toHaveCount(1);
    await exportTrigger(page, "내보내기").click();
    await expect(page.getByRole("menu").getByRole("menuitem")).toHaveText(["PDF 인쇄", "CSV"]);
  });
});
