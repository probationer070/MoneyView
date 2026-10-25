import { expect, test } from "@playwright/test";
import type { Bar } from "../../lib/detail/types";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { makeBars, mockDetailPage } from "./helpers/detailPageMock";
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

async function open(page: import("@playwright/test").Page, ticker: string) {
  await mockDetailPage(page, ticker, { bars: BARS });
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

test.describe("Korean copy", () => {
  test.use({ locale: "ko-KR" });
  test("tile and column titles are Korean", async ({ page }) => {
    await open(page, "AAPL");
    await expect(page.getByTestId("tile-1w")).toContainText("1주");
    await expect(page.getByTestId("tile-yesterday")).toContainText("어제 장");
    await expect(page.getByTestId("detail-movers-up")).toContainText("전일 급등");
    await expect(page.getByTestId("detail-movers-down")).toContainText("전일 급락");
    await expect(page.getByTestId("tile-1w")).not.toContainText("1 week");
  });
});
