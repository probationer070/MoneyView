import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_PREFIX } from "./helpers/mockUtils";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";

// "How to read this screen" on the market overview, the portfolio and the news page (same idea as
// signals-guide.spec.ts and corporate-guide.spec.ts). Closed by default, Korean in ko-KR, and the
// one-screen / shell layouts do not start scrolling the page.

// Words that stay Latin in Korean copy: tickers, finance acronyms, a key name, the product name.
const LATIN_OK = /\b(KOSPI|ETF|WACC|DCF|ROIC|UTC|Esc|MoneyView)\b/g;

function guideTitles(guide: Record<string, unknown>): string[] {
  return Object.values(guide).flatMap((section) => {
    const title = (section as { title?: unknown }).title;
    return typeof title === "string" ? [title] : [];
  });
}

async function expectKoreanOnly(guide: Locator, enGuide: Record<string, unknown>, koGuide: Record<string, unknown>) {
  const text = await guide.innerText();
  for (const title of guideTitles(koGuide)) expect(text, `ko title "${title}"`).toContain(title);
  for (const title of guideTitles(enGuide)) expect(text, `en title "${title}" must not appear`).not.toContain(title);
  expect(text.replace(LATIN_OK, "").match(/[A-Za-z]{3,}/g) ?? [], "no English words in the Korean guide").toEqual([]);
}

test.describe("page guides, in Korean", () => {
  test.use({ locale: "ko-KR", viewport: { width: 1280, height: 720 } });

  test("market overview: a closed toggle in the tab row opens a guide inside the panel", async ({ page }: { page: Page }) => {
    await mockMarketPageApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "시장 개요", exact: true })).toBeVisible({ timeout: 60_000 });
    const toggle = page.getByTestId("market-guide-toggle");
    await expect(toggle).toHaveText("이 화면 읽는 법");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("market-guide")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expectNoPageScroll(page, "market, guide closed");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const guide = page.getByTestId("market-guide");
    await expect(guide.getByText("카드 읽는 법", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.market.guide, ko.market.guide);
    await expectNoPageScroll(page, "market, guide open on Instruments");
    await page.getByTestId("market-page-tabs").getByRole("tab", { name: "스프레드", exact: true }).click();
    await expect(page.getByTestId("market-guide")).toBeVisible();
    await expectNoPageScroll(page, "market, guide open on Spreads");

    await toggle.click();
    await expect(page.getByTestId("market-guide")).toHaveCount(0);
  });

  test("portfolio: a closed guide under the header opens without scrolling the page", async ({ page }: { page: Page }) => {
    await mockPortfolioPageApi(page);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "포트폴리오", exact: true })).toBeVisible({ timeout: 60_000 });
    const guide = page.getByTestId("portfolio-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법");
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("타일 읽는 법", { exact: true })).toBeHidden();
    await expectNoPageScroll(page, "portfolio, guide closed");

    await guide.locator("summary").click();
    await expect(guide.getByText("타일 읽는 법", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.portfolio.guide, ko.portfolio.guide);
    await expectNoPageScroll(page, "portfolio, guide open");
  });

  test("news: a closed guide above the list opens with Korean sections", async ({ page }: { page: Page }) => {
    const articles = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1, ticker: null, headline: `Headline ${index + 1}`, url: `https://example.com/news/${index + 1}`,
      source: "Example", published_date: "2026-05-01", sentiment: "neutral", importance: 1,
    }));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === `${API_PREFIX}/news/feed` && route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(articles) });
      }
      return route.continue();
    });
    await page.goto("/news", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "시장 인텔리전스", exact: true })).toBeVisible({ timeout: 60_000 });
    const guide = page.getByTestId("news-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법");
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("기사 출처", { exact: true })).toBeHidden();

    await guide.locator("summary").click();
    await expect(guide.getByText("기사 출처", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.news.guide, ko.news.guide);
  });
});
