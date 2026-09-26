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
  // `wacc_minus_terminal_growth` is a fraction. Rendered raw, the 0.083 below reads
  // "0.1%" where "8.3%" is meant -- an order-of-magnitude error in a figure sitting beside
  // a valuation, and one this repository has shipped before on the stock tile's weight
  // field. Asserting the absence of "0.1%" is what makes this test fail on that exact
  // defect rather than on some other string matching. Until it existed the `* 100` was
  // exercised by nothing.
  await mockCorporatePageApi(page, undefined, {
    dcfTerminalValueSharePct: 96.2,
    dcfWaccMinusTerminalGrowth: 0.083,
  });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(WARNING)).toContainText("8.3%");
  await expect(page.getByTestId(WARNING)).not.toContainText("0.1%");
});

test("the DCF request leaves terminal growth for the backend to derive", async ({ page }) => {
  // H8: the page used to send company growth as `terminal_growth_rate`, which the API
  // honours as an explicit override -- so the ceiling never applied and the single-ticker
  // valuation pinned 50bp under WACC. Omitting it is what lets the API apply the ceiling.
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  const request = page.waitForRequest(
    (req) => req.method() === "POST" && /\/corporate\/dcf\/AAPL(\/stream|\/report)?$/.test(new URL(req.url()).pathname),
  );
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  const body = (await request).postDataJSON() as Record<string, unknown>;
  expect(body).toHaveProperty("revenue_growth_rate");
  expect(body).not.toHaveProperty("terminal_growth_rate");
});

const BOUND = "terminal-growth-bound";

test("the terminal value share names the bound that set terminal growth", async ({ page }) => {
  // H11: the payload has said which bound decided g since 2026-09-11, and nothing read it.
  // A 96% share set by the long-run ceiling and one set by the WACC safety margin mean
  // different things: a judgement was applied, versus the arithmetic cornering the model.
  await mockCorporatePageApi(page, undefined, { dcfBindingConstraint: "ceiling" });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(BOUND)).toHaveText("Terminal growth set by the long-run ceiling");
});

test("each known bound has its own wording", async ({ page }) => {
  await mockCorporatePageApi(page, undefined, { dcfBindingConstraint: "wacc_safety" });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(BOUND)).toHaveText("Terminal growth set by the WACC safety margin");
});

test("an unrecognised bound is shown as sent, not hidden", async ({ page }) => {
  // The backend owns this vocabulary. A code added there before this map learns it must
  // still reach the reader, rather than the line disappearing as if nothing bound g.
  await mockCorporatePageApi(page, undefined, { dcfBindingConstraint: "new_bound" });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByTestId(BOUND)).toHaveText("Terminal growth set by new_bound");
});

test("no bound line when the backend could not name one", async ({ page }) => {
  // null means the reconstruction did not match the rate that ran (corporate_dcf.py), so
  // saying nothing is the honest answer. The default mock sends null.
  await mockCorporatePageApi(page, undefined, { dcfTerminalValueSharePct: 62.0 });
  await gotoCorporate(page);
  await page.getByRole("button", { name: "Refresh DCF" }).click();

  await expect(page.getByText("Terminal Value Share")).toBeVisible();
  await expect(page.getByTestId(BOUND)).toHaveCount(0);
});
