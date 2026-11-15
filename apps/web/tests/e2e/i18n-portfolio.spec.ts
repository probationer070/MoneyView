import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { portfolioPartialWeightsFixture } from "./fixtures/shared";

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

test("the news refresh summary the page runs on its own is Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  // The first visit to the Stocks tab runs the news fetch without a click. The mock
  // reports AAPL acquired, MSFT plus two empty tickers current, and GOOGL failed.
  const summary = page.getByTestId("news-refresh-summary");
  await expect(summary).toContainText("1개 갱신 · 3개 이미 최신 · 1개 실패 (GOOGL)");
  await expect(summary).not.toContainText("already current");
  await expect(summary).not.toContainText("failed (");
});

test("the benchmark preset select is named in Korean inside the period popover", async ({ page }) => {
  await gotoPortfolioKo(page);

  await page.getByRole("tab", { name: "성과 기여" }).click();
  await page.getByRole("button", { name: /^기간/ }).click();

  await expect(page.getByRole("combobox", { name: "포트폴리오 벤치마크 프리셋" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Portfolio benchmark preset" })).toHaveCount(0);
});

test("the weights-over-100% status panel title is Korean", async ({ page }) => {
  // Doubling the seed weights pushes the stored total past 100% and raises the panel.
  await mockPortfolioPageApi(page, undefined, {
    watchlist: portfolioPartialWeightsFixture.map((stock) => ({ ...stock, weight: stock.weight * 2 })),
  });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "포트폴리오", exact: true })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("tab", { name: "성과 기여" }).click();
  await expect(page.getByText("배분 비중이 100%를 초과함", { exact: true })).toBeVisible();
  await expect(page.getByText("Allocation Weights Exceed 100%")).toHaveCount(0);
});
