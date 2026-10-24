import { expect, test, type Page } from "@playwright/test";
import type { NewsItemOut, RiskLatest } from "../../../../packages/shared-types";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import {
  ALERT, LAST_ALERT, LATEST, SURGE_BANNER, crashCard, deck, markSignalsSeen, mockRisk, type RiskScenario,
} from "./helpers/riskApiMock";

// Risk UI spec §3 and plan Task 4: the signal panel over "/".
const strip = (page: Page) => page.getByTestId("signal-strip");
const panel = (page: Page) => page.getByRole("dialog");
const front = (page: Page) => panel(page).getByTestId("deck-card");
const ALERT_KEY = `mv.risk.seen.alert:${ALERT.id}`;

async function load(page: Page, latest: RiskScenario | RiskLatest, { seen = true } = {}) {
  await mockMarketPageApi(page);
  await mockRisk(page, latest);
  if (seen) await markSignalsSeen(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(strip(page)).not.toHaveAttribute("data-state", "loading", { timeout: 60_000 });
}

async function openPanel(page: Page, latest: RiskScenario | RiskLatest) {
  await load(page, latest);
  await strip(page).click();
  await expect(panel(page)).toBeVisible();
}

/** The auto-open runs in an effect after the strip has data; give it time to fire before asserting it did not. */
async function expectNoAutoOpen(page: Page) {
  await page.waitForTimeout(750);
  await expect(panel(page)).toHaveCount(0);
}

test("open by strip and close by button, Esc and outside", async ({ page }) => {
  await load(page, "neutral");
  await expectNoAutoOpen(page);
  const url = page.url();

  await strip(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(strip(page)).toHaveAttribute("aria-expanded", "true");
  await panel(page).getByRole("button", { name: "Close modal" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(strip(page)).toHaveAttribute("aria-expanded", "false");

  await strip(page).click();
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);

  await strip(page).click();
  await expect(panel(page)).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(panel(page)).toHaveCount(0);
  expect(page.url(), "opening and closing the panel never changes the address").toBe(url);
});

test("auto-open once per alert id", async ({ page }) => {
  await load(page, "risk", { seen: false });
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("tab", { selected: true })).toHaveText("Crash 0");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), ALERT_KEY)).not.toBeNull();
  await page.keyboard.press("Escape");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(strip(page)).toHaveAttribute("data-state", "risk", { timeout: 60_000 });
  await expectNoAutoOpen(page);

  // A new alert id opens it again, once.
  await mockRisk(page, { ...LATEST.risk, alert: { ...ALERT, id: 13 } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(panel(page)).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(strip(page)).toHaveAttribute("data-state", "risk", { timeout: 60_000 });
  await expectNoAutoOpen(page);
});

test("auto-open once per surge banner_since; yesterday's gainers never open it", async ({ page }) => {
  await load(page, "neutral", { seen: false });
  await expectNoAutoOpen(page);

  await mockRisk(page, "surge");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(panel(page)).toBeVisible({ timeout: 60_000 });
  await expect(panel(page).getByRole("tab", { selected: true })).toHaveText("Surge 3");
  expect(await page.evaluate((key) => window.localStorage.getItem(key), `mv.risk.seen.surge:${SURGE_BANNER.banner_since}`)).not.toBeNull();
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(strip(page)).toHaveAttribute("data-state", "surge", { timeout: 60_000 });
  await expectNoAutoOpen(page);
});

test("auto-open every time when storage throws", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Blocked site storage: no key can be read or written, the locale's included (final review I3).
  await page.addInitScript(() => {
    Storage.prototype.getItem = function () {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.setItem = function () {
      throw new DOMException("blocked", "SecurityError");
    };
  });
  await load(page, "risk", { seen: false });
  await expect(panel(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(panel(page)).toBeVisible({ timeout: 60_000 });
  expect(errors, "nothing crashes").toEqual([]);
});

test.describe("in Korean", () => {
  test.use({ locale: "ko-KR" });

  test("tabs switch decks and show empty states", async ({ page }) => {
    await openPanel(page, { ...LATEST.risk, alert: { ...ALERT, crash: deck(3, crashCard) }, surge: null, movers: null });
    const tabs = panel(page).getByRole("tab");
    await expect(tabs).toHaveText(["급락 3", "위험 후보 0", "급등 0", "어제 상승 0"]);
    await expect(front(page)).toContainText("CR1");

    await panel(page).getByRole("tab", { name: "위험 후보 0" }).click();
    await expect(panel(page).getByRole("tab", { selected: true })).toHaveText("위험 후보 0");
    await expect(panel(page).getByText("지금은 해당 종목이 없습니다.")).toBeVisible();
    await expect(front(page)).toHaveCount(0);
    await panel(page).getByRole("tab", { name: "급등 0" }).click();
    await expect(panel(page).getByText("지금은 급등 중인 테마가 없습니다.")).toBeVisible();
    await panel(page).getByRole("tab", { name: "어제 상승 0" }).click();
    await expect(panel(page).getByText("지금은 해당 종목이 없습니다.")).toBeVisible();
    await expect(panel(page).getByText("예측이 아닌 어제의 결과입니다.")).toHaveCount(0);
    await panel(page).getByRole("tab", { name: "급락 3" }).click();
    await expect(front(page)).toContainText("CR1");
  });
});

test("no-alert tabs show last alert record", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/risk/alerts/")) requested.push(new URL(request.url()).pathname);
  });
  await openPanel(page, "neutral");
  await expect(panel(page).getByRole("tab", { selected: true })).toHaveText("Crash 2");
  await expect(panel(page).getByTestId("last-alert-note")).toHaveText(`Last alert (${LAST_ALERT.start_date}) record`);
  await expect(front(page)).toContainText("OLD1");
  await expect(panel(page).getByTestId("deck-position")).toHaveText("1 / 2");
  await panel(page).getByRole("tab", { name: "At risk 1" }).click();
  await expect(panel(page).getByTestId("last-alert-note")).toHaveText(`Last alert (${LAST_ALERT.start_date}) record`);
  await expect(front(page)).toContainText("OLDC");
  expect(requested).toContain(`/api/v1/risk/alerts/${LAST_ALERT.id}`);
  await expect(panel(page).getByRole("link", { name: "View records ›" })).toHaveAttribute("href", "/alerts");
});

const news = (title: string, kind: NewsItemOut["kind"], topic: string | null): NewsItemOut => ({
  title, url: `https://example.com/${encodeURIComponent(title)}`, source: "Wire", published_date: "2026-10-18",
  lang: "en", kind, topic, theme: kind === "industry" ? "semis" : null, ticker: null,
});

test("news column shows figures, shortfall and note", async ({ page }) => {
  await openPanel(page, {
    ...LATEST.risk,
    alert: {
      ...ALERT,
      news: [news("Chipmakers cut guidance", "industry", null), news("CPI runs hot in September", "macro", "cpi"), news("Fed holds", "macro", "rates")],
      macro_figures: [{
        topic: "cpi", series: "CPIAUCSL", label: { ko: "CPI", en: "CPI" }, kind: "mm_pct",
        latest: { period: "2026-09", value: 0.65 }, prior: { period: "2026-08", value: 0.4 },
      }],
      news_shortfall: 2, news_note: "feed_failed",
    },
  });
  const column = panel(page).getByTestId("news-column");
  await expect(panel(page).getByTestId("warnings-table")).toHaveCount(0);
  const titles = column.getByRole("link");
  await expect(titles).toHaveText(["CPI runs hot in September", "Fed holds", "Chipmakers cut guidance"]);
  await expect(titles.first()).toHaveAttribute("target", "_blank");
  const figure = column.getByTestId("macro-figure");
  await expect(figure).toHaveCount(1);
  await expect(figure).toHaveText("CPI 2026-09 +0.65% m/m (2026-08 +0.40%)");
  await expect(figure.locator(".type-mono").first()).toHaveText("+0.65%");
  await expect(column.getByTestId("news-shortfall")).toHaveText("2 short");
  await expect(column.getByTestId("news-note")).toHaveText("Recent collection failed");
  await expect(panel(page).getByRole("link", { name: "View records ›" })).toHaveAttribute("href", `/alerts/risk/${ALERT.id}`);
});

test("an auto-open that lands while the index detail is open waits for it to close", async ({ page }) => {
  // Final review M7: the 5-minute /latest refetch brought a new alert and stacked the panel over the index modal.
  await page.clock.install();
  await mockMarketPageApi(page);
  await mockRisk(page, "neutral");
  await markSignalsSeen(page);
  let latest: RiskLatest = LATEST.neutral;
  await page.route("**/api/v1/risk/latest", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: latest, meta: {} }) }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(strip(page)).not.toHaveAttribute("data-state", "loading", { timeout: 60_000 });
  await expectNoAutoOpen(page);

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1, { timeout: 60_000 });
  latest = { ...LATEST.risk, alert: { ...ALERT, id: 77 } };
  await page.clock.fastForward("05:30");
  await expect(strip(page)).toHaveAttribute("data-state", "risk", { timeout: 30_000 });
  await page.waitForTimeout(750);
  await expect(page.getByRole("dialog"), "the panel does not stack over the index detail").toHaveCount(1);
  await expect(page.getByRole("dialog").getByRole("tablist")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(panel(page).getByRole("tablist")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
});

test("headlines and news without a URL keep distinct keys", async ({ page }) => {
  // The API sends url="" when it has none (final review M5); two such items once collided on the key "".
  const keyErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("same key")) keyErrors.push(message.text());
  });
  const noUrl = (title: string): NewsItemOut => ({ ...news(title, "macro", "rates"), url: "" });
  const card = {
    ...crashCard(1),
    headlines: [
      { title: "First untitled wire", url: "", published_date: "2026-10-18", lang: "en" },
      { title: "Second untitled wire", url: "", published_date: "2026-10-17", lang: "en" },
    ],
  };
  await openPanel(page, {
    ...LATEST.risk,
    alert: { ...ALERT, crash: { as_of: "2026-10-19", total: 1, cards: [card] }, news: [noUrl("Rates note one"), noUrl("Rates note two")] },
  });
  await expect(front(page).locator("li")).toHaveText(["First untitled wire", "Second untitled wire"]);
  await expect(panel(page).getByTestId("news-column").getByRole("link")).toHaveText(["Rates note one", "Rates note two"]);
  expect(keyErrors).toEqual([]);
});

test("warnings table when no alert", async ({ page }) => {
  await openPanel(page, "neutral");
  await expect(panel(page).getByTestId("news-column")).toHaveCount(0);
  const table = panel(page).getByTestId("warnings-table");
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(6);
  await expect(rows.first().locator("td")).toHaveText(["Credit spread", "On", "1.20%", "2026-10-19", "Credit spread rule"]);
  await expect(rows.last().locator("td")).toHaveText(["Drawdown", "Unknown", "—", "2026-10-19", "Drawdown rule"]);
  await expect(rows.first().locator("td").nth(2)).toHaveClass(/type-mono/);
});

test.describe("loading and error states", () => {
  test("a failed /latest shows the error state in the panel", async ({ page }) => {
    await openPanel(page, "error");
    await expect(panel(page).getByText("Signals could not be loaded.")).toBeVisible();
    await expect(panel(page).getByRole("tablist")).toHaveCount(0);
  });

  test("a pending /latest shows the loading state in the panel", async ({ page }) => {
    await mockMarketPageApi(page);
    await page.route("**/api/v1/risk/latest", () => { /* never answers */ });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(strip(page)).toHaveAttribute("data-state", "loading", { timeout: 60_000 });
    // The server HTML is also "loading": click until the hydrated strip opens the panel.
    await expect(async () => {
      await strip(page).click();
      await expect(panel(page)).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 60_000 });
    await expect(panel(page).getByTestId("signal-panel-loading")).toBeVisible();
    await expect(panel(page).getByRole("tablist")).toHaveCount(0);
  });
});

const MANY_NEWS: NewsItemOut[] = Array.from({ length: 24 }, (_, i) => news(`Headline number ${i + 1} about the sell-off`, i < 4 ? "macro" : "industry", i < 4 ? "cpi" : null));

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test.describe(`panel open at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, locale: "ko-KR" });

    test("no page scroll; the news list scrolls inside the panel", async ({ page }) => {
      await openPanel(page, {
        ...LATEST.both, alert: { ...ALERT, crash: deck(11, crashCard), news: MANY_NEWS, news_shortfall: 1, news_note: "before_collection" },
      });
      await expect(front(page)).toBeVisible();
      await expectNoPageScroll(page, `panel open at ${viewport.width}`);
      for (const [name, locator] of [
        ["panel", panel(page)], ["front card", front(page)], ["tabs", panel(page).getByRole("tablist")],
        ["records link", panel(page).getByRole("link", { name: "기록 보기 ›" })],
      ] as const) {
        await expect(locator, `${name} is fully on screen`).toBeInViewport({ ratio: 1 });
      }
      const list = panel(page).getByTestId("news-column");
      const size = await list.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }));
      expect(size.overflow).toBe("auto");
      expect(size.scroll, "the news list is longer than its box, so it scrolls inside").toBeGreaterThan(size.client);
      if (viewport.width === 1280) {
        const deckBox = (await panel(page).getByTestId("card-deck").boundingBox())!;
        const listBox = (await list.boundingBox())!;
        expect(listBox.x, "at 1280 the news sits right of the deck").toBeGreaterThanOrEqual(deckBox.x + deckBox.width);
      } else {
        const tabsBox = (await panel(page).getByRole("tablist").boundingBox())!;
        const listBox = (await list.boundingBox())!;
        expect(listBox.y, "at 390 the news stacks under the deck and tabs").toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height);
      }
    });
  });
}
