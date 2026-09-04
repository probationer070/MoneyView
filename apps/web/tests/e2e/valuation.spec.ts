import { expect, test, type Page } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

async function gotoValuation(page: Page) {
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the valuation tab", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await expect(page.getByRole("link", { name: /Valuation/i })).toBeVisible();
  });

  test("no ticker chosen shows a prompt, not an empty panel", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await expect(page.getByTestId("verdict-panel")).toHaveCount(0);
    await expect(page.getByText(/choose a ticker/i)).toBeVisible();
  });

  test("a failed verdict request shows an error and no rows", async ({ page }) => {
    await mockValuationApi(page, { verdictStatus: 500 });
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    // Positive control: the error branch actually rendered.
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("verdict-panel")).toHaveCount(0);
    await expect(page.getByTestId("verdict-row-drawdown")).toHaveCount(0);
  });
});
