import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

/**
 * Leaving a tab and coming back should not throw away what you were doing.
 *
 * Every tab is a separate route, so navigating unmounts its component tree and every
 * `useState` in it resets. A search typed on Portfolio, a filter chosen there, the
 * ticker being valued -- all of it was gone on return, and had to be retyped.
 *
 * State is kept per tab and per concern, in sessionStorage: it should survive navigation
 * within a session and NOT survive a new one, because a stale filter silently applied
 * days later is worse than retyping.
 */

async function gotoPortfolio(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({
    timeout: 60_000,
  });
}

async function leaveAndReturn(page: Page) {
  // A real navigation, not a reload: the complaint is about moving between tabs.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/$/);
  await gotoPortfolio(page);
}

test("a search survives leaving the tab and coming back", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByTestId("grid-search").fill("AAP");
  await expect(page.getByTestId("grid-search")).toHaveValue("AAP");

  await leaveAndReturn(page);

  await expect(page.getByTestId("grid-search")).toHaveValue("AAP");
});

test("a chosen filter survives leaving the tab and coming back", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByTestId("grid-filter").selectOption("all");
  await expect(page.getByTestId("grid-filter")).toHaveValue("all");

  await leaveAndReturn(page);

  await expect(page.getByTestId("grid-filter")).toHaveValue("all");
});

test("clearing a search is itself remembered", async ({ page }) => {
  // Restoring "the last non-empty value" would make a deliberate clear impossible to keep.
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByTestId("grid-search").fill("AAP");
  await leaveAndReturn(page);
  await expect(page.getByTestId("grid-search")).toHaveValue("AAP");

  await page.getByTestId("grid-search").fill("");
  await leaveAndReturn(page);

  await expect(page.getByTestId("grid-search")).toHaveValue("");
});

test("the corporate comparison universe survives leaving the tab", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });

  await page.getByLabel("Comparison universe").selectOption("custom");
  await page.getByLabel("Custom tickers").fill("NVDA, TSLA");
  await expect(page.getByLabel("Custom tickers")).toHaveValue("NVDA, TSLA");

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });

  // A custom universe is the most expensive thing on this page to retype.
  await expect(page.getByLabel("Comparison universe")).toHaveValue("custom");
  await expect(page.getByLabel("Custom tickers")).toHaveValue("NVDA, TSLA");
});

test("each tab keeps its own state under its own key", async ({ page }) => {
  // Namespacing is the claim, so it is asserted on the keys themselves rather than through
  // a field: the corporate control that would show a leak is only rendered for one
  // universe, so a UI assertion here would pass while proving nothing.
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);
  await page.getByTestId("grid-search").fill("ONLYHERE");
  await expect(page.getByTestId("grid-search")).toHaveValue("ONLYHERE");

  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Comparison universe").selectOption("custom");

  const stored = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith("moneyview.tab.")) out[key] = window.sessionStorage.getItem(key) ?? "";
    }
    return out;
  });

  // The portfolio's search lives under a portfolio key, and no corporate key holds it.
  expect(stored["moneyview.tab.portfolio.gridSearch"]).toBe('"ONLYHERE"');
  const corporateValues = Object.entries(stored)
    .filter(([key]) => key.startsWith("moneyview.tab.corporate."))
    .map(([, value]) => value);
  expect(corporateValues.length, "the corporate tab should have stored something").toBeGreaterThan(0);
  expect(corporateValues.join(" ")).not.toContain("ONLYHERE");
});

test("a new session starts clean", async ({ browser }) => {
  // sessionStorage, not localStorage: a filter restored days later would quietly show a
  // subset of the watchlist with nothing explaining why.
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await mockPortfolioPageApi(firstPage);
  await gotoPortfolio(firstPage);
  await firstPage.getByTestId("grid-search").fill("AAP");
  await expect(firstPage.getByTestId("grid-search")).toHaveValue("AAP");
  await first.close();

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await mockPortfolioPageApi(secondPage);
  await gotoPortfolio(secondPage);

  await expect(secondPage.getByTestId("grid-search")).toHaveValue("");
  await second.close();
});
