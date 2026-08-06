import { expect, test } from "@playwright/test";

test("market overview loads against the real local API", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Real-time snapshot of major global and domestic indices")).toBeVisible();
  await expect(page.getByText("S&P 500")).toBeVisible();
  await expect(page.getByText("^GSPC")).toBeVisible();
});

test("market overview detail works against the real local API with instrument-aware sections", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Volume" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Indicators" })).toBeVisible();
  await expect(page.getByText("Data Quality")).toBeVisible();
  await page.getByRole("button", { name: "Close modal" }).click();

  await page.getByRole("button", { name: "Open detail for Gold" }).click();
  await expect(page.getByRole("dialog", { name: "Gold" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Commodity Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Commodity Signals" })).toBeVisible();
  await page.getByRole("button", { name: "Close modal" }).click();

  await page.getByRole("button", { name: "Open detail for USD/KRW" }).click();
  await expect(page.getByRole("dialog", { name: "USD/KRW" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "FX Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily FX Signals" })).toBeVisible();
  await page.getByRole("button", { name: "Close modal" }).click();

  await page.getByRole("button", { name: "Open detail for Bitcoin" }).click();
  await expect(page.getByRole("dialog", { name: "Bitcoin" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Crypto Context" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily Crypto Signals" })).toBeVisible();
});
