import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { changeFigure, formatBp, type MarketIndexQuote } from "../../components/market/marketModel";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { marketPanel, openMarketTab } from "./helpers/marketTabs";

// Spec docs/superpowers/specs/2026-10-16-market-overview-expansion-design.md §2.1-2.2.
// The cards are server-rendered from the seeded e2e API, so the expected figures come from the same API.
const API = "http://127.0.0.1:8110/api/v1/market/indices";

async function quotes(request: APIRequestContext): Promise<MarketIndexQuote[]> {
  const response = await request.get(API);
  expect(response.ok()).toBe(true);
  return response.json();
}

/** Five spread figures, as the fit test in market-one-screen.spec.ts serves them. */
const SPREADS = ["ai:BOTZ", "cyber:CIBR", "defence:ITA", "cloud:SKYY", "energy_policy:ICLN"].map((pair, i) => {
  const [id, numerator] = pair.split(":");
  return {
    id, label: id, numerator, denominator: "^GSPC", requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11", actual_window_days: 88, observations: 62,
    basis: "indexed to 100", series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 100 + i }],
    latest: 100 + i, refused_reason: null,
  };
});

async function gotoMarket(page: Page, heading = "Market Overview") {
  await mockMarketPageApi(page);
  await page.route("**/api/v1/market/spreads**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SPREADS) }));
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible({ timeout: 60_000 });
}

const cards = (page: Page) => page.locator("article").filter({ has: page.locator('button[aria-label^="Open detail for"]') });
const card = (page: Page, ticker: string) => cards(page).filter({ hasText: ticker });

/** What one change cell should read: the catalog label, then the bp text or the DeltaBadge's percent text. */
async function cellText(cell: ReturnType<Page["locator"]>) {
  const bp = cell.getByTestId("change-bp");
  if (await bp.count()) return (await bp.innerText()).trim();
  return (await cell.locator('[data-part="value"]').innerText()).trim();
}

test("every card shows a 1D and a 1M figure matching the API", async ({ page, request }) => {
  const all = await quotes(request);
  expect(all).toHaveLength(14);
  await gotoMarket(page);
  await expect(cards(page)).toHaveCount(14);
  for (const ticker of ["^GSPC", "SOXX", "^TNX"]) {
    const quote = all.find((q) => q.ticker === ticker)!;
    expect(quote.last_close, `${ticker} last_close`).not.toBeNull();
    const el = card(page, ticker);
    await expect(el).toHaveCount(1);
    for (const [id, delta] of [["change-1d", quote.delta], ["change-1m", quote.month_delta]] as const) {
      const figure = changeFigure(delta, quote.instrument_type);
      const cell = el.getByTestId(id);
      if (figure.kind === "bp") expect(await cellText(cell), `${ticker} ${id}`).toBe(formatBp(figure.bp));
      else if (figure.kind === "pct") {
        const expected = (figure.pct / 100).toLocaleString("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
        expect(await cellText(cell), `${ticker} ${id}`).toBe(expected);
      } else expect(await cell.innerText()).toContain("—");
    }
  }
  // The 1M figure must come from month_delta, not the daily delta.
  const spx = all.find((q) => q.ticker === "^GSPC")!;
  expect(spx.month_delta, "seed has a 1M change").not.toBeNull();
  expect(spx.month_delta!.delta_pct, "seed must make 1D and 1M differ").not.toBe(spx.delta.delta_pct);
  const day = await cellText(card(page, "^GSPC").getByTestId("change-1d"));
  const month = await cellText(card(page, "^GSPC").getByTestId("change-1m"));
  expect(month).not.toBe(day);
});

test("the table's 1D and 1M cells match the API", async ({ page, request }) => {
  const all = await quotes(request);
  await gotoMarket(page);
  await page.getByRole("button", { name: "Table" }).click();
  const tables = page.getByTestId("market-table");
  for (const [ticker, name] of [["^GSPC", "S&P 500"], ["SOXX", "Semiconductors"], ["^TNX", "US 10Y Yield"]]) {
    const quote = all.find((q) => q.ticker === ticker)!;
    expect(quote.last_close, `${ticker} last_close`).not.toBeNull();
    const row = tables.locator("tbody tr").filter({ has: page.getByRole("button", { name: `Open detail for ${name} from table`, exact: true }) });
    await expect(row, `${ticker} row`).toHaveCount(1);
    const cells = row.locator("td");
    for (const [index, delta, label] of [[2, quote.delta, "1D"], [3, quote.month_delta, "1M"]] as const) {
      const figure = changeFigure(delta, quote.instrument_type);
      if (figure.kind === "bp") expect(await cellText(cells.nth(index)), `${ticker} ${label}`).toBe(formatBp(figure.bp));
      else if (figure.kind === "pct") {
        const expected = (figure.pct / 100).toLocaleString("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
        expect(await cellText(cells.nth(index)), `${ticker} ${label}`).toBe(expected);
      } else expect(await cells.nth(index).innerText(), `${ticker} ${label}`).toContain("—");
    }
  }
});

test("the rate card reads bp and never a percent change", async ({ page }) => {
  await gotoMarket(page);
  const tnx = card(page, "^TNX");
  await expect(tnx).toHaveCount(1);
  await expect(tnx.getByTestId("change-1d")).toHaveText(/^1D\s*[+-]?\d+bp$/);
  await expect(tnx.getByTestId("change-1d")).not.toContainText("%");
  await expect(tnx.getByTestId("change-1m")).not.toContainText("%");
  await expect(tnx.locator(".type-figure-md")).toHaveText(/%$/);
});

test("the rate's modal is titled with the catalog name and reads its current value as a percent", async ({ page }) => {
  await gotoMarket(page);
  await card(page, "^TNX").getByRole("button", { name: /^Open detail for/ }).click();
  const dialog = page.getByRole("dialog", { name: "US 10Y Yield", exact: true });
  await expect(dialog).toBeVisible();
  const current = dialog.locator("p.type-figure-md").first();
  await expect(current).toHaveText(/^\d+\.\d{2}%$/);
});

test.describe("at 1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the cards are two rows of seven", async ({ page }) => {
    await gotoMarket(page);
    await expect(cards(page)).toHaveCount(14);
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId("spread-figures")).toHaveAttribute("data-state", "ready");
    const boxes = [];
    for (let i = 0; i < 14; i++) boxes.push((await cards(page).nth(i).boundingBox())!);
    const row1 = new Set(boxes.slice(0, 7).map((b) => Math.round(b.y)));
    const row2 = new Set(boxes.slice(7).map((b) => Math.round(b.y)));
    expect(row1.size, "cards 0-6 share one y").toBe(1);
    expect(row2.size, "cards 7-13 share one y").toBe(1);
    expect([...row2][0]).toBeGreaterThan([...row1][0]);
    const panel = (await marketPanel(page).boundingBox())!;
    const panelBottom = panel.y + panel.height;
    const last = boxes[13];
    expect(last.y + last.height, "last card ends by the panel bottom").toBeLessThanOrEqual(panelBottom);
    const figures = (await page.getByTestId("spread-figures").boundingBox())!;
    expect(figures.y + figures.height, "spread figures end by the panel bottom").toBeLessThanOrEqual(panelBottom);
  });

  test("the table is two halves of seven with the 1M column", async ({ page }) => {
    await gotoMarket(page);
    await page.getByRole("button", { name: "Table" }).click();
    const tables = page.getByTestId("market-table").locator("table");
    await expect(tables).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(tables.nth(i).locator("tbody tr")).toHaveCount(7);
      await expect(tables.nth(i).getByRole("columnheader", { name: "1D" })).toBeVisible();
      await expect(tables.nth(i).getByRole("columnheader", { name: "1M" })).toBeVisible();
    }
  });
});

test.describe("in Korean", () => {
  test.use({ locale: "ko-KR" });

  test("names and labels read in Korean", async ({ page }) => {
    await gotoMarket(page, "시장 개요");
    await expect(page.getByText("반도체").first()).toBeVisible();
    await expect(page.getByText("미 10년물 금리").first()).toBeVisible();
    await expect(page.getByText("1개월").first()).toBeVisible();
  });
});

test.describe("motion on", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  const marketCard = (page: Page, ticker: string) => card(page, ticker);

  /** Records whether `selector` ever matched inside a card, so a roll that is over by the time we look is still seen. */
  async function watchFor(page: Page, selector: string) {
    await page.addInitScript((sel) => {
      const w = window as unknown as { __seen: boolean };
      w.__seen = false;
      const scan = () => {
        if (document.querySelector(`article ${sel}`)) w.__seen = true;
      };
      new MutationObserver(scan).observe(document, { childList: true, subtree: true });
    }, selector);
  }
  const seen = (page: Page) => page.evaluate(() => (window as unknown as { __seen: boolean }).__seen);

  test("a card value rolls in, then reads the API value", async ({ page, request }) => {
    const all = await quotes(request);
    const spx = all.find((q) => q.ticker === "^GSPC")!;
    expect(spx.last_close).not.toBeNull();
    await watchFor(page, '.type-figure-md .mv-dg');
    await gotoMarket(page);
    await expect(cards(page)).toHaveCount(14);
    await expect.poll(() => seen(page), { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(1_500);
    const expected = spx.last_close!.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    await expect(marketCard(page, "^GSPC").locator(".type-figure-md")).toHaveText(expected);
    await expect(marketCard(page, "^GSPC").locator(".type-figure-md .mv-dg")).toHaveCount(0);
  });

  test("a card's 1D DeltaBadge rolls in (animate=enter), then reads the API percent", async ({ page, request }) => {
    const all = await quotes(request);
    const spx = all.find((q) => q.ticker === "^GSPC")!;
    const figure = changeFigure(spx.delta, spx.instrument_type);
    expect(figure.kind).toBe("pct");
    if (figure.kind !== "pct") return;
    await watchFor(page, '[data-testid="change-1d"] [data-testid="delta-badge"] .mv-dg');
    await gotoMarket(page);
    await expect(cards(page)).toHaveCount(14);
    await expect.poll(() => seen(page), { timeout: 3_000 }).toBe(true);
    await page.waitForTimeout(1_500);
    const expected = (figure.pct / 100).toLocaleString("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
    await expect(marketCard(page, "^GSPC").getByTestId("change-1d").locator('[data-part="value"]')).toHaveText(expected);
  });

  test("a card's accessible name is its label alone, with no figure repeated", async ({ page }) => {
    await gotoMarket(page);
    await expect(cards(page)).toHaveCount(14);
    const button = marketCard(page, "^GSPC").getByRole("button", { name: /^Open detail for/ });
    await expect(button).toHaveCount(1);
    const name = await button.evaluate((el) => el.getAttribute("aria-label"));
    expect(name).toBe("Open detail for S&P 500");
    // No RollingNumber inside may add its own text to the name through role=button name-from-content.
    await expect(page.getByRole("button", { name: "Open detail for S&P 500", exact: true })).toHaveCount(1);
  });

  test("switching the page tab runs the scan line", async ({ page }) => {
    await gotoMarket(page);
    await openMarketTab(page, "Spreads");
    await openMarketTab(page, "Instruments");
    await page.getByTestId("market-page-tabs").getByRole("tab", { name: "Spreads", exact: true }).click();
    await expect.poll(
      () => page.evaluate(() => document.querySelector('[data-testid="scan-line"]')?.getAnimations().length ?? 0),
      { timeout: 2_000 },
    ).toBeGreaterThan(0);
  });
});
