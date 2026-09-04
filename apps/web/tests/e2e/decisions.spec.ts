import { expect, test, type Page } from "@playwright/test";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";

async function gotoDecisions(page: Page) {
  await page.goto("/decisions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Decision Log/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the decision log page", () => {
  test("the route renders and the sidebar links to it", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);
    await expect(page.getByRole("link", { name: /Decision Log/i })).toBeVisible();
  });

  test("each figure is labelled with its own basis, and the move names its period", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    const msft = page.getByTestId("decision-card-1");
    await expect(msft).toBeVisible();

    // The gap is horizonless and must say so -- it is NOT an annual return.
    await expect(msft.getByText(/gap to fair value at decision/i)).toBeVisible();
    await expect(msft.getByText(/no horizon/i)).toBeVisible();
    await expect(msft.getByText("+50.0%")).toBeVisible();

    // The move carries a stated period, both dates named (spec 4.1).
    await expect(msft.getByText(/price move/i)).toBeVisible();
    // The exact period, as ONE string. Asserting each date separately would
    // match the card's own decided-on header too, which is a Playwright
    // strict-mode violation -- and this way the two dates are pinned as a
    // travelling pair, which is what spec 4.1 actually requires.
    await expect(msft.getByText("2026-09-04 → 2099-01-01")).toBeVisible();
    await expect(msft.getByText("+20.0%")).toBeVisible();

    await expect(msft.getByText("cheap on FCF")).toBeVisible();
  });

  test("a refusal renders its sentence, never a zero and never a blank", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoDecisions(page);

    // Figures refused: the reason replaces the numbers.
    const zztop = page.getByTestId("decision-card-3");
    await expect(zztop.getByText(/the model cannot value it at this time/i)).toBeVisible();

    // Outcome pending: a flat 0.0% would be indistinguishable from a genuine
    // zero move, which is exactly what spec 4.1 forbids.
    //
    // Scoped to the "Price move" box, not the whole card: NVDA's own DCF gap
    // is "+50.0%" (same fixture value as MSFT's), and a card-wide substring
    // search for "0.0%" matches inside "+50.0%" too -- a false positive from
    // an unrelated figure, not the refusal this test targets.
    const nvda = page.getByTestId("decision-card-2");
    await expect(nvda.getByText(/no bar with a close after 2026-09-04/i)).toBeVisible();
    const priceMoveBox = nvda.getByText("Price move", { exact: true }).locator("..");
    await expect(priceMoveBox.getByText("0.0%")).toHaveCount(0);
  });
});
