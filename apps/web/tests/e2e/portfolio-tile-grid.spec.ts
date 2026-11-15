import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import type { PortfolioStockFixture } from "./fixtures/shared";

const REFRESH_NEWS = /^(Refresh news|News updated \d+ min ago|News updated just now)$/;

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
    theme: "",
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

test("switching tabs performs no fetch", async ({ page }) => {
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

  for (const label of ["Attribution", "Weights", "Stocks"]) {
    await page.getByRole("tab", { name: label }).click();
    await expect(page.getByRole("tab", { name: label })).toHaveAttribute("aria-selected", "true");
  }

  // A panel body renders from props that are already in the cache, so no request may be
  // issued by opening one. Give any that would be issued a window to appear.
  await page.waitForTimeout(1_000);
  expect(requested).toEqual([]);
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

test("a tile's button holds only phrasing content", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  // A <button> may contain phrasing content only. Browsers do not repair this the way they
  // close a stray <p>, so an invalid tile renders exactly right and stays broken; nothing
  // but an assertion notices. The tile's own wrappers are spans, but its children reach
  // shared components, which is where the flow elements came back.
  // AAPL carries both a delta and a five-point sparkline, so the badge and the chart are
  // actually rendered; a tile missing either would pass without proving anything.
  const flowInsideTheButton = await page
    .getByTestId("stock-tile-AAPL")
    .locator("div, p, section, article, ul, ol, li, table, h1, h2, h3, h4, h5, h6")
    .count();

  expect(flowInsideTheButton).toBe(0);
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
  // Holds the search's news request open once armed, then defers to the base mock. Without
  // the hold, the window this test is about -- the new key issued, its data not yet back --
  // closes in a few milliseconds and no check lands inside it. Removing `placeholderData`
  // from the bulk-news query left the previous version of this test green.
  let holdNews = false;
  let releaseNews: () => void = () => {};
  const newsReleased = new Promise<void>((resolve) => {
    releaseNews = resolve;
  });
  await page.route("**/api/v1/news/feed/bulk**", async (route) => {
    if (holdNews) await newsReleased;
    await route.fallback();
  });
  await gotoGrid(page);
  await expect(page.getByTestId("stock-tile-AAPL")).toContainText("AAPL headline one");
  await page.waitForLoadState("networkidle");

  let bulkRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/v1/news/feed/bulk") bulkRequests += 1;
  });

  const headlines = page.getByText(/AAPL headline/);
  const search = page.getByTestId("grid-search");
  holdNews = true;
  await search.click();
  for (const character of "AAPL") {
    await search.pressSequentially(character);
    expect(await headlines.count()).toBeGreaterThan(0);
  }

  // The debounced key has changed and its request is in flight, held open. placeholderData
  // must keep the previous news on the tiles for as long as that lasts; without it the data
  // is undefined for the new key and every headline disappears. Sampled across the hold
  // rather than once, because the blank arrives on the render after the key changes.
  await expect.poll(() => bulkRequests).toBe(1);
  for (let sample = 0; sample < 10; sample += 1) {
    expect(await headlines.count(), `headlines blanked while the news request was in flight (sample ${sample})`).toBeGreaterThan(0);
    await page.waitForTimeout(100);
  }
  releaseNews();

  await expect(page.getByTestId("stock-tile-MSFT")).toHaveCount(0);
  // 400ms debounce plus the round trip, then a margin for any extra request to show up.
  await page.waitForTimeout(2_000);
  expect(bulkRequests).toBe(1);
  expect(await headlines.count()).toBeGreaterThan(0);
});

// The grid used to decide membership by `weight > 0`, and fell back to the twelve most
// recently added stocks behind a banner when nothing had a weight -- which was true of all
// 139 rows in the real database. Nobody chose those twelve. Membership is now `group_name`,
// a list of names that costs no numbers to curate, and the two tests that pinned the
// fallback are replaced by these rather than deleted: the behaviour they covered is gone
// on purpose.

function groupedWatchlist(): PortfolioStockFixture[] {
  return [
    { ...bulkWatchlist(1, 0)[0], ticker: "KEEP1", name: "Followed One", group_name: "custom", id: 1 },
    { ...bulkWatchlist(1, 0)[0], ticker: "KEEP2", name: "Followed Two", group_name: "custom", id: 2 },
    { ...bulkWatchlist(1, 0)[0], ticker: "REST1", name: "Rest One", group_name: "total", id: 3 },
  ];
}

test("a ticker with no priced bar renders a dash everywhere, and crashes nothing", async ({ page }) => {
  // The API reports an absent price as null rather than 0. The tile always handled that,
  // but the holdings row called `.toLocaleString()` on the value directly, which throws on
  // null -- and page.tsx typed the field as `number`, so the compiler believed the lie and
  // never flagged it. The grid is checked here; the holdings table is gone with its panel.
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));

  await mockPortfolioPageApi(page, undefined, {
    watchlist: [
      {
        ...bulkWatchlist(1, 0)[0],
        ticker: "NULLP",
        name: "No Priced Bar",
        group_name: "custom",
        id: 1,
        last_close: null,
        delta: null,
        sparkline: [],
      },
    ] as never,
  });
  await gotoGrid(page, "NULLP");

  await expect(page.getByTestId("stock-tile-NULLP")).toContainText("—");

  expect(crashes, `uncaught page errors: ${crashes.join(" | ")}`).toEqual([]);
});

test("a tile shows its weight as a percentage, not as the raw fraction", async ({ page }) => {
  // `weight` is stored as a fraction and PortfolioAllocationEditor edits it as
  // `weight * 100`. The tile rendered it raw, so a 25% allocation read as "wt 0.3%" --
  // an order-of-magnitude error in a figure sitting beside a real price.
  await mockPortfolioPageApi(page, undefined, {
    watchlist: [{ ...bulkWatchlist(1, 0.25)[0], ticker: "WGT1", group_name: "custom", id: 1 }],
  });
  await gotoGrid(page, "WGT1");

  await expect(page.getByTestId("stock-tile-WGT1")).toContainText("wt 25.0%");
});

test("the grid shows a group, not whatever had a weight", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  await expect(page.getByTestId("stock-tile-KEEP2")).toBeVisible();
  await expect(page.getByTestId("stock-tile-REST1")).toHaveCount(0);

  // Every weight here is 0. Under the old rule this universe had no holdings at all and the
  // grid substituted the most recent stocks behind a fallback banner. Exactly the group's two
  // tiles, not "no banner": the banner's testid no longer exists anywhere, so checking for its
  // absence could never fail (ERROR-LOG.md 2026-09-14).
  await expect(page.getByTestId("stock-tile-grid").locator('> [data-testid^="stock-tile-cell-"]')).toHaveCount(2);
});

test("switching to All shows every group", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  await page.getByTestId("grid-filter").selectOption("all");

  await expect(page.getByTestId("stock-tile-REST1")).toBeVisible();
  await expect(page.getByTestId("stock-tile-KEEP1")).toBeVisible();
});

test("a filter naming a group the data does not have falls back to one it does", async ({ page }) => {
  // The built-in seed groups everything as `built_in`, so a literal default of `custom`
  // would render an empty grid on a fresh install.
  await mockPortfolioPageApi(page, undefined, { watchlist: bulkWatchlist(3, 0) });
  await gotoGrid(page, "TST1");

  // The grid's direct children are the per-tile wrappers that host the follow control;
  // the tile button itself is one level down.
  await expect(page.getByTestId("stock-tile-grid").locator('> [data-testid^="stock-tile-cell-"]')).toHaveCount(3);
  await expect(page.getByTestId("grid-filter")).toHaveValue("built_in");
});

test("following a stock moves it into the followed group and shows it", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  await page.getByTestId("grid-filter").selectOption("all");
  await expect(page.getByTestId("stock-tile-REST1")).toBeVisible();

  await page.getByTestId("stock-tile-follow-REST1").click();

  // Back to the followed group: the stock that was outside it is now inside.
  await page.getByTestId("grid-filter").selectOption("custom");
  await expect(page.getByTestId("stock-tile-REST1")).toBeVisible();
});

test("unfollowing removes a stock from the group without deleting it", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  await page.getByTestId("stock-tile-follow-KEEP1").click();
  await expect(page.getByTestId("stock-tile-KEEP1")).toHaveCount(0);

  // Still on the watchlist -- unfollow is a group move, not a delete.
  await page.getByTestId("grid-filter").selectOption("all");
  await expect(page.getByTestId("stock-tile-KEEP1")).toBeVisible();
});

/**
 * Six stocks, two of them followed, so the three figures in the count line are all
 * distinct once a search narrows the visible set. A fixture where any two of them
 * coincided would let a count that reported the wrong one still read correctly.
 */
function countableWatchlist(): PortfolioStockFixture[] {
  return [
    { ...bulkWatchlist(1, 0)[0], ticker: "FOLA", name: "Followed A", group_name: "custom", id: 1 },
    { ...bulkWatchlist(1, 0)[0], ticker: "FOLB", name: "Followed B", group_name: "custom", id: 2 },
    ...bulkWatchlist(4, 0).map((stock, index) => ({ ...stock, group_name: "total", id: index + 3 })),
  ];
}

test("the count line separates the visible count from the total and the followed", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { watchlist: countableWatchlist() });
  await gotoGrid(page, "FOLA");

  const count = page.getByTestId("grid-count");
  await expect(count).toHaveText("2 of 6 · 2 followed");

  await page.getByTestId("grid-search").fill("FOLA");
  await expect(page.getByTestId("stock-tile-FOLB")).toHaveCount(0);

  // Only the first figure may move. A single combined count would satisfy a weaker
  // assertion while hiding whether the filter or the total was the thing that changed:
  // the total is the full set passed in, and the followed count is a property of that
  // set, so neither is a function of the search.
  await expect(count).toHaveText("1 of 6 · 2 followed");

  // The line lives in the sticky header, a sibling of the controls rather than of the
  // grid body, so the empty state must replace the tiles and leave it standing. A count
  // that vanished exactly when it read 0 would hide the total at the one moment a reader
  // needs it to explain why the grid is blank.
  await page.getByTestId("grid-search").fill("NOSUCHTICKER");
  await expect(page.getByTestId("stock-tile-grid")).toHaveCount(0);
  await expect(count).toHaveText("0 of 6 · 2 followed");
});

test("the filter names the groups by what they do, not by their stored group name", async ({ page }) => {
  // `total` is the group unfollowing moves a stock into, so an option reading "total"
  // filtered to the stocks the reader does NOT follow while sitting beside an "All" option
  // that really did mean everything -- 136 of 143 against 143 on the live database. The
  // whole option set is asserted, not just the presence of "Not followed": the defect was
  // two options whose labels did not distinguish them, and only the full list shows that.
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  const options = await page.getByTestId("grid-filter").locator("option").allTextContents();
  expect(options).toEqual(["Followed", "Not followed", "All"]);
});

test("the count line stays on screen when the grid is scrolled", async ({ page }) => {
  // It is inside the `sticky top-0` header for this reason. A count that scrolls away is
  // no use while a reader is looking at the tiles it describes, and the requirement is
  // invisible in the markup once the line is a sibling of the controls rather than of the
  // body -- moving it out of the sticky container would break this and nothing else.
  await mockPortfolioPageApi(page, undefined, { watchlist: bulkWatchlist(24, 0.04) });
  await gotoGrid(page, "TST1");

  const count = page.getByTestId("grid-count");
  await expect(count).toHaveText("24 of 24 · 0 followed");

  const region = page.getByTestId("portfolio-scroll-region");
  await region.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);

  // Still visible, and still inside the scroll region's own viewport rather than pushed
  // above it -- `toBeVisible` alone is satisfied by an element scrolled out of the region.
  await expect(count).toBeVisible();
  const countBox = await count.boundingBox();
  const regionBox = await region.boundingBox();
  expect(countBox).not.toBeNull();
  expect(regionBox).not.toBeNull();
  expect(countBox!.y).toBeGreaterThanOrEqual(regionBox!.y - 1);
  expect(countBox!.y + countBox!.height).toBeLessThanOrEqual(regionBox!.y + regionBox!.height + 1);
});

test("the follow button does not overlap the delta badge", async ({ page }) => {
  // The tile's comment used to claim the header row left the top-right corner free. It
  // does not: DeltaBadge is right-aligned by `justify-between` into exactly the corner the
  // absolutely-positioned follow button occupies. Asserting both are merely visible would
  // pass with them stacked on top of each other, so this compares their boxes.
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  const badge = page.getByTestId("stock-tile-KEEP1").getByTestId("delta-badge");
  const button = page.getByTestId("stock-tile-follow-KEEP1");
  await expect(badge).toBeVisible();
  await expect(button).toBeVisible();

  // The precondition that makes this comparison mean anything, asserted rather than
  // assumed. The follow control is positioned against the CELL, so unless the tile fills
  // the cell the control is not over the card at all and the boxes below cannot overlap
  // however the padding is set. `w-full` on the tile is what guarantees it; before that,
  // the card was fit-content sized and this test passed with the `pr-6` removed, because
  // the mock's short headlines left the tile 182px wide inside a 382px cell.
  const cellBox = await page.getByTestId("stock-tile-cell-KEEP1").boundingBox();
  const tileBox = await page.getByTestId("stock-tile-KEEP1").boundingBox();
  expect(cellBox).not.toBeNull();
  expect(tileBox).not.toBeNull();
  expect(
    tileBox!.x + tileBox!.width,
    "the tile must fill its grid cell, or the follow control is not over the card at all",
  ).toBeCloseTo(cellBox!.x + cellBox!.width, 0);

  const badgeBox = await badge.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(badgeBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();

  const intersects =
    badgeBox!.x < buttonBox!.x + buttonBox!.width &&
    buttonBox!.x < badgeBox!.x + badgeBox!.width &&
    badgeBox!.y < buttonBox!.y + buttonBox!.height &&
    buttonBox!.y < badgeBox!.y + badgeBox!.height;

  expect(
    intersects,
    `badge ${JSON.stringify(badgeBox)} overlaps follow button ${JSON.stringify(buttonBox)}`,
  ).toBe(false);
});

test("the follow control is not nested inside the tile button", async ({ page }) => {
  // The tile is itself a <button>. A nested button is invalid HTML that browsers reparent,
  // which would move the control out of the tile and break its position.
  await mockPortfolioPageApi(page, undefined, { watchlist: groupedWatchlist() });
  await gotoGrid(page, "KEEP1");

  const nested = page.locator('[data-testid="stock-tile-KEEP1"] [data-testid="stock-tile-follow-KEEP1"]');
  await expect(nested).toHaveCount(0);
  await expect(page.getByTestId("stock-tile-follow-KEEP1")).toBeVisible();
});

test("refresh reports refreshed, current and named failures", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await page.getByRole("button", { name: REFRESH_NEWS }).click();

  const summary = page.getByTestId("news-refresh-summary");
  // AAPL acquired; MSFT fresh plus NVDA and AMZN empty, all "already current"; GOOGL failed.
  await expect(summary).toContainText("1 refreshed");
  await expect(summary).toContainText("3 already current");
  await expect(summary).toContainText("1 failed (GOOGL)");
  // The search never moved, so the summary describes what is on screen and says nothing more.
  await expect(summary).not.toContainText("for the stocks visible when you pressed Refresh");
});

test("the refresh button spins while acquiring and the summary clears when the search moves", async ({ page }) => {
  await mockPortfolioPageApi(page, undefined, { acquireDelayMs: 1_500 });
  await gotoGrid(page);

  const refreshButton = page.getByRole("button", { name: REFRESH_NEWS });
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

  await page.getByRole("button", { name: REFRESH_NEWS }).click();
  // Move the search while the crawl is still in flight.
  await page.getByTestId("grid-search").fill("AAPL");
  await expect(page.getByTestId("stock-tile-MSFT")).toHaveCount(0);

  const summary = page.getByTestId("news-refresh-summary");
  await expect(summary).toContainText("for the stocks visible when you pressed Refresh");
  // Qualified, not dropped: which ticker failed is the part worth keeping.
  await expect(summary).toContainText("1 failed (GOOGL)");
});

test("add to portfolio from the stock detail modal focuses the weight input on the Weights tab", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

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
        const openPanel = document.querySelector('[role="tabpanel"]');
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

test("the mutation message survives switching every tab and renders exactly once", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await gotoGrid(page);

  await page.getByTestId("stock-tile-AAPL").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: /Review Portfolio Weight|Add To Portfolio/ }).click();

  const message = page.getByTestId("portfolio-mutation-message");
  await expect(message).toHaveCount(1);
  await expect(message).toContainText("AAPL");

  // The message is written from several tabs but lives in the shell, so switching
  // tabs must neither drop it nor duplicate it.
  for (const label of ["Stocks", "Attribution", "Weights"]) {
    await page.getByRole("tab", { name: label }).click();
    await expect(message).toHaveCount(1);
  }

  await expect(message).toBeVisible();
});

