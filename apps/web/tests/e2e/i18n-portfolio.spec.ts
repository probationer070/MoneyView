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

test("the news refresh summary the page runs on its own is Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  // The first visit to the Stocks tab runs the news fetch without a click. The mock
  // reports AAPL acquired, MSFT plus two empty tickers current, and GOOGL failed.
  const summary = page.getByTestId("news-refresh-summary");
  await expect(summary).toContainText("1개 갱신 · 3개 이미 최신 · 1개 실패 (GOOGL)");
  await expect(summary).not.toContainText("already current");
  await expect(summary).not.toContainText("failed (");
});

test("the stock detail modal opened from a tile is Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  await page.getByTestId("stock-tile-AAPL").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "빠른 포트폴리오 검토", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "포트폴리오 비중 검토", exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "스냅샷 맥락", exact: true })).toBeVisible();

  await expect(dialog.getByText("Quick portfolio review", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Review Portfolio Weight", exact: true })).toHaveCount(0);
  await expect(dialog.getByText("Snapshot Context", { exact: true })).toHaveCount(0);
});

test("the Weights tab's search heading and normalize button are Korean", async ({ page }) => {
  await gotoPortfolioKo(page);

  await page.getByRole("tab", { name: "비중" }).click();
  await expect(page.getByRole("heading", { name: "종목 검색 패널", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "100%로 정규화", exact: true })).toBeVisible();

  await expect(page.getByRole("heading", { name: "Stock Search Panel", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Normalize To 100%", exact: true })).toHaveCount(0);
});

