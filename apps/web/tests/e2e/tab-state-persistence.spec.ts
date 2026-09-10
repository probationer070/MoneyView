import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

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
