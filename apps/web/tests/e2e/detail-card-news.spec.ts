import { expect, test, type Page } from "@playwright/test";
import type { RiskAlertDetail } from "../../../../packages/shared-types";
import type { NewsRow } from "../../lib/detail/types";
import { stableInkProfile } from "./helpers/chartInk";
import { makeBars, mockDetailPage, type DetailMockOptions } from "./helpers/detailPageMock";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import { ALERT, candidateCard, crashCard, LATEST } from "./helpers/riskApiMock";

test.use({ viewport: { width: 1280, height: 720 }, timezoneId: "UTC" });

const BARS = makeBars(260);
const DAY = "2026-10-08";
const OTHER_DAY = "2026-09-15";
const THEME = { id: "ai", label: { en: "AI Infrastructure", ko: "AI 인프라" } };
const CHART = '[data-testid="tv-chart"]';

const peer = (ticker: string, return_pct: number) => ({ ticker, name: `${ticker} Corp`, return_pct });
const PEERS = [peer("P1", -9), peer("P2", -8), peer("P3", -7), peer("P4", -6), peer("P5", -5), peer("P6", -4), peer("P7", -3), peer("P8", -2)];

const row = (headline: string, published_at: string | null, published_date = "2026-10-08"): NewsRow => ({
  id: null, headline, url: `https://example.com/${encodeURIComponent(headline)}`, source: "Wire", published_date, published_at,
});

async function open(page: Page, options: DetailMockOptions = {}, ticker = "AAPL") {
  const log = await mockDetailPage(page, ticker, { bars: BARS, ...options });
  await page.goto(`/detail/${encodeURIComponent(ticker)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("big-move-list")).toBeVisible({ timeout: 60_000 });
  return log;
}

const mark = (page: Page, date: string) => page.getByTestId("big-move-list").locator(`button[data-date="${date}"]`);
const value = (page: Page, id: string) => page.getByTestId(id).locator('[data-part="value"]');

test("clicking a mark opens the card with market, theme and peers", async ({ page }) => {
  await open(page, {
    moves: {
      [DAY]: {
        return_pct: -6.2, market: { ticker: "^GSPC", return_pct: -1.1 }, theme: { ...THEME, return_pct: -4.8 }, peers: PEERS,
        events: [{ category: "geopolitical", title: "Tariff announcement" }], alerts: [{ id: 11, kind: "risk", role: "start" }],
        news: { stored: 3, searched: true },
      },
      [OTHER_DAY]: { return_pct: 5, market: null, theme: null, peers: [], news: { stored: 1, searched: true } },
    },
  });
  await expect(page.getByTestId("move-card")).toHaveCount(0);

  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card-date")).toHaveText(DAY);
  await expect(value(page, "card-stock")).toHaveText("-6.2%");
  await expect(value(page, "card-market")).toHaveText("-1.1%");
  await expect(value(page, "card-theme")).toHaveText("-4.8%");
  await expect(page.getByTestId("card-theme")).toContainText("AI Infrastructure");
  // Six peers shown (the three weakest and three strongest of eight), the other two counted.
  const chips = page.getByTestId("card-peers").locator("a");
  await expect(chips).toHaveCount(6);
  await expect(chips.nth(0)).toContainText("P1");
  await expect(chips.nth(2)).toContainText("P3");
  await expect(chips.nth(3)).toContainText("P6");
  await expect(chips.nth(5)).toContainText("P8");
  await expect(chips.nth(0)).toContainText("-9.0%");
  await expect(page.getByTestId("card-peers-more")).toHaveText("+2");
  await expect(page.getByTestId("card-events")).toContainText("Tariff announcement");
  await expect(page.getByTestId("card-alerts")).toContainText("Crash alert started");
  await expect(page.getByTestId("card-news")).toContainText("3 stored articles");

  // A day with no theme and no S&P 500 reading shows a dash, not a zero.
  await mark(page, OTHER_DAY).click();
  await expect(page.getByTestId("move-card-date")).toHaveText(OTHER_DAY);
  await expect(value(page, "card-stock")).toHaveText("+5.0%");
  await expect(value(page, "card-theme")).toHaveText("—");
  await expect(value(page, "card-market")).toHaveText("—");
  await expect(page.getByTestId("card-peers")).toHaveCount(0);
});

test("the news column follows the clicked day and groups stock and theme", async ({ page }) => {
  const log = await open(page, {
    feed: ({ ticker, from }) => {
      if (from === null) return [row(ticker ? "Latest stock headline" : "Latest theme headline", null)];
      return [row(ticker ? "Dated stock headline" : "Dated theme headline", "2026-10-08T14:30:00Z")];
    },
  });
  await expect(page.getByTestId("news-heading")).toHaveText("Latest news");
  await expect(page.getByTestId("news-group-stock")).toContainText("Latest stock headline");
  await expect(page.getByTestId("news-group-theme")).toContainText("Latest theme headline");
  expect(log.feed.some((query) => query.includes("limit=20") && !query.includes("from="))).toBe(true);

  await mark(page, DAY).click();
  await expect(page.getByTestId("news-heading")).toHaveText(`News around ${DAY}`);
  await expect(page.getByTestId("news-group-stock")).toContainText("Dated stock headline");
  await expect(page.getByTestId("news-group-stock")).not.toContainText("Latest");
  await expect(page.getByTestId("news-group-theme")).toContainText("Dated theme headline");
  await expect(page.getByTestId("news-group-stock").getByRole("heading")).toHaveText("This stock");
  await expect(page.getByTestId("news-group-theme").getByRole("heading")).toHaveText("Theme");
  // Two days either side of the clicked day, for the stock and for its theme.
  expect(log.feed.some((query) => query.includes("ticker=AAPL") && query.includes("from=2026-10-06") && query.includes("to=2026-10-10"))).toBe(true);
  expect(log.feed.some((query) => query.includes("topic=theme%3Aai") && query.includes("from=2026-10-06") && query.includes("to=2026-10-10"))).toBe(true);

  await mark(page, DAY).click();
  await expect(page.getByTestId("news-heading")).toHaveText("Latest news");
});

test("a timed row shows its date and time, a row without published_at shows the date only", async ({ page }) => {
  await open(page, {
    feed: ({ ticker }) => (ticker ? [row("Timed headline", "2026-10-08T14:30:00Z"), row("Dateless headline", null, "2026-10-07")] : []),
  });
  const rows = page.getByTestId("news-group-stock").getByTestId("news-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByTestId("news-when")).toHaveText("10-08 14:30");
  await expect(rows.nth(1).getByTestId("news-when")).toHaveText("2026-10-07");
  await expect(rows.nth(1)).not.toContainText(/\d\d:\d\d/);
  await expect(rows.nth(1)).toContainText("Wire");
});

test.describe("viewer in Seoul", () => {
  test.use({ timezoneId: "Asia/Seoul" });
  test("a timed row's date and time come from the same instant in the viewer's zone", async ({ page }) => {
    // 20:30Z on Oct 8 is 05:30 on Oct 9 in Seoul, though the row's published_date says Oct 8.
    await open(page, { feed: ({ ticker }) => (ticker ? [row("Late headline", "2026-10-08T20:30:00Z", "2026-10-08")] : []) });
    await expect(page.getByTestId("news-group-stock").getByTestId("news-when")).toHaveText("10-09 05:30");
  });
});

test("find-news: the button shows a pending state, then the card and column refresh", async ({ page }) => {
  let searched = false;
  const log = await open(page, {
    moves: { [DAY]: () => ({ news: searched ? { stored: 2, searched: true } : { stored: 0, searched: false } }) },
    history: [{ status: "searched_now" }],
    feed: ({ ticker, from }) => (searched && ticker && from ? [row("Found headline", "2026-10-07T09:00:00Z")] : []),
  });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/news/history", async (route) => {
    await gate;
    searched = true;
    return route.fallback();
  });

  await mark(page, DAY).click();
  await expect(page.getByTestId("card-news")).toContainText("0 stored articles");
  await page.getByRole("button", { name: "Find news for this date" }).click();
  await expect(page.getByTestId("find-news-pending")).toHaveText("Searching, this takes a few seconds…");
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
  release();
  await expect(page.getByTestId("card-news")).toContainText("2 stored articles");
  await expect(page.getByTestId("news-group-stock")).toContainText("Found headline");
  await expect(page.getByTestId("find-news-pending")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
  expect(log.history).toEqual([{ ticker: "AAPL", date: DAY }]);
});

test("find-news: a search that finds nothing ends in the no-news message", async ({ page }) => {
  let searched = false;
  await open(page, {
    moves: { [DAY]: () => ({ news: { stored: 0, searched } }) },
    history: [{ status: "searched_now" }],
  });
  await page.route("**/api/v1/news/history", (route) => {
    searched = true;
    return route.fallback();
  });
  await mark(page, DAY).click();
  await page.getByRole("button", { name: "Find news for this date" }).click();
  await expect(page.getByTestId("no-news-found")).toHaveText("The search found no news for this period.");
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
});

test("find-news: an already searched empty window shows no button, a stored one neither", async ({ page }) => {
  await open(page, {
    moves: { [DAY]: { news: { stored: 0, searched: true } }, [OTHER_DAY]: { news: { stored: 4, searched: false } } },
  });
  await mark(page, DAY).click();
  await expect(page.getByTestId("no-news-found")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
  await mark(page, OTHER_DAY).click();
  await expect(page.getByTestId("card-news")).toContainText("4 stored articles");
  await expect(page.getByTestId("no-news-found")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
});

test("find-news: blocked and daily-limit show the retry time, a failure shows the failure message", async ({ page }) => {
  await open(page, {
    moves: { [DAY]: { news: { stored: 0, searched: false } } },
    history: [
      { status: "blocked", retry_after: "2026-10-25T09:15:00Z" },
      { status: "daily_limit", retry_after: "2026-10-26T00:05:00Z" },
      { status: "failed" },
    ],
  });
  await mark(page, DAY).click();
  const button = page.getByRole("button", { name: "Find news for this date" });
  await button.click();
  await expect(page.getByTestId("find-news-blocked")).toHaveText("Search is not available right now. Try again after 09:15.");
  await expect(page.getByTestId("no-news-found")).toHaveCount(0);
  await button.click();
  await expect(page.getByTestId("find-news-blocked")).toHaveText("Search is not available right now. Try again after 00:05.");
  await button.click();
  await expect(page.getByTestId("find-news-failed")).toHaveText("The search failed. Try again later.");
  await expect(page.getByTestId("find-news-blocked")).toHaveCount(0);
  await expect(button).toBeVisible();
});

test("find-news: an HTTP error shows the failure message", async ({ page }) => {
  await open(page, { moves: { [DAY]: { news: { stored: 0, searched: false } } } });
  await page.route("**/api/v1/news/history", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await mark(page, DAY).click();
  await page.getByRole("button", { name: "Find news for this date" }).click();
  await expect(page.getByTestId("find-news-failed")).toBeVisible();
});

test("find-news: a blocked answer without a usable retry time says so without a time", async ({ page }) => {
  await open(page, {
    moves: { [DAY]: { news: { stored: 0, searched: false } } },
    history: [{ status: "blocked", retry_after: null }, { status: "daily_limit", retry_after: "not a date" }],
  });
  await mark(page, DAY).click();
  const button = page.getByRole("button", { name: "Find news for this date" });
  await button.click();
  await expect(page.getByTestId("find-news-blocked")).toHaveText("Search is not available right now. Try again later.");
  await button.click();
  await expect(page.getByTestId("find-news-blocked")).toHaveText("Search is not available right now. Try again later.");
  await expect(page.locator("body")).not.toContainText("Invalid Date");
  await expect(page.locator("body")).not.toContainText("after .");
});

test("find-news: a blocked answer after articles were saved still refreshes the card and the column", async ({ page }) => {
  let saved = false;
  await open(page, {
    moves: { [DAY]: () => ({ news: saved ? { stored: 2, searched: true } : { stored: 0, searched: false } }) },
    history: [{ status: "blocked", retry_after: "2026-10-25T09:15:00Z" }],
    feed: ({ ticker, from }) => (saved && ticker && from ? [row("Saved before the block", "2026-10-07T09:00:00Z")] : []),
  });
  await page.route("**/api/v1/news/history", (route) => {
    saved = true;
    return route.fallback();
  });
  await mark(page, DAY).click();
  await page.getByRole("button", { name: "Find news for this date" }).click();
  await expect(page.getByTestId("card-news")).toContainText("2 stored articles");
  await expect(page.getByTestId("news-group-stock")).toContainText("Saved before the block");
});

test("find-news: the button stays gone until the refetch ends, so a second click cannot send a second search", async ({ page }) => {
  let searched = false;
  let releaseMove: () => void = () => {};
  const moveGate = new Promise<void>((resolve) => { releaseMove = resolve; });
  const log = await open(page, {
    moves: { [DAY]: () => ({ news: searched ? { stored: 2, searched: true } : { stored: 0, searched: false } }) },
    history: [{ status: "searched_now" }],
  });
  await page.route("**/api/v1/news/history", (route) => {
    searched = true;
    return route.fallback();
  });
  await mark(page, DAY).click();
  await expect(page.getByTestId("card-news")).toContainText("0 stored articles");
  // Hold the card's refetch (the one after the search), so the POST has finished while the card is still stale.
  await page.route(`**/api/v1/detail/AAPL/move/${DAY}`, async (route) => {
    if (searched) await moveGate;
    return route.fallback();
  });
  await page.getByRole("button", { name: "Find news for this date" }).click();
  await expect.poll(() => log.history.length).toBe(1);
  await expect(page.getByTestId("find-news-pending")).toBeVisible();
  await page.waitForTimeout(500); // the POST is long done by now; only the held refetch is outstanding
  await expect(page.getByTestId("find-news-pending")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
  releaseMove();
  await expect(page.getByTestId("card-news")).toContainText("2 stored articles");
  await expect(page.getByTestId("find-news-pending")).toHaveCount(0);
  expect(log.history).toHaveLength(1);
});

test("Esc inside a threshold input does not close the card", async ({ page }) => {
  await open(page, { moves: { [DAY]: { news: { stored: 1, searched: true } } } });
  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card")).toBeVisible();
  const input = page.locator('input[type="number"]').first();
  await input.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("move-card")).toBeVisible();
  await input.blur();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("move-card")).toHaveCount(0);
});

test("Esc closes the card, and so does a second click on the same mark", async ({ page }) => {
  await open(page, { moves: { [DAY]: { news: { stored: 1, searched: true } } } });
  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("move-card")).toHaveCount(0);
  await expect(mark(page, DAY)).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByTestId("news-heading")).toHaveText("Latest news");

  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card")).toBeVisible();
  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card")).toHaveCount(0);

  await mark(page, DAY).click();
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("move-card")).toHaveCount(0);
});

test("the selected day is ringed on the chart, so it can be found among the marks", async ({ page }) => {
  await open(page);
  const total = async () => (await stableInkProfile(page, CHART)).ink.reduce((sum, column) => sum + column, 0);
  const before = await total();
  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card")).toBeVisible();
  const selected = await total();
  expect(selected, "the selected mark carries an extra ring").toBeGreaterThan(before);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("move-card")).toHaveCount(0);
  expect(await total(), "deselecting removes the ring").toBe(before);
});

function alertWithDecks(crash: number, candidates: number, crashTickerAt: Record<number, string> = {}, candidateTickerAt: Record<number, string> = {}): RiskAlertDetail {
  const crashCards = Array.from({ length: crash }, (_, i) => ({ ...crashCard(i + 1), ...(crashTickerAt[i + 1] ? { ticker: crashTickerAt[i + 1] } : {}) }));
  const candidateCards = Array.from({ length: candidates }, (_, i) => ({ ...candidateCard(i + 1), ...(candidateTickerAt[i + 1] ? { ticker: candidateTickerAt[i + 1] } : {}) }));
  return {
    ...ALERT,
    crash: { as_of: "2026-10-19", total: crash, cards: crashCards },
    candidates: { as_of: "2026-10-19", total: candidates, cards: candidateCards },
  };
}

test("badge shows for a ticker ranked 12th in the open alert's crash deck", async ({ page }) => {
  const full = alertWithDecks(14, 0, { 12: "AAPL" });
  const log = await open(page, {
    risk: { ...LATEST.risk, alert: { ...full, crash: { ...full.crash, cards: full.crash.cards.slice(0, 10) } } },
    alertAll: full,
  });
  await expect(page.getByTestId("alert-badge")).toHaveText("In the crash alert");
  await expect(page.getByTestId("alert-badge")).toHaveAttribute("data-kind", "crash");
  expect(log.alertQueries.some((query) => query.includes("cards=all"))).toBe(true);
});

test("badge says candidate for a ticker only in the candidate deck", async ({ page }) => {
  const full = alertWithDecks(11, 12, {}, { 11: "AAPL" });
  await open(page, { risk: { ...LATEST.risk, alert: full }, alertAll: full });
  await expect(page.getByTestId("alert-badge")).toHaveText("In the risk candidates");
});

test("no badge without an open alert", async ({ page }) => {
  await open(page);
  await expect(page.getByTestId("detail-header")).toBeVisible();
  await expect(page.getByTestId("alert-badge")).toHaveCount(0);
});

test("no badge when the open alert lists other tickers", async ({ page }) => {
  const full = alertWithDecks(12, 12);
  await open(page, { risk: { ...LATEST.risk, alert: full }, alertAll: full });
  await expect(page.getByTestId("detail-header")).toBeVisible();
  await expect(page.getByTestId("alert-badge")).toHaveCount(0);
});

test("off the watchlist the news column is absent, and the card still opens with the market reading", async ({ page }) => {
  await open(page, { moves: { [DAY]: { market: null, news: null, peers: [] } } }, "^GSPC");
  await expect(page.getByTestId("detail-news-slot")).toHaveCount(0);
  await mark(page, DAY).click();
  await expect(page.getByTestId("move-card")).toBeVisible();
  await expect(page.getByTestId("card-news")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Find news for this date" })).toHaveCount(0);
});

test("with the card open the page still fits one screen and neither the chart panel nor the card scrolls", async ({ page }) => {
  await open(page, {
    moves: { [DAY]: { market: { ticker: "^GSPC", return_pct: -1.1 }, theme: { ...THEME, return_pct: -4.8 }, peers: PEERS, news: { stored: 0, searched: false },
      events: [{ category: "x", title: "Tariff announcement" }], alerts: [{ id: 11, kind: "risk", role: "start" }] } },
  });
  await mark(page, DAY).click();
  await expect(page.getByTestId("card-news")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectNoPageScroll(page, "/detail/AAPL with the card open");
  const overflow = await page.getByTestId("detail-chart-slot").evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow, "the chart panel's content fits without an inner scroll").toBeLessThanOrEqual(0);
  const cardOverflow = await page.getByTestId("move-card").evaluate((el) => el.parentElement!.scrollHeight - el.parentElement!.clientHeight);
  expect(cardOverflow, "the card fits its column without an inner scroll").toBeLessThanOrEqual(0);
  await expect(page.getByTestId("detail-movers-up")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("detail-movers-up")).toBeVisible();
});
