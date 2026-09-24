import { expect, test, type Page } from "@playwright/test";
import { mockCasesApi } from "./helpers/casesApiMock";
import { mockValuationApi } from "./helpers/valuationPageMock";

async function gotoCases(page: Page, query = "") {
  await page.goto(`/cases${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Cases$/ })).toBeVisible({ timeout: 60_000 });
}

test.describe("the cases list", () => {
  test("the sidebar links to it and it lists every stored case with its parent", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCases(page);
    await expect(page.getByRole("link", { name: "Cases", exact: true })).toBeVisible();
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(3);
    const fork = page.getByTestId("case-row-2");
    await expect(fork.getByRole("link", { name: "AAPL higher margin" })).toHaveAttribute("href", "/cases/2");
    await expect(fork.getByRole("link", { name: "conservative_AAPL_2026-01-01" })).toHaveAttribute("href", "/cases/1");
  });

  test("?ticker= presets the filter and hides other tickers", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCases(page, "?ticker=MSFT");
    await expect(page.getByLabel("Ticker filter")).toHaveValue("MSFT");
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(1);
    await expect(page.getByTestId("case-row-3")).toBeVisible();
  });

  test("an empty store says so, and does not point at a generator that does not exist", async ({ page }) => {
    await mockCasesApi(page, { cases: [] });
    await gotoCases(page);
    await expect(page.getByText("No stored cases yet.")).toBeVisible();
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(0);
  });

  test("a failed list load is an error, with no rows", async ({ page }) => {
    await mockCasesApi(page, { listStatus: 500 });
    await gotoCases(page);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(0);
  });
});

test("the valuation page links to the chosen ticker's stored cases", async ({ page }) => {
  await mockValuationApi(page, {
    cases: [{ id: 1, case_name: "conservative_AEP_2026-01-01", ticker: "AEP", as_of_date: "2026-09-04", base_year: 2025, target_year: 2035, parent_case_id: null }],
  });
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel(/ticker/i).fill("AEP");
  await page.getByLabel(/ticker/i).press("Enter");
  await expect(page.getByRole("link", { name: /Stored cases for AEP/ })).toHaveAttribute("href", "/cases?ticker=AEP");
});
