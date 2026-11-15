import { expect, test } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

// The page sections are tabs under the header now, not an icon rail with a side panel.

async function gotoPortfolio(page: import("@playwright/test").Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
}

test("two page tabs in order, Stocks selected by default, and no icon rail", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  const tabs = page.getByRole("tablist", { name: "Portfolio views" }).getByRole("tab");
  await expect(tabs).toHaveText(["Stocks", "Weights"]);
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "false");
  await expect(page.getByLabel("Portfolio sections")).toHaveCount(0);
  await expect(page.getByTestId("portfolio-rail")).toHaveCount(0);
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });
});

test("the Weights tab shows the allocation editor", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByRole("tab", { name: "Weights" }).click();
  await expect(page.getByRole("tab", { name: "Weights" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").getByLabel("Total investment amount")).toBeVisible();
  await expect(page.getByLabel("Portfolio table scroll region")).toBeVisible();
});

test("only Stocks and Weights tabs exist and nothing requests attribution", async ({ page }) => {
  const attributionRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/portfolio/attribution")) attributionRequests.push(request.url());
  });
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  const tabs = page.getByRole("tablist", { name: "Portfolio views" }).getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expect(tabs).toHaveText(["Stocks", "Weights"]);
  await expect(page.getByRole("tab", { name: "Attribution" })).toHaveCount(0);

  await page.getByRole("tab", { name: "Weights" }).click();
  await expect(page.getByRole("tab", { name: "Weights" })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Stocks" }).click();
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });
  expect(attributionRequests).toEqual([]);
});

test("a stored tab value of attribution opens Stocks", async ({ page }) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem("moneyview.tab.portfolio.tab", JSON.stringify("attribution"));
  });
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await expect(page.getByRole("tab", { name: "Stocks" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible({ timeout: 60_000 });
});

test("Add To Portfolio from the stock detail modal lands on the Weights tab", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoPortfolio(page);

  await page.getByTestId("stock-tile-AAPL").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Review Portfolio Weight|Add To Portfolio/ }).click();

  await expect(page.getByRole("tab", { name: "Weights" })).toHaveAttribute("aria-selected", "true");

  // The focus is deferred one animation frame on purpose, so read it until it settles
  // rather than once.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const panel = document.querySelector('[role="tabpanel"]');
        return {
          tag: active?.tagName ?? null,
          type: active?.getAttribute("type") ?? null,
          insidePanel: Boolean(panel && active && panel.contains(active)),
          rowTicker: active?.closest("tr")?.querySelector("td")?.textContent ?? null,
        };
      }),
    )
    .toEqual({ tag: "INPUT", type: "number", insidePanel: true, rowTicker: "AAPL" });
});
