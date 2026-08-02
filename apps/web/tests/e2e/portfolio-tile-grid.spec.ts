import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import type { PortfolioStockFixture } from "./fixtures/shared";

const RAIL_SNAPSHOT = "Latest snapshot summary";
const RAIL_ATTRIBUTION = "Attribution";
const RAIL_ALLOCATION = "Allocation workspace";
const RAIL_HOLDINGS = "Holdings table";
const RAIL_REFRESH = "Refresh news for visible stocks";

function rail(page: Page) {
  return page.getByTestId("portfolio-rail");
}

function panel(page: Page) {
  return page.getByTestId("portfolio-side-panel");
}

/**
 * A watchlist big enough to overflow the scroll region. Weights stay small so the sum
 * lands under 100% and the page behaves like a normal allocated portfolio.
 */
function bulkWatchlist(count: number, weight: number): PortfolioStockFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    ticker: `TST${index + 1}`,
    name: `Test Holding ${index + 1}`,
    sector: "Technology",
    group_name: "built_in",
    weight,
    last_close: 100 + index,
    delta: { delta_pct: 0.5 },
    sparkline: [95, 97, 99, 100 + index],
    id: index + 1,
  }));
}

async function gotoGrid(page: Page, firstTile = "AAPL") {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId(`stock-tile-${firstTile}`)).toBeVisible();
}

test("the grid scroll region is the only vertically scrolling region on the page", async ({ page }) => {
  // A watchlist long enough to guarantee the region actually overflows: asserting on a
  // region that fits its content would pass without testing anything.
  await mockPortfolioPageApi(page, undefined, { watchlist: bulkWatchlist(24, 0.04) });
  await gotoGrid(page, "TST1");

  const scrollable = await page.evaluate(() => {
    const results: string[] = [];
    const candidates: Element[] = [
      document.documentElement,
      document.body,
      ...Array.from(document.body.querySelectorAll("*")),
    ];
    for (const element of candidates) {
      const style = window.getComputedStyle(element);
      if (!["auto", "scroll"].includes(style.overflowY)) continue;
      if (element.scrollHeight <= element.clientHeight) continue;
      results.push(element.getAttribute("data-testid") ?? `<${element.tagName.toLowerCase()} no-testid>`);
    }
    return results;
  });

  expect(scrollable).toEqual(["portfolio-scroll-region"]);

  // Counting scroll containers is not what "one scrolling region" means to a user: the
  // document is a scrolling surface too, and it overflowed by the app shell's vertical
  // padding, so the rail could be scrolled partly out of view while this assertion above
  // still passed. Assert the containment rather than trusting the shell's height
  // arithmetic (ERROR-LOG.md 2026-08-02).
  const documentOverflow = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(documentOverflow).toBe(0);
});

test("a rail icon opens its panel and Escape closes it", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_SNAPSHOT }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toHaveAttribute("aria-modal", "true");
  await expect(panel(page)).toHaveAttribute("aria-label", "Latest Snapshot Summary");

  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("only one panel is open at a time", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_SNAPSHOT }).click();
  await expect(panel(page)).toBeVisible();
  await rail(page).getByRole("button", { name: RAIL_ATTRIBUTION }).click();

  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page)).toHaveAttribute("aria-label", "Attribution");
});

test("opening a panel performs no fetch", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);
  // Let first-load queries finish before the counter starts; otherwise their responses
  // would be attributed to the panel opens.
  await page.waitForLoadState("networkidle");

  const requested: string[] = [];
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/api/v1/")) requested.push(pathname);
  });

  for (const label of [RAIL_SNAPSHOT, RAIL_ATTRIBUTION, RAIL_ALLOCATION, RAIL_HOLDINGS]) {
    await rail(page).getByRole("button", { name: label }).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
  }

  // A panel body renders from props that are already in the cache, so no request may be
  // issued by opening one. Give any that would be issued a window to appear.
  await page.waitForTimeout(1_000);
  expect(requested).toEqual([]);
});

test("a panel opened with the grid scrolled to the bottom is pinned to the visible region", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: bulkWatchlist(24, 0.04) });
  await gotoGrid(page, "TST1");

  const region = page.getByTestId("portfolio-scroll-region");
  await region.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const scrolled = await region.evaluate((element) => element.scrollTop);
  expect(scrolled).toBeGreaterThan(0);

  await rail(page).getByRole("button", { name: RAIL_ATTRIBUTION }).click();
  await expect(panel(page)).toBeVisible();

  const panelBox = await panel(page).boundingBox();
  const regionBox = await region.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(regionBox).not.toBeNull();
  // Laid out against the whole scrollable content box the panel would start thousands of
  // pixels above the viewport; against the visible region it lines up with it.
  expect(Math.abs(panelBox!.y - regionBox!.y)).toBeLessThanOrEqual(2);
  expect(Math.abs((panelBox!.y + panelBox!.height) - (regionBox!.y + regionBox!.height))).toBeLessThanOrEqual(2);
});

test("an empty tile says whether it was ever checked", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await expect(page.getByTestId("stock-tile-AAPL")).toContainText("AAPL headline one");
  await expect(page.getByTestId("stock-tile-MSFT")).toContainText("No recent news · last checked");
  await expect(page.getByTestId("stock-tile-GOOGL")).toContainText("Never checked for news");
});

test("a tile the news response says nothing about does not claim it was never checked", async ({ page }) => {
  // "Never checked" is a statement about the data. A ticker missing from the response is
  // not that -- it is us not knowing yet, which is the normal state for a ticker the
  // newest keystroke revealed before the debounced query has caught up. Asserted here by
  // omitting GOOGL from the payload entirely rather than by racing the debounce.
  await mockPortfolioPageApi(page);
  // Registered AFTER the base mock on purpose: Playwright matches handlers most-recently-
  // added first, so this is what makes the override win the bulk-news GET.
  await page.route("**/api/v1/news/feed/bulk**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        data: { tickers: { AAPL: { articles: [], last_checked_at: "2026-08-02T05:00:00Z" } } },
      }),
    });
  });
  await gotoGrid(page);

  await expect(page.getByTestId("stock-tile-AAPL")).toContainText("No recent news · last checked");
  await expect(page.getByTestId("stock-tile-GOOGL")).toContainText("News not loaded yet");
  await expect(page.getByTestId("stock-tile-GOOGL")).not.toContainText("Never checked");
});

test("a tile's headlines are readable by assistive tech, not just by eye", async ({ page }) => {
  // aria-label names the button, and an explicit name suppresses the descendant text, so
  // the headlines would be announced nowhere without the description. This asserts the
  // wiring the feature depends on: the tile's whole point is the headlines.
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  const tile = page.getByTestId("stock-tile-AAPL");
  const describedBy = await tile.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy}`)).toContainText("AAPL headline one");
});

test("search filters the grid", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await page.getByTestId("grid-search").fill("AAPL");
  await expect(page.getByTestId("stock-tile-AAPL")).toBeVisible();
  await expect(page.getByTestId("stock-tile-MSFT")).toHaveCount(0);
});

test("typing a four character search issues one bulk news request and never blanks the headlines", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);
  await expect(page.getByTestId("stock-tile-AAPL")).toContainText("AAPL headline one");
  await page.waitForLoadState("networkidle");

  let bulkRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/news/feed/bulk") bulkRequests += 1;
  });

  const headlines = page.getByText(/AAPL headline/);
  const search = page.getByTestId("grid-search");
  await search.click();
  for (const character of "AAPL") {
    await search.pressSequentially(character);
    // placeholderData must hold the previous news on the tiles while the debounced key
    // catches up, or the grid blanks on every keystroke.
    expect(await headlines.count()).toBeGreaterThan(0);
  }

  await expect(page.getByTestId("stock-tile-MSFT")).toHaveCount(0);
  // 400ms debounce plus the round trip, then a margin for any extra request to show up.
  await page.waitForTimeout(2_000);
  expect(bulkRequests).toBe(1);
  expect(await headlines.count()).toBeGreaterThan(0);
});

test("the fallback banner appears when no weights are set", async ({ page }) => {
  // Only this page gets a zero-weight universe. The shared fixture keeps its weights
  // because the rest of the portfolio specs assert against them.
  await mockPortfolioPageApi(page, undefined, { watchlist: bulkWatchlist(3, 0) });
  await gotoGrid(page, "TST1");

  await expect(page.getByTestId("grid-fallback-banner")).toContainText("No weights set");
});

test("the no-weights fallback shows the twelve most recent stocks, newest first", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: bulkWatchlist(16, 0) });
  await gotoGrid(page, "TST16");

  // Direct children only: the grid container's own testid is "stock-tile-grid", which a
  // bare prefix match would count as a thirteenth tile.
  const tiles = page.getByTestId("stock-tile-grid").locator('> [data-testid^="stock-tile-"]');
  await expect(tiles).toHaveCount(12);

  const order = await tiles.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-testid")?.replace("stock-tile-", "") ?? ""),
  );
  // Highest id first: the fallback is "most recent", and id is the only recency signal a
  // watchlist row carries.
  expect(order).toEqual([16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5].map((index) => `TST${index}`));
  await expect(page.getByTestId("stock-tile-TST4")).toHaveCount(0);
});

test("refresh reports refreshed, current and named failures", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_REFRESH }).click();

  const summary = page.getByTestId("news-refresh-summary");
  // AAPL acquired; MSFT fresh plus NVDA and AMZN empty, all "already current"; GOOGL failed.
  await expect(summary).toContainText("1 refreshed");
  await expect(summary).toContainText("3 already current");
  await expect(summary).toContainText("1 failed (GOOGL)");
  // The search never moved, so the summary describes what is on screen and says nothing more.
  await expect(summary).not.toContainText("for the stocks visible when you pressed Refresh");
});

test("the rail refresh icon spins while acquiring and the summary clears when the search moves", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { acquireDelayMs: 1_500 });
  await gotoGrid(page);

  const refreshButton = rail(page).getByRole("button", { name: RAIL_REFRESH });
  await refreshButton.click();
  await expect(refreshButton.locator("svg.animate-spin")).toBeVisible();

  const summary = page.getByTestId("news-refresh-summary");
  await expect(summary).toContainText("1 refreshed");
  await expect(refreshButton.locator("svg.animate-spin")).toHaveCount(0);

  // The summary described the set visible at press time; once the search moves it no
  // longer describes what the user is looking at, so it is retired.
  await page.getByTestId("grid-search").fill("AAPL");
  await expect(summary).toHaveCount(0);
});

test("a summary that lands after the search moved says which set it describes", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { acquireDelayMs: 2_000 });
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_REFRESH }).click();
  // Move the search while the crawl is still in flight.
  await page.getByTestId("grid-search").fill("AAPL");
  await expect(page.getByTestId("stock-tile-MSFT")).toHaveCount(0);

  const summary = page.getByTestId("news-refresh-summary");
  await expect(summary).toContainText("for the stocks visible when you pressed Refresh");
  // Qualified, not dropped: which ticker failed is the part worth keeping.
  await expect(summary).toContainText("1 failed (GOOGL)");
});

test("the holdings panel Add button opens the allocation panel and scrolls inside it", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await page.addInitScript(() => {
    const targets: Element[] = [];
    (window as unknown as { __scrollIntoViewTargets: Element[] }).__scrollIntoViewTargets = targets;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function patched(this: Element, arg?: boolean | ScrollIntoViewOptions) {
      targets.push(this);
      original.call(this, arg as ScrollIntoViewOptions);
    };
  });
  await gotoGrid(page);

  await rail(page).getByRole("button", { name: RAIL_HOLDINGS }).click();
  await expect(panel(page)).toHaveAttribute("aria-label", "Watchlist Holdings");

  await panel(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel(page)).toHaveAttribute("aria-label", "Portfolio Allocation Workspace");

  // The scroll target has to live inside the panel that just opened. Before the fix the
  // ref pointed at a section that no longer existed, so the call was a guaranteed no-op.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const openPanel = document.querySelector('[data-testid="portfolio-side-panel"]');
        if (!openPanel) return false;
        const targets = (window as unknown as { __scrollIntoViewTargets: Element[] }).__scrollIntoViewTargets;
        return targets.some((target) => openPanel.contains(target));
      }),
    )
    .toBe(true);
});

test("add to portfolio from the stock detail modal focuses the weight input inside the allocation panel", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await page.getByTestId("stock-tile-AAPL").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Review Portfolio Weight|Add To Portfolio/ }).click();

  await expect(panel(page)).toHaveAttribute("aria-label", "Portfolio Allocation Workspace");

  // The focus is deferred one animation frame on purpose, so read it until it settles
  // rather than once.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const active = document.activeElement as HTMLElement | null;
        const openPanel = document.querySelector('[data-testid="portfolio-side-panel"]');
        return {
          tag: active?.tagName ?? null,
          type: active?.getAttribute("type") ?? null,
          insidePanel: Boolean(openPanel && active && openPanel.contains(active)),
          rowTicker: active?.closest("tr")?.querySelector("td")?.textContent ?? null,
        };
      }),
    )
    .toEqual({ tag: "INPUT", type: "number", insidePanel: true, rowTicker: "AAPL" });
});

test("the mutation message survives closing every panel and renders exactly once", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await page.getByTestId("stock-tile-AAPL").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Review Portfolio Weight|Add To Portfolio/ }).click();

  const message = page.getByTestId("portfolio-mutation-message");
  await expect(message).toHaveCount(1);
  await expect(message).toContainText("AAPL");

  // Add To Portfolio left the allocation panel open; start from a closed shell.
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  // The message is written from three different panels but lives in the shell, so closing
  // and reopening panels must neither drop it nor duplicate it.
  for (const label of [RAIL_ALLOCATION, RAIL_SNAPSHOT, RAIL_HOLDINGS, RAIL_ATTRIBUTION]) {
    await rail(page).getByRole("button", { name: label }).click();
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel(page)).toHaveCount(0);
    await expect(message).toHaveCount(1);
  }

  await expect(message).toBeVisible();
});
