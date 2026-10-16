import { expect, test, type Locator, type Page } from "@playwright/test";
import { tokens } from "../../lib/tokens.generated";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { marketPanel, openMarketTab } from "./helpers/marketTabs";
import { expectNoPageScroll } from "./helpers/noPageScroll";

// Spec docs/superpowers/specs/2026-10-16-market-one-screen-design.md; plan Tasks 4-6.
const REGIME = {
  regime_label: "risk_on",
  regime_summary: "Most tracked equity indices are advancing and cross-asset signals lean toward pro-cyclical risk appetite.",
  equity_advancers: 3,
  equity_decliners: 1,
  breadth_ratio: 0.75,
  equity_index_count: 4,
  risk_on_signals: 5,
  risk_off_signals: 0,
  signal_count: 5,
};

/** Registered after mockMarketPageApi, so it answers first (Playwright tries the last route first). */
async function mockRegime(page: Page, body: unknown, status = 200) {
  await page.route("**/api/v1/market/regime", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
}

async function gotoMarket(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Market Overview", exact: true })).toBeVisible({ timeout: 60_000 });
}

const regime = (page: Page) => page.getByTestId("market-regime");
const cards = (page: Page) => page.locator('article:has(button[aria-label^="Open detail for"])');
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("the page never scrolls, on either tab or view; the panel takes the overflow", async ({ page }) => {
      await mockMarketPageApi(page);
      await gotoMarket(page);
      await expect(cards(page).first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectNoPageScroll(page, "Instruments, graph");
      await page.getByRole("button", { name: "Table" }).click();
      await expect(page.getByRole("button", { name: "Open detail for S&P 500 from table" })).toBeVisible();
      await expectNoPageScroll(page, "Instruments, table");
      await openMarketTab(page, "Spreads");
      await expect(marketPanel(page).getByTestId("spreads-section")).toBeVisible();
      await expectNoPageScroll(page, "Spreads");
    });
  });
}

test.describe("the bottom pad", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the overview is a one-screen route: 24px under its panel", async ({ page }) => {
    await mockMarketPageApi(page);
    await gotoMarket(page);
    expect(await page.locator("main").evaluate((element) => getComputedStyle(element).paddingBottom)).toBe("24px");
    const panel = await marketPanel(page).boundingBox();
    expect(panel, "the tab panel is rendered").not.toBeNull();
    expect(720 - (panel!.y + panel!.height), "the gap under the panel").toBeLessThanOrEqual(24 + 1);
  });
});

test.describe("the page tabs", () => {
  test("Instruments is the default, only the active panel is mounted, and a chosen tab survives a reload under its key", async ({ page }) => {
    await mockMarketPageApi(page);
    await gotoMarket(page);
    const tabs = page.getByTestId("market-page-tabs");
    await expect(tabs.getByRole("tab", { name: "Instruments" })).toHaveAttribute("aria-selected", "true");
    await expect(marketPanel(page)).toHaveAttribute("aria-labelledby", "market-tab-instruments");
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByTestId("spreads-section")).toHaveCount(0);
    await openMarketTab(page, "Spreads");
    await expect(marketPanel(page).getByTestId("spreads-section")).toBeVisible();
    await expect(cards(page)).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("moneyview.tab.market.pageTab"))).toBe('"spreads"');
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(tabs.getByRole("tab", { name: "Spreads" })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(marketPanel(page).getByTestId("spreads-section")).toBeVisible();
  });

  test("an unknown stored tab falls back to Instruments", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("moneyview.tab.market.pageTab", JSON.stringify("constructor")));
    await mockMarketPageApi(page);
    // The restore runs in an effect after hydration; let it run before reading the selection.
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.getByTestId("market-page-tabs").getByRole("tab", { name: "Instruments" })).toHaveAttribute("aria-selected", "true");
    await expect(marketPanel(page).locator('article:has(button[aria-label^="Open detail for"])').first()).toBeVisible();
  });
});

test.describe("the regime line", () => {
  test("ready: the backend's label, breadth and signal counts, figures in mono, never its summary", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, REGIME);
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "ready");
    const label = regime(page).locator('[data-part="label"]');
    await expect(label).toHaveText("Risk-on");
    await expect(label).toHaveAttribute("data-tone", "up");
    await expect(label).toHaveCSS("color", rgb(tokens.up._));
    await expect(regime(page).locator('[data-part="breadth"]')).toHaveText("Indices up 3/4");
    await expect(regime(page).locator('[data-part="breadth"] .type-mono')).toHaveText("3/4");
    await expect(regime(page).locator('[data-part="signals"]')).toHaveText("Signals on 5 / off 0");
    await expect(page.getByText(REGIME.regime_summary)).toHaveCount(0);
    await expect(page.locator('[title*="equity indices are advancing"]')).toHaveCount(0);
  });

  test("risk-off is the down colour; colour is never the only signal", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, {
      ...REGIME, regime_label: "risk_off", equity_advancers: 0, equity_decliners: 4, breadth_ratio: 0, risk_on_signals: 0, risk_off_signals: 5,
    });
    await gotoMarket(page);
    const label = regime(page).locator('[data-part="label"]');
    await expect(label).toHaveText("Risk-off");
    await expect(label).toHaveAttribute("data-tone", "down");
    await expect(label).toHaveCSS("color", rgb(tokens.down._));
    await expect(regime(page).locator('[data-part="breadth"]')).toHaveText("Indices up 0/4");
  });

  test("unknown says the regime is unavailable and is not drawn as mixed", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, {
      ...REGIME, regime_label: "unknown", regime_summary: "Regime context is unavailable because there were not enough current market signals.",
      equity_advancers: 0, equity_decliners: 0, breadth_ratio: null, equity_index_count: 0, risk_on_signals: 0, risk_off_signals: 0, signal_count: 0,
    });
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "unknown");
    await expect(regime(page)).toHaveText("Regime unavailable");
    await expect(regime(page)).not.toContainText("Mixed");
  });

  test("an unknown label is unavailable even when the equity index count is positive", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, { ...REGIME, regime_label: "unknown", equity_index_count: 4 });
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "unknown");
    await expect(regime(page)).toHaveText("Regime unavailable");
    await expect(regime(page)).not.toContainText("Mixed");
  });

  test("a failed request says so; the line is not left empty", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockRegime(page, { detail: "boom" }, 500);
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "error");
    await expect(regime(page)).toHaveText("Regime could not be loaded.");
  });

  test("while loading, the regime line keeps its height and the tab bar does not move", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await mockMarketPageApi(page);
    await page.route("**/api/v1/market/regime", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(REGIME) });
    });
    await gotoMarket(page);
    await expect(regime(page)).toHaveAttribute("data-state", "loading");
    const tabBar = page.getByRole("tablist", { name: "Market sections" });
    const loading = await regime(page).boundingBox();
    const barLoading = await tabBar.boundingBox();
    release();
    await expect(regime(page)).toHaveAttribute("data-state", "ready");
    const ready = await regime(page).boundingBox();
    const barReady = await tabBar.boundingBox();
    expect(loading, "the line is rendered while loading").not.toBeNull();
    expect(loading!.height, "the loading line has height").toBeGreaterThan(0);
    expect(loading!.height, "same height loading and ready").toBe(ready!.height);
    expect(barLoading!.y, "the tab bar does not move").toBe(barReady!.y);
  });
});

test("switching to Korean relabels the title, the subtitle, the regime and the tabs", async ({ page }) => {
  await mockMarketPageApi(page);
  await mockRegime(page, REGIME);
  await gotoMarket(page);
  await expect(page.getByText("Daily closes · indices, commodities, FX, crypto")).toBeVisible();
  await expect(regime(page).locator('[data-part="label"]')).toHaveText("Risk-on");
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("heading", { name: "시장 개요", exact: true })).toBeVisible();
  await expect(page.getByText("일별 종가 · 지수, 원자재, 환율, 암호화폐")).toBeVisible();
  await expect(regime(page).locator('[data-part="label"]')).toHaveText("위험선호");
  await expect(regime(page).locator('[data-part="breadth"]')).toHaveText("지수 3/4 상승");
  await expect(regime(page).locator('[data-part="signals"]')).toHaveText("선호 5 / 회피 0");
  await expect(page.getByTestId("market-page-tabs").getByRole("tab", { name: "스프레드" })).toBeVisible();
});

function spread(id: string, label: string, numerator: string, latest: number | null, refused_reason: string | null = null) {
  const refused = refused_reason !== null;
  return {
    id, label, numerator, denominator: "^GSPC", requested_window_days: 90,
    actual_window_start: refused ? null : "2026-06-15", actual_window_end: refused ? null : "2026-09-11",
    actual_window_days: refused ? null : 88, observations: refused ? 0 : 62,
    basis: `(${numerator}_t / ${numerator}_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15`,
    series: refused ? [] : [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: latest }],
    latest, refused_reason,
  };
}
const SPREADS = [
  spread("ai", "AI", "BOTZ", 103.4),
  spread("cyber", "Cybersecurity", "CIBR", 98.1),
  spread("defence", "Defence", "ITA", null, "insufficient overlapping history"),
];

async function mockSpreads(page: Page, body: unknown, status = 200) {
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }));
}

const figures = (page: Page) => page.getByTestId("spread-figures");

test.describe("at 1280x720, the first screen", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function expectEndsBy(blocks: [string, Locator, number][]) {
    for (const [name, locator, bottom] of blocks) {
      const box = await locator.boundingBox();
      expect(box, `${name} is rendered`).not.toBeNull();
      expect(box!.y + box!.height, `${name} ends by ${Math.round(bottom)}px`).toBeLessThanOrEqual(bottom);
    }
  }

  test("header, tab bar, every card and the spread figures fit, in both views, without scrolling the panel", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, SPREADS);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "ready");
    await page.evaluate(() => document.fonts.ready);
    // Cards are server-rendered from the e2e API, so page.route cannot set their count: find the last one.
    expect(await cards(page).count(), "the e2e API served instrument cards").toBeGreaterThan(0);
    const panel = await marketPanel(page).boundingBox();
    const panelBottom = panel!.y + panel!.height;
    expect(panelBottom, "the panel ends inside the viewport").toBeLessThanOrEqual(720);
    await expectEndsBy([
      ["title", page.getByRole("heading", { name: "Market Overview", exact: true }), 720],
      ["regime line", regime(page), 720],
      ["tab bar", page.getByRole("tablist", { name: "Market sections" }), 720],
      ["last card", cards(page).last(), panelBottom],
      ["spread figures", figures(page), panelBottom],
    ]);
    await expectNoPageScroll(page, "graph view");

    await page.getByRole("button", { name: "Table" }).click();
    const rows = page.getByTestId("market-table").locator("tbody tr");
    await expect(rows.first()).toBeVisible();
    await expectEndsBy([
      ["last table row", rows.last(), panelBottom],
      ["spread figures", figures(page), panelBottom],
    ]);
    await expectNoPageScroll(page, "table view");
  });
});

test.describe("the spread figures", () => {
  test("each pair names its tickers; a refused pair says Unavailable, never a number", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, SPREADS);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "ready");
    await expect(figures(page)).toContainText("Themes vs benchmark (90d)");
    const ai = page.getByTestId("spread-figure-ai");
    await expect(ai.locator('[data-part="value"]')).toHaveText("103.4");
    await expect(ai.locator('[data-part="pair"]')).toHaveText("BOTZ/^GSPC");
    await expect(page.getByTestId("spread-figure-cyber").locator('[data-part="pair"]')).toHaveText("CIBR/^GSPC");
    const defence = page.getByTestId("spread-figure-defence");
    await expect(defence).toHaveAttribute("data-state", "refused");
    await expect(defence.locator('[data-part="value"]')).toHaveText("Unavailable");
    await expect(defence.locator('[data-part="pair"]')).toHaveText("ITA/^GSPC");
    // The figures are not chart cards: market-spreads.spec.ts counts charts by this prefix.
    await expect(page.getByTestId(/^spread-card-/)).toHaveCount(0);
  });

  test("loading is stated, and gives way to the figures", async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    await mockMarketPageApi(page);
    await page.route("**/api/v1/market/spreads**", async (route) => {
      await held;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SPREADS) });
    });
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "loading");
    await expect(figures(page).getByRole("status")).toHaveText("Loading spreads…");
    release();
    await expect(figures(page)).toHaveAttribute("data-state", "ready", { timeout: 30_000 });
  });

  test("a failed request is stated as a failure", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, { detail: "boom" }, 500);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "error", { timeout: 30_000 });
    await expect(figures(page).getByRole("alert")).toContainText("could not be loaded");
  });

  test("an empty list is stated, and is not an error", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, []);
    await gotoMarket(page);
    await expect(figures(page)).toHaveAttribute("data-state", "empty");
    await expect(figures(page)).toContainText("No spreads were returned.");
    await expect(figures(page).getByRole("alert")).toHaveCount(0);
  });

  test("a figure opens the Spreads tab", async ({ page }) => {
    await mockMarketPageApi(page);
    await mockSpreads(page, SPREADS);
    await gotoMarket(page);
    // Client-fetched, so "ready" means hydrated: one click is enough.
    await expect(figures(page)).toHaveAttribute("data-state", "ready");
    await page.getByTestId("spread-figure-ai").click();
    await expect(page.getByTestId("market-page-tabs").getByRole("tab", { name: "Spreads" })).toHaveAttribute("aria-selected", "true");
    await expect(marketPanel(page).getByTestId("spread-card-ai")).toBeVisible();
  });
});

test("the Market Dashboard card, Detail available and the Source column are gone", async ({ page }) => {
  await mockMarketPageApi(page);
  await gotoMarket(page);
  await expect(cards(page).first()).toBeVisible();
  await expect(page.getByText("Market Dashboard")).toHaveCount(0);
  await expect(page.getByText("Detail available")).toHaveCount(0);
  await page.getByRole("button", { name: "Table" }).click();
  const table = page.getByTestId("market-table");
  await expect(table.getByRole("columnheader")).toHaveCount(4);
  await expect(table.getByRole("columnheader", { name: "Instrument" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Source" })).toHaveCount(0);
  await expect(page.getByText("Market snapshot API")).toHaveCount(0);
});
