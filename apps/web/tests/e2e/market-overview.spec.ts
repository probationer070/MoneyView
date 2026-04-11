import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

test("market overview renders deterministically from shared dashboard fixtures", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Real-time snapshot of major global and domestic indices")).toBeVisible();
  await expect(page.getByText("S&P 500")).toBeVisible();
  await expect(page.getByText("^GSPC")).toBeVisible();
  await expect(page.getByText("Nasdaq")).toBeVisible();
  await expect(page.getByText("^IXIC")).toBeVisible();
});
