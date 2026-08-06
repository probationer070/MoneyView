import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// The corporate dashboard has no company-quality model, so it must not present a composite
// quality score, and it must not draw a peer baseline it never measured.
//
// It used to do both. A `healthScore` averaged `growth x 2` (a percentage), `marketShare` (a
// 0-100 input), `lifeCyclePosition` (35 + growth x 2.5 - debtRatio x 0.3) and
// `leveredBetaRiskScore` (100 - max(beta - 1, 0) x 35) into one badge, green above 65. The
// radar it headlined drew those against a `peer` polygon of seven hardcoded constants --
// 58, 62, 60, 70, 66, 65, 62 -- the same shape for every ticker, so the one comparison the
// chart existed to make could not vary.
//
// These assertions are absence checks, so each test first confirms the surface it is checking
// actually rendered. An absence assertion that passes against a blank page proves nothing.

const FORBIDDEN_LABELS = [
  /Company Status Diagnosis/i,
  /Health Score/i,
  /Life Cycle/i,
  /Levered Beta Risk/i,
];

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the corporate dashboard's quality scoring", () => {
  test("no dashboard surface presents a composite quality score", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);

    // Positive control: the KPI row and the chart suite are both on screen, so the absences
    // below are absences from a rendered page.
    await expect(page.getByRole("button", { name: /ROIC - WACC/ })).toBeVisible();
    await expect(page.getByText("Hurdle Rate Decomposition").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("DCF Core Modules").first()).toBeVisible({ timeout: 60_000 });

    for (const label of FORBIDDEN_LABELS) {
      await expect(page.getByText(label)).toHaveCount(0);
    }
  });

  test("the exportable dataset carries no composite score and no radar peer baseline", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);

    // The raw dataset is what the CSV download writes, so a score dropped from the UI but
    // left in the export would still leave the workspace with a fabricated quality rating.
    await page.getByRole("button", { name: /ROIC - WACC/ }).click();
    const modal = page.getByRole("dialog").first();
    await expect(modal).toBeVisible({ timeout: 30_000 });
    await modal.getByRole("heading", { name: "Raw Datasets" }).click();

    const datasetRows = modal.locator("table tbody tr");
    await expect(datasetRows.first()).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByText("derived_metrics", { exact: true }).first()).toBeVisible();

    for (const field of ["healthScore", "agencyRisk", "lifeCyclePosition", "leveredBetaRiskScore"]) {
      await expect(modal.getByText(field, { exact: true })).toHaveCount(0);
    }
    // The radar series carried the hardcoded peer column, so its rows must be gone too.
    await expect(modal.getByText(/^company_status_radar/)).toHaveCount(0);
  });
});
