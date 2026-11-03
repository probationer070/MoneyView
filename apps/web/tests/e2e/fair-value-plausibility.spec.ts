import { expect, test, type Page } from "@playwright/test";
import type { FairValuePlausibility, FairValueSummary } from "../../lib/fairValue";
import { mockValuationApi } from "./helpers/valuationPageMock";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { fairValueFixture } from "./helpers/fairValueMock";

const FLAGGED: FairValuePlausibility = {
  implied_ev_sales: 12.4, industry_ev_sales: 3.1, ratio: 4.0, k: 3, flagged: true, industry: "Computers/Peripherals",
  causes: [
    { field: "margin_target", company_value: 0.45, industry_value: 0.18, share_of_value: 0.62 },
    { field: "growth_1_5", company_value: 0.12, industry_value: 0.05, share_of_value: 0.21 },
  ],
};

// Hand-computed: 12.4 / 3.1 = 4.0; 45.0% vs 18.0% removes 62.0%; 12.0% vs 5.0% removes 21.0%.
const FLAGGED_REASON_KO =
  "적정가가 암시하는 EV/매출 12.4배는 Computers/Peripherals 업종 3.1배의 4.0배입니다. "
  + "목표 영업이익률 45.0% (업종 18.0%)를 업종 값으로 바꾸면 가치가 62.0% 줄어듭니다. "
  + "1–5년 매출 성장률 12.0% (업종 5.0%)를 업종 값으로 바꾸면 가치가 21.0% 줄어듭니다.";

const withPlausibility = (plausibility: FairValuePlausibility | null): FairValueSummary => ({ ...fairValueFixture("AAPL"), plausibility });

async function gotoValuationKo(page: Page, fairValue: FairValueSummary) {
  await mockValuationApi(page, { fairValue });
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await page.getByLabel(/종목 코드/).fill("AAPL");
  await page.getByLabel(/종목 코드/).press("Enter");
}

test.describe("fair value plausibility on the valuation tab (ko-KR)", () => {
  test.use({ locale: "ko-KR" });

  test("a flagged value shows the badge and the reason with its figures", async ({ page }) => {
    await gotoValuationKo(page, withPlausibility(FLAGGED));
    const block = page.getByTestId("fair-value-block");
    await expect(block.getByTestId("fair-value-plausibility")).toHaveText("업종 대비 과대 가능", { timeout: 30_000 });
    await expect(block.getByTestId("fair-value-plausibility-reason")).toHaveText(FLAGGED_REASON_KO);
  });

  test("a value that is not flagged shows no badge and no reason", async ({ page }) => {
    await gotoValuationKo(page, withPlausibility({ ...FLAGGED, ratio: 1.2, flagged: false }));
    const block = page.getByTestId("fair-value-block");
    await expect(block.getByTestId("fair-value")).toHaveText("145.50", { timeout: 30_000 });
    await expect(block.getByTestId("fair-value-plausibility")).toHaveCount(0);
    await expect(block.getByTestId("fair-value-plausibility-reason")).toHaveCount(0);
  });

  test("a null plausibility shows no badge and no reason", async ({ page }) => {
    await gotoValuationKo(page, withPlausibility(null));
    const block = page.getByTestId("fair-value-block");
    await expect(block.getByTestId("fair-value")).toHaveText("145.50", { timeout: 30_000 });
    await expect(block.getByTestId("fair-value-plausibility")).toHaveCount(0);
    await expect(block.getByTestId("fair-value-plausibility-reason")).toHaveCount(0);
  });
});

test.describe("fair value plausibility in the corporate header (ko-KR)", () => {
  test.use({ locale: "ko-KR" });

  test("a flagged value shows the badge, with the reason as its title", async ({ page }) => {
    await mockCorporatePageApi(page, undefined, { fairValue: withPlausibility(FLAGGED) });
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "기업 분석" })).toBeVisible({ timeout: 60_000 });
    const line = page.getByTestId("fair-value-line");
    await expect(line).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    const badge = line.getByTestId("fair-value-plausibility");
    await expect(badge).toHaveText("업종 대비 과대 가능");
    await expect(badge).toHaveAttribute("title", FLAGGED_REASON_KO);
  });

  test("a value that is not flagged shows no badge", async ({ page }) => {
    await mockCorporatePageApi(page, undefined, { fairValue: withPlausibility({ ...FLAGGED, ratio: 1.2, flagged: false }) });
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "기업 분석" })).toBeVisible({ timeout: 60_000 });
    const line = page.getByTestId("fair-value-line");
    await expect(line).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await expect(line.getByTestId("fair-value-plausibility")).toHaveCount(0);
  });
});
