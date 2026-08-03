import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";

// XPath string literals: ticker and column-header values used here never contain a
// double quote, so a plain wrap is safe.
function xp(value: string) {
  return `"${value}"`;
}

// Locates the DCF Value cell (or any other column) for a given ticker's row by the
// column's header text, not its index, so a column reorder cannot silently break the
// locator. The column's position is computed from the header row at resolution time,
// via XPath's `preceding-sibling` count, so this stays a plain Locator -- chainable and
// awaitable exactly like `page.getByRole(...)` -- rather than a Promise.
function rowCell(page: Page, ticker: string, columnHeader: string) {
  const table = `//table[.//thead//th[normalize-space(.)=${xp(columnHeader)}]]`;
  const row = `${table}//tbody/tr[.//td[normalize-space(.)=${xp(ticker)}]]`;
  const columnPosition = `count(${table}//thead//th[normalize-space(.)=${xp(columnHeader)}]/preceding-sibling::th)+1`;
  return page.locator(`xpath=${row}/td[position()=${columnPosition}]`);
}

async function gotoComparison(page: Page) {
  // The comparison query stays disabled until the user explicitly requests a refresh
  // (see comparisonQuery's `enabled` guard in app/corporate/page.tsx), so a bare
  // navigation never fetches rows.
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect(page.getByRole("cell", { name: "MISS" }).first()).toBeVisible({ timeout: 60_000 });
}

// Sort control is a pair of <select aria-label="Sort by"> / <select aria-label="Direction">
// beside each other in TargetStockComparisonSection.tsx. Selected by their accessible
// (aria-label) name rather than position, matching rowCell's header-driven approach.
async function sortBy(page: Page, key: "dcf_value" | "roic_minus_wacc" | "expected_return_spread", direction: "asc" | "desc") {
  await page.locator('select[aria-label="Sort by"]').selectOption(key);
  await page.locator('select[aria-label="Direction"]').selectOption(direction);
  // The sort is a synchronous re-render off local state, but give React a tick to flush
  // before the table is read back, since the selectOption action itself does not wait
  // for the resulting re-render.
  await page.waitForTimeout(100);
}

// Reads the Ticker column top-to-bottom in on-screen order, via the same header-driven
// table lookup rowCell uses, so a column reorder cannot silently break this either.
async function tickerOrder(page: Page): Promise<string[]> {
  const cells = page.locator(
    `xpath=//table[.//thead//th[normalize-space(.)=${xp("DCF Value")}]]//tbody/tr/td[1]`,
  );
  const texts = await cells.allTextContents();
  return texts.map((text) => text.trim());
}

// Selecting AAPL's ticker button (CorporateComparisonTable's onSelectTicker) makes it the
// explicit target for the "Similar Stocks" charts, rather than relying on whatever ticker
// happened to be active from a prior session. AAPL, ESTM and MISS all share the
// "Technology" sector in the fixture, so this deterministically pulls both into the peer
// set the scatter builders draw from.
async function selectSimilarComparison(page: Page) {
  await rowCell(page, "AAPL", "Ticker").getByRole("button").click();
}

function parseTickValue(text: string): number {
  const match = text.trim().match(/^\$?(-?[\d,.]+)\s*([kKmMbB])?$/);
  if (!match) return NaN;
  const [, numStr, suffix] = match;
  const num = Number(numStr.replace(/,/g, ""));
  const multiplier = suffix ? ({ k: 1e3, m: 1e6, b: 1e9 } as const)[suffix.toLowerCase() as "k" | "m" | "b"] : 1;
  return num * multiplier;
}

// recharts renders each scatter point as a bare <path>, carrying only its pixel position
// (cx/cy) and fill color -- no ticker text or data attribute anywhere in the DOM (verified
// by dumping the rendered markup; the chart's own Tooltip does not populate on hover in
// this repo, so that route is not available either). What the DOM DOES carry, honestly, is
// the X axis's own printed tick labels, which are exact, uncompacted dollar figures for
// this fixture's current_price range (all under $1,000, so fmtCurrencyCompactTick never
// switches to "K" notation). Two of those ticks give an exact linear pixel->dollar scale,
// which decodes each point's cx back to its current_price -- unique per ticker in the
// fixture -- and that is matched against the known fixture values to name the ticker.
async function plottedTickers(page: Page): Promise<string[]> {
  const heading = page.getByRole("heading", { name: "Price Vs Fair Value Map" });
  const section = heading.locator("xpath=ancestor::section[1]");

  const ticks = await section
    .locator(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-label text")
    .evaluateAll((elements) => elements.map((element) => ({
      x: Number(element.getAttribute("x")),
      text: element.textContent ?? "",
    })));
  const parsedTicks = ticks
    .map((tick) => ({ x: tick.x, value: parseTickValue(tick.text) }))
    .filter((tick) => Number.isFinite(tick.x) && Number.isFinite(tick.value));
  if (parsedTicks.length < 2) throw new Error("Could not read at least two X axis ticks to build a price scale.");
  const first = parsedTicks[0];
  const last = parsedTicks[parsedTicks.length - 1];
  const slope = (last.value - first.value) / (last.x - first.x);
  const priceForPixel = (px: number) => first.value + (px - first.x) * slope;

  // current_price per ticker, straight from the fixture in corporatePageMock.ts. Prices are
  // unique across these rows, so nearest-match against the decoded value is unambiguous.
  const currentPriceByTicker: Record<string, number> = {
    AAPL: 210.4,
    MSFT: 415.3,
    ESTM: 250.0,
    MISS: 240.0,
  };

  const pointCxValues = await section
    .locator("path.recharts-symbols")
    .evaluateAll((elements) => elements.map((element) => Number(element.getAttribute("cx"))));

  return pointCxValues.map((cx) => {
    const decodedPrice = priceForPixel(cx);
    const [closestTicker] = Object.entries(currentPriceByTicker).reduce((best, candidate) =>
      Math.abs(candidate[1] - decodedPrice) < Math.abs(best[1] - decodedPrice) ? candidate : best);
    return closestTicker;
  });
}

test("a row whose bridge did not resolve shows no DCF value", async ({ page }) => {
  // dcf_value falls back to enterprise value when the bridge does not resolve. That is a
  // different financial quantity from an intrinsic value per share -- not a smaller one --
  // so it cannot appear in a $/share column however close the numbers happen to fall.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(rowCell(page, "MISS", "DCF Value")).toHaveText("—");
});

test("an estimated bridge still shows its value", async ({ page }) => {
  // The guard must be `=== "missing"`, never `!== "ok"`. An estimated row's number IS an
  // intrinsic value per share -- the fallback source affects confidence, not units -- and
  // a test that only distinguishes ok from missing would pass against the wrong check.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await expect(rowCell(page, "ESTM", "DCF Value")).not.toHaveText("—");
  await expect(rowCell(page, "ESTM", "DCF Value")).toContainText("$");
});

test("the suppressed cell still opens its calculation detail", async ({ page }) => {
  // The cell is a button onto the modal that explains WHY there is no value
  // (CalculationDetailModal renders bridge quality). Disabling it would take the
  // explanation away along with the number.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await rowCell(page, "MISS", "DCF Value").getByRole("button").click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("a suppressed row sorts last in both directions", async ({ page }) => {
  // Both directions matter. MISS carries the largest raw dcf_value in the fixture (2438),
  // so a comparator that fails to suppress it puts it FIRST on descending. And one that
  // suppresses via Number(null) -> 0 puts it first on ascending instead. Only a check that
  // precedes the numeric comparison and ignores the direction flag passes both.
  await mockCorporatePageApi(page);
  await gotoComparison(page);

  await sortBy(page, "dcf_value", "desc");
  const descending = await tickerOrder(page);
  expect(descending.at(-1)).toBe("MISS");

  await sortBy(page, "dcf_value", "asc");
  const ascending = await tickerOrder(page);
  expect(ascending.at(-1)).toBe("MISS");

  // The rest of the table really did reverse, so "MISS last both times" is the null rule
  // at work and not a table that failed to re-sort at all.
  expect(ascending.slice(0, -1)).toEqual([...descending.slice(0, -1)].reverse());
});

test("a suppressed row is not plotted against current price", async ({ page }) => {
  // dcf_value is a scatter axis paired with current_price. An enterprise value there is
  // not an outlier point, it is a different quantity sharing an axis.
  await mockCorporatePageApi(page);
  await gotoComparison(page);
  await selectSimilarComparison(page);

  const plotted = await plottedTickers(page);
  expect(plotted).not.toContain("MISS");
  expect(plotted).toContain("ESTM");
});
