import { expect, test } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

/**
 * A terminal share of 96% and one of 60% used to render identically -- a plain
 * percentage, with nothing saying that one of them means the valuation is almost entirely
 * a single perpetuity assumption. The figure was visible throughout; it was not
 * information.
 */

const WARNING = "terminal-share-warning";

async function gotoCorporate(page: import("@playwright/test").Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({
    timeout: 60_000,
  });
}

test("a terminal share above the threshold is marked", async ({ page }) => {
  await mockCorporatePageApi(page, undefined, { dcfTerminalValueSharePct: 96.2 });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(WARNING)).toBeVisible();
});

test("an ordinary terminal share is not marked", async ({ page }) => {
  // The threshold has to discriminate. A warning on every valuation is wallpaper.
  await mockCorporatePageApi(page, undefined, { dcfTerminalValueSharePct: 62.0 });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(WARNING)).toHaveCount(0);
});

test("the spread renders as a percentage, not as the raw fraction", async ({ page }) => {
  // `wacc_minus_terminal_growth` is a fraction. Rendered raw it reads "0.5%" where "50%"
  // is meant -- an order-of-magnitude error in a figure sitting beside a valuation, and
  // one this repository has shipped before on the stock tile's weight field. Until this
  // test existed the `* 100` was exercised by nothing.
  await mockCorporatePageApi(page, undefined, {
    dcfTerminalValueSharePct: 96.2,
    dcfWaccMinusTerminalGrowth: 0.083,
  });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(WARNING)).toContainText("8.3%");
  await expect(page.getByTestId(WARNING)).not.toContainText("0.1%");
});
