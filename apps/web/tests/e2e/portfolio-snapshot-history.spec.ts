import { expect, test } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

test("portfolio snapshot history modal renders timeline data deterministically", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Latest Snapshot Summary")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved Snapshot List" })).toBeVisible();
  await expect(page.getByRole("button", { name: "View All Saved Snapshots" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await expect(page.getByText(/Refreshing portfolio comparison, snapshot history, and attribution\./)).toBeVisible();
  await expect(page.getByText(/(4\/11\/2026|Apr 11, 2026) - manual_refresh/)).toBeVisible();
  await expect(page.getByLabel("Portfolio comparison universe")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark preset")).toBeVisible();
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^GSPC");

  await page.getByRole("button", { name: "Open Snapshot History" }).click();
  const snapshotHistoryDialog = page.getByRole("dialog");
  await expect(snapshotHistoryDialog).toBeVisible();
  await expect(snapshotHistoryDialog.getByRole("heading", { name: "Snapshot History" })).toBeVisible();
  await expect(snapshotHistoryDialog.getByRole("heading", { name: "Locked Context" })).toBeVisible();
  await expect(snapshotHistoryDialog.getByText("Read-only review context")).toBeVisible();
  await expect(snapshotHistoryDialog.getByRole("heading", { name: "Grouped By Date" })).toBeVisible();
  await expect(snapshotHistoryDialog.getByText("manual_refresh snapshot")).toBeVisible();
  await expect(snapshotHistoryDialog.getByText("scheduled_kst_daily snapshot")).toBeVisible();
  await expect(snapshotHistoryDialog.getByText("2.86%").first()).toBeVisible();
  await snapshotHistoryDialog.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText("Deleted the selected saved snapshot.")).toBeVisible();
  await snapshotHistoryDialog.getByRole("button", { name: "Review Snapshot" }).first().click();
  await expect(page.getByText(/Reviewing saved snapshot from (4\/10\/2026|Apr 10, 2026)/)).toBeVisible();
  await page.getByRole("button", { name: "Clear History Selection" }).click();
});
