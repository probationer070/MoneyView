import { expect, test } from "@playwright/test";

test("market overview loads against the real local API", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Real-time snapshot of major global and domestic indices")).toBeVisible();
  await expect(page.getByText("S&P 500")).toBeVisible();
  await expect(page.getByText("^GSPC")).toBeVisible();
});
