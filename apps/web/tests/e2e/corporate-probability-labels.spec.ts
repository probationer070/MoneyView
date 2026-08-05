import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// The corporate dashboard has no probability model, so it must not put a number under a
// probability label.
//
// It used to. `successProbability` was clamp(55 + spread x 2.3 + growth - esgPenalty x 0.25,
// 5, 95) -- a linear function of three assumption sliders, rendered as a percentage, always in
// the positive colour, captioned "Above 60% is good". Its complement was labelled failure
// probability, and both fed a four-segment Minard chart whose Y series was named `npv` while
// being the spread times an arbitrary per-segment constant.
//
// These assertions are absence checks, so each test first confirms the surface it is checking
// actually rendered. An absence assertion that passes against a blank page proves nothing.

const FORBIDDEN_LABELS = [/probability/i, /\bNPV\b/, /Risk-Return Minard/i];

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

test.describe("the corporate dashboard's scenario labels", () => {
  test("no dashboard surface presents a probability or an NPV", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);

    // Positive control: the KPI row and the chart suite are both on screen, so the absences
    // below are absences from a rendered page.
    await expect(page.getByRole("button", { name: /ROIC - WACC/ })).toBeVisible();
    await expect(page.getByText("Company Status Diagnosis").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("DCF Core Modules").first()).toBeVisible({ timeout: 60_000 });

    for (const label of FORBIDDEN_LABELS) {
      await expect(page.getByText(label)).toHaveCount(0);
    }
  });

  test("the exportable dataset carries no scenario-probability field", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);

    // The raw dataset is what the CSV download writes, so a metric dropped from the UI but
    // left in the export would still leave the workspace with a fabricated probability in it.
    await page.getByRole("button", { name: /ROIC - WACC/ }).click();
    const modal = page.getByRole("dialog").first();
    await expect(modal).toBeVisible({ timeout: 30_000 });
    // The heading, not the text: the Export Affordances blurb further down the modal ends
    // "...after reviewing raw datasets", and getByText matches case-insensitively.
    await modal.getByRole("heading", { name: "Raw Datasets" }).click();

    const datasetRows = modal.locator("table tbody tr");
    await expect(datasetRows.first()).toBeVisible({ timeout: 30_000 });
    await expect(modal.getByText("derived_metrics", { exact: true }).first()).toBeVisible();

    for (const field of ["successProbability", "failureProbability"]) {
      await expect(modal.getByText(field, { exact: true })).toHaveCount(0);
    }
    await expect(modal.getByText(/^risk_return_minard/)).toHaveCount(0);
  });
});
