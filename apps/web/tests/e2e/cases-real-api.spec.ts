import { expect, test } from "@playwright/test";

/**
 * The mocks in cases.spec.ts are this repo's reading of the API. This test is the API's own
 * answer: if a mock drifts from the real contract, only this fails.
 */
const API = `http://127.0.0.1:${process.env.MONEYVIEW_E2E_API_PORT ?? 8110}/api/v1`;
const NARRATED = ["base_revenue", "base_margin", "revenue_target", "margin_target", "sales_to_capital_early", "sales_to_capital_late"];

test("a fork made through the UI is explained by the real Shapley attribution", async ({ page, request }) => {
  const name = `e2e_parent_${Date.now()}`;
  const created = await request.post(`${API}/valuation/cases`, {
    data: {
      case_name: name, ticker: "TESTCO", as_of_date: "2026-01-01", base_year: 2025, target_year: 2035,
      riskfree_rate: 0.042, wacc_initial: 0.09, wacc_stable: 0.074, wacc_converge_from: 5,
      marginal_tax_rate: 0.25, effective_tax_rate: 0.15, nol_balance: 0, roic_stable: 0.12,
      terminal_growth: 0.03, cash: 100, debt: 50, ipo_proceeds: 0, shares_basic: 100, shares_new: 0,
      segments: [{
        name: "Core", base_revenue: 1000, base_margin: 0.2, revenue_target: 2000, margin_target: 0.28,
        sales_to_capital_early: 2, sales_to_capital_late: 3, ramp_start_year: 1,
        narratives: NARRATED.map((f) => ({ input_field: f, claim: `e2e claim for ${f}`, evidence_source: "e2e", confidence: "assumed", three_p: "probable" })),
      }],
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const parentId = (await created.json()).data.id as number;

  await page.goto(`/cases/${parentId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("value-per-share-diluted")).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("New case name").fill(`${name}_fork`);
  await page.getByRole("button", { name: "Add a change" }).click();
  await page.getByTestId("fork-row-0").getByLabel("Field").selectOption("case.wacc_stable");
  await page.getByTestId("fork-row-0").getByLabel("New value").fill("8.1");
  await page.getByRole("button", { name: "Add a change" }).click();
  const margin = page.getByTestId("fork-row-1");
  await margin.getByLabel("Field").selectOption("segment.Core.base_margin");
  await margin.getByLabel("New value").fill("22");
  await margin.getByLabel("Claim").fill("e2e: margin up");
  await margin.getByLabel("Three-P").selectOption("plausible");
  await page.getByRole("button", { name: "Create fork" }).click();

  await expect(page).not.toHaveURL(new RegExp(`/cases/${parentId}$`), { timeout: 30_000 });
  const why = page.getByTestId("case-why");
  await expect(why.getByTestId(/^why-bar-/)).toHaveCount(2, { timeout: 30_000 });
  // Asserted as the real API's own conservation, not a mocked number.
  await expect(why.getByTestId("why-sum")).toContainText("the whole difference");
  await expect(why.getByTestId("why-bar-0")).toContainText("7.40% → 8.10%");
});
