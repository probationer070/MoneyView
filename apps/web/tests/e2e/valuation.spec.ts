import { expect, test, type Page } from "@playwright/test";
import { mockValuationApi, ALL_COMPUTED_FIXTURE } from "./helpers/valuationPageMock";

async function gotoValuation(page: Page) {
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the valuation tab", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await expect(page.getByRole("link", { name: /Valuation/i })).toBeVisible();
  });

  test("no ticker chosen shows a prompt, not an empty panel", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await expect(page.getByTestId("verdict-panel")).toHaveCount(0);
    await expect(page.getByText(/choose a ticker/i)).toBeVisible();
  });

  test("a failed verdict request shows an error and no rows", async ({ page }) => {
    await mockValuationApi(page, { verdictStatus: 500 });
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    // Positive control: the error branch actually rendered.
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId("verdict-panel")).toHaveCount(0);
    await expect(page.getByTestId("verdict-row-drawdown")).toHaveCount(0);
  });

  test("each row is formatted in its own unit", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible();

    // drawdown is a FRACTION of the peak -> a percent.
    await expect(page.getByTestId("verdict-row-drawdown")).toContainText("-9.4%");

    // volume is a RATIO of two means -> a multiplier, NOT a percent.
    // Formatted as a percent this reads "119.5%" or "+19.5%", either of which
    // states something the number does not say.
    await expect(page.getByTestId("verdict-row-volume")).toContainText("×1.20");
    await expect(page.getByTestId("verdict-row-volume")).not.toContainText("119.5%");
    await expect(page.getByTestId("verdict-row-volume")).not.toContainText("19.5%");
  });

test("all four rows are formatted in their own unit when all four compute", async ({ page }) => {
    // VERDICT_FIXTURE refuses trailing_pe and dcf_gap, so this is the only test
    // that exercises those two formatter arms.
    await mockValuationApi(page, { panel: ALL_COMPUTED_FIXTURE });
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible();

    // trailing_pe is a bare multiple -> no "%", no "×".
    await expect(page.getByTestId("verdict-row-trailing_pe")).toContainText("24.3");
    await expect(page.getByTestId("verdict-row-trailing_pe")).not.toContainText("%");
    await expect(page.getByTestId("verdict-row-trailing_pe")).not.toContainText("×");

    // dcf_gap is a fraction of price -> a signed percent.
    await expect(page.getByTestId("verdict-row-dcf_gap")).toContainText("+18.2%");
  });

  test("the panel renders without waiting for the watchlist", async ({ page }) => {
    // The watchlist takes 2-3.5s in production because it fetches a live quote
    // per ticker. Suggestions are a convenience; the panel is the product.
    await mockValuationApi(page, { stallWatchlist: true });
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("a refused row renders its reason as content, not as a value", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    const pe = page.getByTestId("verdict-row-trailing_pe");
    await expect(pe).toBeVisible();
    await expect(pe).toContainText("no industry benchmark data has been loaded");
    // A refusal rendered as a number is indistinguishable from a real figure.
    await expect(pe).not.toContainText("0.0");
    await expect(pe).not.toContainText("×");
  });

  test("every row shows its full source, refused rows included", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible();

    // Computed: the full sentence, not a truncation.
    await expect(page.getByTestId("verdict-row-drawdown")).toContainText(
      "own window: last 252 of 2513 bars; peers: 8 of 8 within 2025-09-04..2026-09-03"
    );
    // Refused: source still names where the figure WOULD have come from.
    await expect(page.getByTestId("verdict-row-trailing_pe")).toContainText("Damodaran");
    await expect(page.getByTestId("verdict-row-dcf_gap")).toContainText("conservative case");
  });

  test("the comparison string is rendered verbatim", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    // Exactly as the backend wrote it -- that string is its attribution wording.
    await expect(page.getByTestId("verdict-row-drawdown")).toContainText("peer mean -12.9%");
  });

  test("the page invents no verdict of its own", async ({ page }) => {
    await mockValuationApi(page);
    await gotoValuation(page);
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");

    // Positive control first: an absence assertion against an unrendered page
    // proves nothing (see corporate-probability-labels.spec.ts).
    await expect(page.getByTestId("verdict-panel")).toBeVisible();
    await expect(page.getByTestId("verdict-row-drawdown")).toBeVisible();

    // `direction` is a fixed constant; the backend computes no verdict, and
    // four signals in four units cannot be rolled into one without inventing
    // a basis none of them share.
    for (const forbidden of [/\bundervalued\b/i, /\bovervalued\b/i, /\bscore\b/i,
                             /\bverdict:/i, /\brating\b/i, /\bsignals? passed\b/i]) {
      await expect(page.getByText(forbidden)).toHaveCount(0);
    }
    // The framing text itself IS shown, and says what it is testing.
    await expect(page.getByTestId("verdict-direction")).toContainText("Testing UNDERVALUATION");
  });
});
