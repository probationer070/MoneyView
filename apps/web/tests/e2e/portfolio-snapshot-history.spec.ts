import { expect, test } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

test("portfolio snapshot history modal renders timeline data deterministically", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Latest Snapshot Summary")).toBeVisible();
  await expect(page.getByLabel("Portfolio comparison universe")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark preset")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^KS11");

  await page.getByRole("button", { name: "Open Snapshot History" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Snapshot History" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "manual_refresh" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "scheduled_kst_daily" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2.86%" })).toBeVisible();
  await page.getByRole("button", { name: "Close snapshot history" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
