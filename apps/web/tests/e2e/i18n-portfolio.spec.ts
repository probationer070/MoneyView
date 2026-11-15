import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

// The portfolio page in Korean. English is pinned by the other portfolio specs; this one
// checks that the Korean copy renders and that the English forms are gone.

test.use({ locale: "ko-KR" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("moneyview.locale", "ko");
  });
});

async function gotoPortfolioKo(page: Page) {
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "포트폴리오", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("the stock grid's search placeholder and count line are Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  await expect(page.getByPlaceholder("종목 코드 또는 이름 검색")).toBeVisible();
  await expect(page.getByPlaceholder("Search ticker or name")).toHaveCount(0);

  const count = page.getByTestId("grid-count");
  await expect(count).toHaveText(/전체 \d+개 중 \d+개 · 관심 \d+개/);
  await expect(count).not.toContainText(" of ");
  await expect(count).not.toContainText("followed");
});

test("the Attribution tab's refresh button and idle title are Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  await page.getByRole("tab", { name: "성과 기여" }).click();
  await expect(page.getByRole("button", { name: "분석 새로고침" })).toBeVisible();
  await expect(page.getByText("성과 기여 분석 대기 중", { exact: true })).toBeVisible();

  await expect(page.getByRole("button", { name: "Refresh Analysis" })).toHaveCount(0);
  await expect(page.getByText("Attribution Idle", { exact: true })).toHaveCount(0);
});

test("the period popover labels the start date in Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  await page.getByRole("tab", { name: "성과 기여" }).click();
  await page.getByRole("button", { name: /^기간/ }).click();

  await expect(page.getByLabel("보유 시작일")).toBeVisible();
  await expect(page.getByLabel("Holding Start Date")).toHaveCount(0);
});
