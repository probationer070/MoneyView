import { expect, test, type Page } from "@playwright/test";
import { mockCasesApi } from "./helpers/casesApiMock";

// The case detail sections render their headings from the en/ko catalogs. In Korean the
// English headings must be gone from their sections, and the Korean ones must be there.
test.describe("case detail in Korean", () => {
  test.use({ locale: "ko-KR" });

  async function gotoKoCase(page: Page, id: number) {
    await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "ko"));
    await page.goto(`/cases/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("case-valuation")).toBeVisible({ timeout: 60_000 });
  }

  test("section headings and buttons come from the Korean catalog", async ({ page }) => {
    await mockCasesApi(page);
    await gotoKoCase(page, 3);

    // ValuationSection
    const valuation = page.getByTestId("case-valuation");
    await expect(valuation.getByRole("heading", { name: "가치평가", exact: true })).toBeVisible();
    await expect(valuation.getByRole("heading", { name: "Valuation", exact: true })).toHaveCount(0);

    // SimulateSection
    const simulate = page.getByTestId("case-simulate");
    await expect(simulate.getByRole("heading", { name: "불확실성 (이 케이스 시뮬레이션)", exact: true })).toBeVisible();
    await expect(simulate.getByRole("heading", { name: "Uncertainty (simulate this case)", exact: true })).toHaveCount(0);

    // ForkSection
    const fork = page.getByTestId("case-fork");
    await expect(fork.getByRole("heading", { name: "이 케이스 파생", exact: true })).toBeVisible();
    await expect(fork.getByRole("heading", { name: "Fork this case", exact: true })).toHaveCount(0);
    await expect(fork.getByRole("button", { name: "파생 만들기", exact: true })).toBeVisible();
    await expect(fork.getByRole("button", { name: "Create fork", exact: true })).toHaveCount(0);
  });
});
