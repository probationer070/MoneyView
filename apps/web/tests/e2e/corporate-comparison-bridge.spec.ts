import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// XPath string literals: ticker and column-header values used here never contain a
// double quote, so a plain wrap is safe.
function xp(value: string) {
  return `"${value}"`;
}

// Locates the DCF Value cell (or any other column) for a given ticker's row by the
// column's header text, not its index, so a column reorder cannot silently break the
// locator. The column's position is computed from the header row at resolution time,
// via XPath's `preceding-sibling` count, so this stays a plain Locator -- chainable and
// awaitable exactly like `page.getByRole(...)` -- rather than a Promise.
function rowCell(page: Page, ticker: string, columnHeader: string) {
  const table = `//table[.//thead//th[normalize-space(.)=${xp(columnHeader)}]]`;
  const row = `${table}//tbody/tr[.//td[normalize-space(.)=${xp(ticker)}]]`;
  const columnPosition = `count(${table}//thead//th[normalize-space(.)=${xp(columnHeader)}]/preceding-sibling::th)+1`;
  return page.locator(`xpath=${row}/td[position()=${columnPosition}]`);
}

async function gotoComparison(page: Page) {
  // The comparison query stays disabled until the user explicitly requests a refresh
  // (see comparisonQuery's `enabled` guard in app/corporate/page.tsx), so a bare
  // navigation never fetches rows.
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "MISS" }).first()).toBeVisible({ timeout: 60_000 });
}

test("a row whose bridge did not resolve shows no DCF value", async ({ page }) => {
  // dcf_value falls back to enterprise value when the bridge does not resolve. That is a
  // different financial quantity from an intrinsic value per share -- not a smaller one --
  // so it cannot appear in a $/share column however close the numbers happen to fall.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(rowCell(page, "MISS", "DCF Value")).toHaveText("—");
});

test("an estimated bridge still shows its value", async ({ page }) => {
  // The guard must be `=== "missing"`, never `!== "ok"`. An estimated row's number IS an
  // intrinsic value per share -- the fallback source affects confidence, not units -- and
  // a test that only distinguishes ok from missing would pass against the wrong check.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(rowCell(page, "ESTM", "DCF Value")).not.toHaveText("—");
  await expect(rowCell(page, "ESTM", "DCF Value")).toContainText("$");
});

test("the suppressed cell still opens its calculation detail", async ({ page }) => {
  // The cell is a button onto the modal that explains WHY there is no value
  // (CalculationDetailModal renders bridge quality). Disabling it would take the
  // explanation away along with the number.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await rowCell(page, "MISS", "DCF Value").getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
