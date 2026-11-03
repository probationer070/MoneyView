import { expect, test, type Page } from "@playwright/test";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";

// The decision log renders its copy from the en/ko catalogs. In Korean the English
// copy must be gone from each file that owns it, and the Korean copy must be there.
test.describe("decision log in Korean", () => {
  test.use({ locale: "ko-KR" });

  async function gotoKoDecisions(page: Page) {
    await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "ko"));
    await page.goto("/decisions", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "의사결정 기록", exact: true })).toBeVisible({ timeout: 60_000 });
  }

  test("form, list and chart copy come from the Korean catalog", async ({ page }) => {
    await mockDecisionsApi(page);
    await gotoKoDecisions(page);

    // RecordDecisionForm
    await expect(page.getByRole("button", { name: "기록하기", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Record decision", exact: true })).toHaveCount(0);
    await expect(page.getByText("종목", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Ticker", { exact: true })).toHaveCount(0);

    // DecisionList
    await expect(page.getByText("가격 변화", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Price move", { exact: true })).toHaveCount(0);

    // DecisionOutcomeScatter
    await expect(page.getByRole("heading", { name: "결정 시점 괴리 대비 이후 가격 변화", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Gap at decision against price move since", exact: true })).toHaveCount(0);
  });
});
