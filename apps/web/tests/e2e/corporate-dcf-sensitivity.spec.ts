import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// The WACC x terminal-growth grid, and the terminal-value share it is built to put a range
// around.
//
// Two absences in this table mean different things and must not render alike:
//
//   "n/a" -- WACC is not above terminal growth at that point, so the Gordon growth model has
//            no value there. A property of the assumptions, true for every ticker.
//   "—"   -- this ticker's equity bridge did not resolve, so there is no per-share value to
//            show. A property of the ticker, true at every point in the grid.
//
// The fixture's grid is 3x3 while the backend emits 5x5, so a component that hardcoded the
// axis length would fail here rather than silently drop columns.

const UNBRIDGED = "—";
const UNDEFINED = "n/a";

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

async function refreshDcf(page: Page) {
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect(page.getByRole("button", { name: /Intrinsic DCF/ }).first())
    .not.toContainText("Refresh to calculate", { timeout: 60_000 });
}

/** Loads the full report, which is what carries the grid, and opens the modal that shows it. */
async function openFullReport(page: Page) {
  await page.getByRole("button", { name: "View Full Report" }).click();
  const modal = page.getByRole("dialog").first();
  await expect(modal).toBeVisible({ timeout: 30_000 });
  await expect(modal.getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 });
  return modal;
}

/**
 * Locates a cell by its row and column headers rather than by index, so reordering an axis
 * cannot silently point an assertion at a different pair of assumptions.
 */
function gridCell(page: Page, waccLabel: string, growthLabel: string) {
  const q = (value: string) => `"${value}"`;
  const table = `//table[.//thead//th[contains(normalize-space(.), "WACC")]]`;
  const row = `${table}//tbody/tr[.//td[normalize-space(.)=${q(waccLabel)}]]`;
  const position = `count(${table}//thead//th[normalize-space(.)=${q(growthLabel)}]/preceding-sibling::th)+1`;
  return page.locator(`xpath=${row}/td[position()=${position}]`);
}

test.describe("the WACC x terminal-growth sensitivity grid", () => {
  test("the base cell reproduces the reported valuation and is the only one marked", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await refreshDcf(page);
    const modal = await openFullReport(page);

    // Base is WACC 4% / terminal growth 3%, carrying the report's own 240.5 per share and
    // 70.71% terminal share. A grid centred anywhere else would be bracketing a valuation
    // nobody ran.
    const base = gridCell(page, "4.0%", "3.0%");
    await expect(base).toContainText("240.5");
    await expect(base).toContainText("70.7");
    await expect(base).toContainText("Base");
    await expect(modal.getByText("Base", { exact: true })).toHaveCount(1);
  });

  test("every axis value in the payload gets a column", async ({ page }) => {
    // Pins the table to the data rather than to a fixed 5x5: the fixture is 3x3.
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await refreshDcf(page);
    await openFullReport(page);

    for (const [wacc, growth, value] of [
      ["3.0%", "2.0%", "264.0"],
      ["4.0%", "2.0%", "184.1"],
      ["5.0%", "4.0%", "232.1"],
    ]) {
      await expect(gridCell(page, wacc, growth)).toContainText(value);
    }
  });

  test("a cell where WACC is not above terminal growth carries no number at all", async ({ page }) => {
    // The service clamps this denominator to 0.005 for the headline valuation
    // (corporate_dcf.py:151). Inherited here it would print roughly 200x the terminal cash
    // flow -- a large, ordinary-looking valuation at a point where the model has none.
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await refreshDcf(page);
    await openFullReport(page);

    const undefinedCell = gridCell(page, "3.0%", "3.0%");
    await expect(undefinedCell).toContainText(UNDEFINED);
    await expect(undefinedCell).not.toContainText(UNBRIDGED);
    await expect(undefinedCell).toHaveAttribute("title", /Gordon growth model has no value/);

    // A defined cell in the same row proves the row rendered rather than the table being
    // blank, so "no number" is the rule at work and not an empty grid.
    await expect(gridCell(page, "3.0%", "2.0%")).not.toContainText(UNDEFINED);
  });

  test("an unresolved bridge suppresses per-share values but keeps the terminal share", async ({ page }) => {
    // Concentration is a property of the enterprise valuation, so it survives a bridge that
    // does not resolve. The per-share row does not -- and must not fall back to printing the
    // enterprise value, which is the whole invariant this codebase enforces elsewhere.
    await mockCorporatePageApi(page, undefined, { dcfBridgeQuality: "missing" });
    await gotoCorporate(page);
    await refreshDcf(page);
    const modal = await openFullReport(page);

    const bridged = gridCell(page, "3.0%", "2.0%");
    await expect(bridged).toContainText(UNBRIDGED);
    await expect(bridged).toContainText("74.1");
    // 1580.2 is this cell's enterprise value. It must not appear where a per-share value goes.
    await expect(bridged).not.toContainText("1,580.2");
    await expect(bridged).not.toContainText("1580.2");

    // An undefined cell stays undefined rather than being relabelled as an unbridged one:
    // the model has no value there whatever the bridge does.
    const undefinedCell = gridCell(page, "3.0%", "3.0%");
    await expect(undefinedCell).toContainText(UNDEFINED);
    await expect(undefinedCell).not.toContainText(UNBRIDGED);

    await expect(modal.getByText("Base", { exact: true })).toHaveCount(1);
  });

  test("the Terminal Value Share tile reports the backend measurement", async ({ page }) => {
    // It used to be clamp(62 + growth x 1.8 - WACC x 1.2, 20, 88), computed in the browser
    // from the assumption sliders and unrelated to any terminal value. The tile now shows
    // what the DCF measured: PV(terminal) / enterprise value.
    await mockCorporatePageApi(page);
    await gotoCorporate(page);

    const tile = page.getByRole("button", { name: /Terminal Value Share/ }).first();
    // No DCF has run yet, so there is no valuation to take a share of. The sliders alone
    // cannot produce one, which is exactly what the old formula pretended.
    await expect(tile).toContainText("N/A", { timeout: 60_000 });

    await refreshDcf(page);
    await expect(tile).toContainText("70.7");
  });
});
