import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { json } from "./helpers/mockUtils";

// The portfolio header used to show four export buttons side by side. It now shows one
// "Export" menu whose items are PDF print first, a separator, then CSV, JSON and Markdown.

async function gotoGrid(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

function exportTrigger(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

test("the header shows one export trigger and no standalone export buttons", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await expect(exportTrigger(page, "Export")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Export JSON", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Print PDF", exact: true })).toHaveCount(0);
});

test("the menu lists PDF print first, then a separator, then CSV, JSON and Markdown", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await exportTrigger(page, "Export").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText(["Print PDF", "Export CSV", "Export JSON", "Export Markdown"]);
  await expect(menu.getByRole("separator")).toHaveCount(1);
  const children = await menu.locator("> *").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("role")));
  expect(children).toEqual(["menuitem", "separator", "menuitem", "menuitem", "menuitem"]);
});

test("choosing Export CSV requests the csv report and downloads it", async ({ page }) => {
  await mockPortfolioPageApi(page);
  let requestedFormat: string | undefined;
  await page.route("**/report/export", async (route) => {
    requestedFormat = (route.request().postDataJSON() as { format?: string }).format;
    await json(route, {
      status: "ok",
      data: { filename: "portfolio-report.csv", content_type: "text/csv", content: "ticker,weight\nAAPL,1\n" },
    });
  });
  await gotoGrid(page);

  await exportTrigger(page, "Export").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: "Export CSV", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("portfolio-report.csv");
  expect(requestedFormat).toBe("csv");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("Escape closes the export menu and returns focus to the trigger", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  const trigger = exportTrigger(page, "Export");
  await trigger.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test.describe("ko locale", () => {
  test("the export trigger is labelled 내보내기", async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "ko"));
    await mockPortfolioPageApi(page);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

    await expect(exportTrigger(page, "내보내기")).toHaveCount(1, { timeout: 60_000 });
    await exportTrigger(page, "내보내기").click();
    await expect(page.getByRole("menuitem", { name: "PDF 인쇄", exact: true })).toBeVisible();
  });
});
