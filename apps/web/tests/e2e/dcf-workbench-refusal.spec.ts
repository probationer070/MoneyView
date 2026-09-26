import { expect, test } from "@playwright/test";

/**
 * The /detail DCF workbench shows a refusal as content, and asks only once.
 *
 * AppProvider retries failed queries 3 times; a refusal is deterministic, so retrying it only
 * held the loading skeleton for ~7s and sent 4 identical POSTs. Like detail-chart-stability,
 * this needs AAPL history in the local database for the page to render.
 */
test("the workbench shows a refusal after one request, without retrying it", async ({ page }) => {
  let posts = 0;
  await page.route("**/api/v1/corporate/dcf/AAPL", (route) => {
    posts += 1;
    return route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "Free cash flow is zero or negative over the forecast, so the model cannot value it." } }),
    });
  });
  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Refresh DCF Diagnostics" }).click({ timeout: 60_000 });
  await expect(page.getByTestId("dcf-workbench-refusal")).toContainText("zero or negative over the forecast", { timeout: 4_000 });
  await page.waitForTimeout(1_500);
  expect(posts).toBe(1);
});
