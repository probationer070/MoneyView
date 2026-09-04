import { expect, test, type Page } from "@playwright/test";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";

async function gotoDecisions(page: Page) {
  await page.goto("/decisions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Decision Log/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the decision log page", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);
    await expect(page.getByRole("link", { name: /Decision Log/i })).toBeVisible();
  });
});
