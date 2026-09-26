import { expect, test, type Page } from "@playwright/test";
import { stableInkProfile } from "./helpers/chartInk";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { GEOPOLITICAL, mockEventsApi, setAllEventCategories, type MockEvent } from "./helpers/eventsApiMock";

/**
 * The section's contract is that a reader can never see a theme figure without seeing what
 * produced it, and that a refused pair is visibly refused rather than absent or flat.
 */

// Market Overview renders from `apps/web/app/page.tsx`, so its route is `/` and not
// `/market`. Every existing spec for this page (market-overview.spec.ts) uses `/` too.
async function mockSpreads(page: Page, rows: unknown[]) {
  await page.route("**/api/v1/market/spreads**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

function computed(overrides: Record<string, unknown> = {}) {
  return {
    id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC",
    requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11",
    actual_window_days: 88, observations: 62,
    basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
    series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
    latest: 103.4, refused_reason: null,
    ...overrides,
  };
}

function refused(overrides: Record<string, unknown> = {}) {
  return {
    ...computed(),
    id: "defence", label: "Defence", numerator: "ITA", denominator: "^GSPC",
    actual_window_start: null, actual_window_end: null, actual_window_days: null,
    observations: 0, series: [], latest: null,
    refused_reason: "insufficient overlapping history",
    ...overrides,
  };
}

test("every spread card names the tickers and window that produced it", async ({ page }) => {
  // A figure labelled "AI +3.4%" asserts a fact about AI. "BOTZ vs ^GSPC" lets a reader
  // reject the proxy instead.
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("BOTZ");
  await expect(card).toContainText("^GSPC");
  await expect(card).toContainText("90d");
});

test("a refused pair keeps its card and shows the reason", async ({ page }) => {
  // Not an empty chart, not a line flat at 100 -- which is indistinguishable from a real
  // result showing no relative movement -- and never hidden.
  await mockSpreads(page, [computed(), refused()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-defence");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Unavailable");
  await expect(card).toContainText("insufficient overlapping history");
  await expect(card).toContainText("ITA");
  await expect(card.getByTestId("spread-chart-defence")).toHaveCount(0);
  await expect(card).not.toContainText("100.0");
});

test("a computed pair renders its latest value and its chart", async ({ page }) => {
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toContainText("103.4");
  await expect(card.getByTestId("spread-chart-ai")).toBeVisible();
});

const IRAN_EVENT = [{
  id: "us-iran-strikes-begin-2026-02-28",
  label: "U.S. strikes on Iran begin",
  category: "geopolitical",
  start_date: "2026-02-28",
  end_date: null,
  source: "https://example.com/timeline",
  note: "",
}];

async function mockEvents(page: Page, events: unknown[] = IRAN_EVENT) {
  await mockEventsApi(page, { events: events as MockEvent[], categories: [GEOPOLITICAL] });
}

test("the spreads section's event filter changes what is painted", async ({ page }) => {
  // The assertion is the ink diff, not the filter's text: a control whose state flips while the
  // chart ignores it would satisfy a text-only check.
  //
  // IRAN_EVENT's date (2026-02-28) predates computed()'s window (2026-06-15 to 2026-09-11)
  // entirely, so eventCoordinate (EventLinesPrimitive.ts) never finds a bracketing bar and no
  // line is drawn regardless of whether the filter is wired correctly -- confirmed by
  // temporarily widening the window, which made the assertion pass. Use the window's own
  // first bar date instead, so the event always resolves to a coordinate.
  await mockEvents(page, [{ ...IRAN_EVENT[0], start_date: "2026-06-15" }]);
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toBeVisible({ timeout: 60_000 });
  await expect(filter).toHaveText(/Events · 1 of 1/);

  const selector = '[data-testid="spread-chart-ai"]';
  const withLine = await stableInkProfile(page, selector);
  await setAllEventCategories(page, "spreads-events-filter", false);
  const withoutLine = await stableInkProfile(page, selector);

  const changed = withLine.ink.filter((value, index) => value !== (withoutLine.ink[index] ?? 0));
  expect(changed.length, "the filter change must change what is painted, not just the button").toBeGreaterThan(0);
});

test("a spread chart is not rebuilt when the event filter changes", async ({ page }) => {
  // SpreadCard passes TVChart no line series. TVChart's setup effect depends on that prop's
  // identity, so a `[]` default rebuilt the chart on every filter change -- discarding zoom and
  // pan -- while the ink diff above still passed. A marker on the canvases does not survive a rebuild.
  await mockEvents(page, [{ ...IRAN_EVENT[0], start_date: "2026-06-15" }]);
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const filter = page.getByTestId("spreads-events-filter");
  await expect(filter).toBeVisible({ timeout: 60_000 });
  const selector = '[data-testid="spread-chart-ai"] canvas';
  await expect.poll(() => page.locator(selector).count(), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(500);
  await page.evaluate((sel) => {
    for (const canvas of Array.from(document.querySelectorAll(sel))) (canvas as unknown as { __probe?: boolean }).__probe = true;
  }, selector);

  await setAllEventCategories(page, "spreads-events-filter", false);
  await page.waitForTimeout(500);
  const after = await page.evaluate((sel) => {
    const canvases = Array.from(document.querySelectorAll(sel));
    return { marked: canvases.filter((canvas) => (canvas as unknown as { __probe?: boolean }).__probe).length, total: canvases.length };
  }, selector);
  expect(after.total, "the spread chart must still be on the page").toBeGreaterThan(0);
  expect(after.marked, `rebuilt when the filter changed: ${JSON.stringify(after)}`).toBe(after.total);
});

test("on the index detail's monthly chart, an event sits on its month's candle", async ({ page }) => {
  // The API dates each monthly bar by its month's first trading day (_aggregate_monthly_bars);
  // this fixture dates them at month end. Either way the event's day rarely matches a bar, and
  // the daily rule bracketed a mid-month event between two months' candles. A 10 Mar event must
  // land on the March candle, which is where the 31 Mar event lands.
  await mockMarketPageApi(page);
  await mockSpreads(page, [computed()]);

  const monthlyColumnFor = async (date: string) => {
    await mockEvents(page, [{ ...IRAN_EVENT[0], start_date: date }]);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByRole("button", { name: "Monthly" }).click();

    const filter = dialog.getByTestId("market-events-filter");
    await expect(filter).toHaveText(/Events · 1 of 1/);
    const chart = '[role="dialog"] [data-testid="tv-chart"]';
    const withLine = await stableInkProfile(page, chart);
    await setAllEventCategories(dialog, "market-events-filter", false);
    const withoutLine = await stableInkProfile(page, chart);

    const columns = withLine.ink.flatMap((value, x) => (value > (withoutLine.ink[x] ?? 0) ? [x] : []));
    expect(columns.length, `no line drawn on the monthly chart for ${date}`).toBeGreaterThan(0);
    return (columns[0] + columns[columns.length - 1]) / 2;
  };

  const marchCandle = await monthlyColumnFor("2026-03-31");
  const midMarch = await monthlyColumnFor("2026-03-10");
  const februaryCandle = await monthlyColumnFor("2026-02-28");
  expect(Math.abs(midMarch - marchCandle), `10 Mar=${midMarch} March candle=${marchCandle}`).toBeLessThanOrEqual(2);
  // Guard: the candles must be distinguishable, or the check above proves nothing.
  expect(Math.abs(marchCandle - februaryCandle)).toBeGreaterThan(20);
});

test("the index detail chart's event filter changes what is painted", async ({ page }) => {
  // This filter lives inside MarketDetailModal, so the modal must be open for it to exist at all.
  //
  // Hermetic, not live-data-dependent: mockMarketPageApi supplies the ^GSPC detail fixture so
  // this doesn't depend on whatever CL=F rows happen to be in the local database. S&P 500 (not
  // Oil) because the fixture only has ^GSPC/^IXIC/GC=F/KRW=X/BTC-USD entries and the overview
  // fixture has no Oil card. Monthly (not Daily) because ^GSPC's daily_history only spans
  // 2026-04-07..2026-04-11 -- the Feb 2026 event would draw nothing there -- while its
  // monthly_history has a bar dated exactly 2026-02-28, an exact match for IRAN_EVENT's real
  // date, so no date override is needed. Placement on the monthly chart is tested separately
  // above; this one checks only that the filter changes what is painted.
  //
  // mockMarketPageApi's catch-all `**/*` route continues (to the network) any path it doesn't
  // recognise, which would otherwise swallow /market/events and /market/spreads before they
  // reach the mocks below. Registering those two AFTER it means Playwright tries them first
  // (last-registered wins), so they fulfill before the catch-all ever sees the request -- the
  // same order market-event-lines.spec.ts uses for its base mock plus overrides.
  await mockMarketPageApi(page);
  await mockEvents(page);
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Monthly" }).click();

  const filter = dialog.getByTestId("market-events-filter");
  await expect(filter).toBeVisible();
  await expect(filter).toHaveText(/Events · 1 of 1/);

  const selector = '[role="dialog"] [data-testid="tv-chart"]';
  const withLine = await stableInkProfile(page, selector);
  await setAllEventCategories(dialog, "market-events-filter", false);
  const withoutLine = await stableInkProfile(page, selector);

  const changed = withLine.ink.filter((value, index) => value !== (withoutLine.ink[index] ?? 0));
  expect(changed.length, "the filter change must change what is painted, not just the button").toBeGreaterThan(0);
});

test("a failed spreads request is shown as a failure, not as an empty page", async ({ page }) => {
  // The hook used to turn any failure into an empty list, and the section hid itself on an
  // empty list, so a broken endpoint looked exactly like "no spreads". The page must stay
  // up (the failure is confined to this section), but it must say so.
  await page.route("**/api/v1/market/spreads**", async (route) => {
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ detail: "boom" }) });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const section = page.getByTestId("spreads-section");
  await expect(section.getByRole("alert")).toContainText("could not be loaded", { timeout: 60_000 });
  await expect(page.getByTestId(/^spread-card-/)).toHaveCount(0);
});

test("a slow spreads request shows it is loading instead of nothing", async ({ page }) => {
  // The first request after each daily cache boundary fetches live data inline and can take
  // a long time. That wait used to be a blank area.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/v1/market/spreads**", async (route) => {
    await held;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([computed()]) });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("spreads-loading")).toBeVisible({ timeout: 60_000 });
  release();
  await expect(page.getByTestId("spread-card-ai")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("spreads-loading")).toHaveCount(0);
});

test("an empty spreads list says so, and is not an error", async ({ page }) => {
  await mockSpreads(page, []);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const section = page.getByTestId("spreads-section");
  await expect(section.getByTestId("spreads-empty")).toBeVisible({ timeout: 60_000 });
  await expect(section.getByRole("alert")).toHaveCount(0);
});
