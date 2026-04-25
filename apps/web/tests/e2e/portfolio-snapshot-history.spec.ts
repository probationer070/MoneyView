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

  const openSnapshotHistoryButton = page.getByRole("button", { name: "Open Snapshot History" });
  await openSnapshotHistoryButton.focus();
  await expect(openSnapshotHistoryButton).toBeFocused();
  await openSnapshotHistoryButton.click();
  const snapshotHistoryDialog = page.getByRole("dialog");
  await expect(snapshotHistoryDialog).toBeVisible();
  await expect(snapshotHistoryDialog.getByRole("button", { name: "Close modal" })).toBeFocused();
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

  await openSnapshotHistoryButton.click();
  await expect(snapshotHistoryDialog).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(snapshotHistoryDialog).toHaveCount(0);
  await expect(openSnapshotHistoryButton).toBeFocused();
});

test("portfolio snapshot and version identifiers stay bounded on narrow widths", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Latest Snapshot Summary")).toBeVisible();
  await expect(page.getByText(/Latest saved comparison snapshot loads automatically when holdings exist\.|Last updated/)).toBeVisible();

  await page.getByRole("button", { name: "Open Snapshot History" }).click();
  const snapshotHistoryDialog = page.getByRole("dialog");
  await expect(snapshotHistoryDialog).toBeVisible();
  const historyOverflow = await snapshotHistoryDialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(historyOverflow.scrollWidth).toBeLessThanOrEqual(historyOverflow.clientWidth + 1);

  await snapshotHistoryDialog.getByRole("button", { name: "Close modal" }).click();
  await expect(snapshotHistoryDialog).toHaveCount(0);

  await page.getByLabel("Stock browser search").fill("AAPL");
  await page.getByRole("button", { name: "Open Detail" }).first().click();
  const stockDetailDialog = page.getByRole("dialog");
  await expect(stockDetailDialog).toBeVisible();
  await expect(stockDetailDialog.getByText(/Saved snapshot metrics from/)).toBeVisible();
  await expect(stockDetailDialog.getByText(/Version/).first()).toBeVisible();
  const stockOverflow = await stockDetailDialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(stockOverflow.scrollWidth).toBeLessThanOrEqual(stockOverflow.clientWidth + 1);
});
