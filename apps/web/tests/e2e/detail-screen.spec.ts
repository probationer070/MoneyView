import { expect, test } from "@playwright/test";
import type { Bar } from "../../lib/detail/types";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { makeBars, mockDetailPage, MOVER_THEME } from "./helpers/detailPageMock";
import { expectNoPageScroll } from "./helpers/noPageScroll";

test.use({ viewport: { width: 1280, height: 720 } });

const BARS = makeBars(260);

// Reference values, computed here from the bars with the textbook definitions (not from lib/detail/metrics).
const last = (n = 0) => BARS[BARS.length - 1 - n];
const returnOver = (n: number) => (last().close / last(n).close - 1) * 100;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const average = (n: number) => mean(BARS.slice(-n).map((bar) => bar.close));
function wilderRsi(bars: Bar[]): number {
  const changes = bars.slice(1).map((bar, i) => bar.close - bars[i].close);
  let gain = mean(changes.slice(0, 14).map((c) => Math.max(c, 0)));
  let loss = mean(changes.slice(0, 14).map((c) => Math.max(-c, 0)));
  for (const c of changes.slice(14)) {
    gain = (gain * 13 + Math.max(c, 0)) / 14;
    loss = (loss * 13 + Math.max(-c, 0)) / 14;
  }
  return 100 - 100 / (1 + gain / loss);
}
const pct = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;

async function open(page: import("@playwright/test").Page, ticker: string, bars: Bar[] = BARS) {
  await mockDetailPage(page, ticker, { bars });
  await page.goto(`/detail/${encodeURIComponent(ticker)}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
}

test("the detail page fits one screen", async ({ page }) => {
  await open(page, "AAPL");
  await expect(page.getByTestId("tile-1w")).toBeVisible();
  await expect(page.getByTestId("detail-movers-up")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectNoPageScroll(page, "/detail/AAPL");
});

test("header shows name, sector, theme and corporate link", async ({ page }) => {
  await open(page, "AAPL");
  const header = page.getByTestId("detail-header");
  await expect(header).toContainText("AAPL Inc");
  await expect(header).toContainText("Technology");
  await expect(page.getByTestId("detail-theme")).toContainText("AI Infrastructure");
  await expect(page.getByRole("link", { name: "Open in Corporate Analysis" })).toHaveAttribute("href", "/corporate?ticker=AAPL");
});

test("tiles show values computed from the bars", async ({ page }) => {
  await open(page, "AAPL");
  await expect(page.getByTestId("tile-1w").getByTestId("tile-return")).toContainText(pct(returnOver(5)));
  await expect(page.getByTestId("tile-1m").getByTestId("tile-return")).toContainText(pct(returnOver(21)));
  await expect(page.getByTestId("tile-6m").getByTestId("tile-return")).toContainText(pct(returnOver(126)));
  await expect(page.getByTestId("tile-1w").getByTestId("tile-note")).toContainText(last().close > average(20) ? "Above" : "Below");
  await expect(page.getByTestId("tile-1m").getByTestId("tile-note")).toContainText(last().close > average(50) ? "Above" : "Below");
  const fromHigh = (last().close / Math.max(...BARS.slice(-126).map((bar) => bar.high)) - 1) * 100;
  await expect(page.getByTestId("tile-6m").getByTestId("tile-note")).toContainText(`${fromHigh.toFixed(1)}%`);
  const volume = last().volume / mean(BARS.slice(-21, -1).map((bar) => bar.volume));
  const yesterday = page.getByTestId("tile-yesterday");
  await expect(yesterday.getByTestId("tile-return")).toContainText(pct(returnOver(1)));
  await expect(yesterday.getByTestId("tile-volume")).toContainText(`${volume.toFixed(1)}x`);
  await expect(yesterday.getByTestId("tile-rsi")).toContainText(wilderRsi(BARS).toFixed(1));
  await expect(yesterday.getByTestId("tile-range")).toContainText(last().high.toFixed(2));
  await expect(yesterday.getByTestId("tile-range")).toContainText(last().low.toFixed(2));
});

/** The last `closes.length` bars get these closes (high and low hug the close); every volume is 1,000,000 except the last. */
function withLastCloses(closes: number[], lastVolume: number): Bar[] {
  const bars = makeBars(260);
  const offset = bars.length - closes.length;
  return bars.map((bar, i) => {
    if (i < offset) return bar;
    const close = closes[i - offset];
    return { ...bar, open: close, high: close * 1.001, low: close * 0.999, close, volume: i === bars.length - 1 ? lastVolume : 1_000_000 };
  });
}

test("the 1W and 1M notes use the 20 and 50 day averages, and volume excludes the last bar", async ({ page }) => {
  // 30 closes at 80, 19 at 120, then 100: MA20 = 119 (close below), MA50 = 95.6 (close above); volume 3x the 20 before it.
  await open(page, "AAPL", withLastCloses([...Array(30).fill(80), ...Array(19).fill(120), 100], 3_000_000));
  await expect(page.getByTestId("tile-1w").getByTestId("tile-note")).toHaveText("Below the 20-day average");
  await expect(page.getByTestId("tile-1m").getByTestId("tile-note")).toHaveText("Above the 50-day average");
  await expect(page.getByTestId("tile-yesterday").getByTestId("tile-volume")).toContainText("3.0x");
});

test("too few bars show a dash, never 0 or NaN", async ({ page }) => {
  await open(page, "AAPL", makeBars(10));
  const tiles = page.getByTestId("tile-yesterday");
  await expect(tiles.getByTestId("tile-rsi")).toContainText("—");
  await expect(tiles.getByTestId("tile-volume")).toContainText("—");
  await expect(page.getByTestId("tile-1m").getByTestId("tile-return")).toContainText("—");
  await expect(page.getByTestId("tile-6m").getByTestId("tile-return")).toContainText("—");
  await expect(page.getByTestId("tile-6m").getByTestId("tile-note")).toHaveText("—");
  await expect(page.getByTestId("tile-1w").getByTestId("tile-note")).toHaveText("—");
  await expect(page.getByTestId("tile-1m").getByTestId("tile-note")).toHaveText("—");
  await expect(tiles.getByTestId("tile-rsi")).not.toContainText("0.0");
  expect(await page.locator("body").innerText()).not.toContain("NaN");
});

test("mover rows show the theme label, not its id", async ({ page }) => {
  await open(page, "AAPL");
  const up = page.getByTestId("detail-movers-up");
  await expect(up).toContainText(MOVER_THEME.label.en);
  await expect(up).not.toContainText(MOVER_THEME.id);
});

test("movers list shows five up and five down and navigates", async ({ page }) => {
  await open(page, "AAPL");
  await expect(page.getByTestId("detail-movers-up").getByRole("link")).toHaveCount(5);
  await expect(page.getByTestId("detail-movers-down").getByRole("link")).toHaveCount(5);
  await expect(page.getByTestId("detail-movers-down").locator("[aria-current]")).toContainText("AAPL");
  await page.getByTestId("detail-movers-up").getByRole("link", { name: /INTC/ }).click();
  await expect(page).toHaveURL(/\/detail\/INTC$/);
  await expect(page.getByTestId("detail-movers-up").locator("[aria-current]")).toContainText("INTC");
  await expect(page.getByTestId("detail-header")).toContainText("INTC Inc");
});

test("the movers headings carry the movers date", async ({ page }) => {
  await open(page, "AAPL");
  await expect(page.getByTestId("detail-movers-up").getByTestId("movers-date")).toHaveText("· 2026-10-23");
  await expect(page.getByTestId("detail-movers-down").getByTestId("movers-date")).toHaveText("· 2026-10-23");
});

test("a failed profile request shows an error line", async ({ page }) => {
  await mockDetailPage(page, "AAPL", { bars: BARS });
  await page.route("**/api/v1/detail/AAPL/profile", (route) => route.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("detail-profile-error")).toHaveText("Could not load this stock's profile.", { timeout: 60_000 });
  await expectNoPageScroll(page, "/detail/AAPL with a failed profile");
});

test("a non-watchlist instrument hides theme and news", async ({ page }) => {
  await open(page, "^GSPC");
  await expect(page.getByText("Not on the watchlist")).toBeVisible();
  await expect(page.getByTestId("detail-theme")).toHaveCount(0);
  await expect(page.getByTestId("detail-news-slot")).toHaveCount(0);
});

test("corporate opens on the ticker from the link", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate?ticker=MSFT", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("corporate-company-line")).toContainText("Microsoft", { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("moneyview:corporate-active-ticker:v1") ?? "")).toContain("MSFT");
});

test("corporate drops the address ticker once read, so a reload keeps the company the user switched to", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate?ticker=MSFT", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("corporate-company-line")).toContainText("Microsoft", { timeout: 60_000 });
  await expect(page).toHaveURL(/\/corporate$/);
  // Switching company stores the new ticker for the session.
  await page.evaluate(() => window.sessionStorage.setItem("moneyview:corporate-active-ticker:v1", JSON.stringify("AAPL")));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("corporate-company-line")).toContainText("Apple", { timeout: 60_000 });
});

test.describe("Korean copy", () => {
  test.use({ locale: "ko-KR" });
  test("tile and column titles are Korean", async ({ page }) => {
    await open(page, "AAPL");
    await expect(page.getByTestId("tile-1w")).toContainText("1주");
    await expect(page.getByTestId("tile-yesterday")).toContainText("어제 장");
    await expect(page.getByTestId("detail-movers-up")).toContainText("전일 급등");
    await expect(page.getByTestId("detail-movers-down")).toContainText("전일 급락");
    await expect(page.getByTestId("tile-1w")).not.toContainText("1 week");
    await expect(page.getByTestId("detail-movers-up").getByTestId("movers-date")).toHaveText("· 2026-10-23");
    await expect(page.getByTestId("detail-movers-up")).toContainText(MOVER_THEME.label.ko);
    await expect(page.getByTestId("detail-movers-up")).not.toContainText(MOVER_THEME.id);
  });
});
