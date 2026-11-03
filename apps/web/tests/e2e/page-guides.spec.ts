import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_PREFIX } from "./helpers/mockUtils";
import { CASE_SUMMARIES, mockCasesApi } from "./helpers/casesApiMock";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";
import { mockEventsApi, UNCATEGORIZED } from "./helpers/eventsApiMock";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { installMonteCarloWorker } from "./helpers/monteCarloWorkerMock";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { mockRiskRecords } from "./helpers/riskApiMock";
import { mockValuationApi } from "./helpers/valuationPageMock";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";

// "How to read this screen" on the market overview, portfolio, news, Monte Carlo, decisions, valuation, cases, case, events and alerts pages (same idea as
// signals-guide.spec.ts and corporate-guide.spec.ts). Closed by default, Korean in ko-KR, and the
// one-screen / shell layouts do not start scrolling the page.

// Words that stay Latin in Korean copy: tickers, finance acronyms (also the labels the UI keeps in Latin), a key name,
// the product name, a company name and the decision actions, which the Decision Log shows as stored.
const LATIN_OK = /\b(KOSPI|ETF|WACC|DCF|ROIC|UTC|Esc|MoneyView|VaR|CVaR|EPS|PER|buy|sell|watch|pass|RSI|CSV|API|IPO|URL|SpaceX)\b/g;

function guideTitles(guide: Record<string, unknown>): string[] {
  return Object.values(guide).flatMap((section) => {
    const title = (section as { title?: unknown }).title;
    return typeof title === "string" ? [title] : [];
  });
}

// A guide may quote an on-screen label or stored value that the UI keeps in English: those sit inside “ ” and are not
// counted as English prose. Only the guides for the cases, events and alerts screens quote anything.
const QUOTED = /“[^”]*”/g;

async function expectKoreanOnly(guide: Locator, enGuide: Record<string, unknown>, koGuide: Record<string, unknown>) {
  const text = (await guide.innerText()).replace(QUOTED, "");
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

  test("monte carlo: a closed toggle in the tab row opens a guide over the panel without scrolling the page", async ({ page }: { page: Page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "시뮬레이션 랩", exact: true })).toBeVisible({ timeout: 60_000 });
    const toggle = page.getByTestId("monte-carlo-guide-toggle");
    await expect(toggle).toHaveText("이 화면 읽는 법");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("monte-carlo-guide")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expectNoPageScroll(page, "monte carlo, guide closed");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const guide = page.getByTestId("monte-carlo-guide");
    await expect(guide.getByText("경로 탭", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.monteCarlo.guide, ko.monteCarlo.guide);
    await expectNoPageScroll(page, "monte carlo, guide open");
    await page.getByRole("tab", { name: "상관관계 모형", exact: true }).click();
    await expect(page.getByTestId("monte-carlo-guide")).toBeVisible();
    await expectNoPageScroll(page, "monte carlo, guide open on another tab");

    await toggle.click();
    await expect(page.getByTestId("monte-carlo-guide")).toHaveCount(0);
  });

  test("decisions: a closed guide under the header opens with Korean sections", async ({ page }: { page: Page }) => {
    await mockDecisionsApi(page);
    await page.goto("/decisions", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "의사결정 기록", exact: true })).toBeVisible({ timeout: 60_000 });
    const guide = page.getByTestId("decisions-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법");
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("수정과 삭제", { exact: true })).toBeHidden();

    await guide.locator("summary").click();
    await expect(guide.getByText("수정과 삭제", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.decisions.guide, ko.decisions.guide);
  });

  test("valuation: a closed guide under the header opens with Korean sections", async ({ page }: { page: Page }) => {
    await mockValuationApi(page);
    await page.goto("/valuation", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "가치평가", exact: true })).toBeVisible({ timeout: 60_000 });
    const guide = page.getByTestId("valuation-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법");
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("업종 대비 과대 가능 배지", { exact: true })).toBeHidden();

    await guide.locator("summary").click();
    await expect(guide.getByText("업종 대비 과대 가능 배지", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.valuation.guide, ko.valuation.guide);
  });

  test("cases list: a closed guide under the header opens with Korean sections", async ({ page }: { page: Page }) => {
    await mockCasesApi(page);
    await page.goto("/cases", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "케이스", exact: true })).toBeVisible({ timeout: 60_000 });
    const guide = page.getByTestId("cases-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법");
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("앱이 만드는 케이스", { exact: true })).toBeHidden();

    await guide.locator("summary").click();
    await expect(guide.getByText("앱이 만드는 케이스", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.cases.guide, ko.cases.guide);
  });

  test("case screen: a closed guide under the header opens with Korean sections", async ({ page }: { page: Page }) => {
    await mockCasesApi(page);
    await page.goto(`/cases/${CASE_SUMMARIES[0].id}`, { waitUntil: "domcontentloaded" });
    const guide = page.getByTestId("case-detail-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법", { timeout: 60_000 });
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("움직인 이유 구역", { exact: true })).toBeHidden();

    await guide.locator("summary").click();
    await expect(guide.getByText("움직인 이유 구역", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.caseDetail.guide, ko.caseDetail.guide);
  });

  test("events: a closed guide under the header opens with Korean sections", async ({ page }: { page: Page }) => {
    await mockEventsApi(page, { events: [], categories: [UNCATEGORIZED] });
    await page.goto("/events", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("events-table")).toBeVisible({ timeout: 60_000 });
    const guide = page.getByTestId("events-guide");
    await expect(guide.locator("summary")).toHaveText("이 화면 읽는 법");
    await expect(guide).not.toHaveAttribute("open", "");
    await expect(guide.getByText("이벤트가 오는 곳", { exact: true })).toBeHidden();

    await guide.locator("summary").click();
    await expect(guide.getByText("이벤트가 오는 곳", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.events.guide, ko.events.guide);
  });

  test("alerts: a closed toggle in the filter row opens a guide over the panels without scrolling the page", async ({ page }: { page: Page }) => {
    await mockRiskRecords(page);
    await page.goto("/alerts", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("records-table")).toBeVisible({ timeout: 60_000 });
    const toggle = page.getByTestId("alerts-guide-toggle");
    await expect(toggle).toHaveText("이 화면 읽는 법");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("alerts-guide")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    await expectNoPageScroll(page, "alerts, guide closed");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const guide = page.getByTestId("alerts-guide");
    await expect(guide.getByText("위험 경보", { exact: true })).toBeVisible();
    await expectKoreanOnly(guide, en.alerts.guide, ko.alerts.guide);
    await expectNoPageScroll(page, "alerts, guide open");

    await toggle.click();
    await expect(page.getByTestId("alerts-guide")).toHaveCount(0);
  });
});
