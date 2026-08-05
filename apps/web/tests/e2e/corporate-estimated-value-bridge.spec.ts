import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// The invariant under test, stated as a quantity rather than a field name:
//
//   A number presented under an "Intrinsic DCF Value" / "Fair Value" label must be an
//   intrinsic value per share, and a percentage presented as upside must have been computed
//   against one.
//
// When the equity bridge does not resolve, corporate_dcf.py:222 falls estimated_value back to
// enterprise value and :224 sets upside_pct to a hardcoded 0.0. Both then render as ordinary,
// plausible numbers. Phase 2b enforced this for the field named dcf_value; these tests cover
// the same quantity where it ships as estimated_value.
//
// Note every assertion pairs a suppression check with a positive one. `estimated` is a real
// per-share value, so a guard written `!== "ok"` would suppress it -- these tests fail against
// that specific wrong implementation rather than passing on an empty page.

const PLACEHOLDER = "—";

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

// The DCF is not fetched on load -- the tile reads "Refresh to calculate" until asked, the
// same way the comparison query stays disabled until "Refresh comparison" is clicked.
async function refreshDcf(page: Page) {
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect(page.getByRole("button", { name: /Intrinsic DCF/ }).first())
    .not.toContainText("Refresh to calculate", { timeout: 60_000 });
}

// The comparison query stays disabled until the user asks for it (comparisonQuery's `enabled`
// guard in app/corporate/page.tsx), and the bulk report button stays disabled until rows land.
async function loadBulkReports(page: Page) {
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "MISS" }).first()).toBeVisible({ timeout: 60_000 });
  const bulkButton = page.getByRole("button", { name: /Calculate All DCF Reports/i });
  await expect(bulkButton).toBeEnabled({ timeout: 60_000 });
  await bulkButton.click();
}

// Locates a cell by its column's header text rather than by index, so a column reorder cannot
// silently point this at the wrong number.
function bulkCell(page: Page, ticker: string, columnHeader: string) {
  const q = (value: string) => `"${value}"`;
  const table = `//table[.//thead//th[normalize-space(.)=${q("Fair Value")}]]`;
  const row = `${table}//tbody/tr[.//td[normalize-space(.)=${q(ticker)}]]`;
  const position = `count(${table}//thead//th[normalize-space(.)=${q(columnHeader)}]/preceding-sibling::th)+1`;
  return page.locator(`xpath=${row}/td[position()=${position}]`);
}

test.describe("estimated_value is suppressed when the equity bridge does not resolve", () => {
  test("the Intrinsic DCF tile and its detail modal both suppress an unbridged value", async ({ page }) => {
    await mockCorporatePageApi(page, undefined, { dcfBridgeQuality: "missing" });
    await gotoCorporate(page);
    await refreshDcf(page);

    // The tile is a button whose body is the value; the enterprise value it would otherwise
    // show is 1462.4, which formats as $1,462.4 and reads as an ordinary share price.
    const tile = page.getByRole("button", { name: /Intrinsic DCF/ }).first();
    await expect(tile).toContainText(PLACEHOLDER, { timeout: 60_000 });
    await expect(tile).not.toContainText("1,462.4");

    // The modal behind that tile is where a reader goes to find out why the number is absent.
    // Before this change it printed the enterprise value three times under "Intrinsic DCF
    // Value", so clicking the placeholder disclosed exactly what the placeholder withheld.
    await tile.click();
    const modal = page.getByRole("dialog").first();
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await expect(modal).not.toContainText("1,462.4");
    await expect(modal).toContainText(PLACEHOLDER);
  });

  test("an unbridged upside is suppressed rather than shown as 0.0%", async ({ page }) => {
    await mockCorporatePageApi(page, undefined, { dcfBridgeQuality: "missing" });
    await gotoCorporate(page);
    await refreshDcf(page);

    const tile = page.getByRole("button", { name: /Intrinsic DCF/ }).first();
    await expect(tile).toContainText(PLACEHOLDER, { timeout: 60_000 });
    await tile.click();
    const modal = page.getByRole("dialog").first();
    await expect(modal).toBeVisible({ timeout: 30_000 });

    // upside_pct is 0.0 here, not absent. "0.0%" reads as a computed, fairly-valued result.
    const upsideRow = modal.locator("xpath=//*[normalize-space(.)='Upside / Downside']/following-sibling::*[1]").first();
    await expect(upsideRow).toHaveText(PLACEHOLDER);
  });

  test("a bridged value is still shown, including an estimated one", async ({ page }) => {
    // Guards against over-suppression: with the guard written `!== \"ok\"` this test fails,
    // and with no guard at all the previous two fail. Both directions are pinned.
    await mockCorporatePageApi(page, undefined, { dcfBridgeQuality: "estimated" });
    await gotoCorporate(page);
    await refreshDcf(page);

    const tile = page.getByRole("button", { name: /Intrinsic DCF/ }).first();
    await expect(tile).toContainText("240.5", { timeout: 60_000 });
    await expect(tile).not.toContainText(PLACEHOLDER);
  });

  test("the bulk report table suppresses only the unbridged row", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await loadBulkReports(page);

    await expect(bulkCell(page, "AAPL", "Fair Value")).not.toHaveText(PLACEHOLDER, { timeout: 60_000 });

    // MISS has no bridge: both its value and its upside are withheld.
    await expect(bulkCell(page, "MISS", "Fair Value")).toHaveText(PLACEHOLDER);
    await expect(bulkCell(page, "MISS", "Upside")).toHaveText(PLACEHOLDER);

    // ESTM's bridge is estimated, which is a real per-share value and must survive. Without
    // this the whole column could be blanked and the test above would still pass.
    await expect(bulkCell(page, "ESTM", "Fair Value")).not.toHaveText(PLACEHOLDER);
    await expect(bulkCell(page, "ESTM", "Upside")).not.toHaveText(PLACEHOLDER);
  });
});
