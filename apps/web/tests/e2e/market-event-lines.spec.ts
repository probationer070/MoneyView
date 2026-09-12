import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";

/**
 * The event line is canvas pixels, so there is no element to assert on. These tests measure
 * the canvas instead: they sum, per x column, how many pixels carry any ink, then DIFF that
 * profile with the line toggled off. Whatever remains is the line and nothing else, which is
 * what makes the assertions independent of candle colour, theme, and device pixel ratio.
 *
 * A prior chart-pixel test in this repository silently read stale coordinates, so every
 * sample here polls until the profile stops changing before it is used.
 */

/** Trading days around the Iran event: Fri 27 Feb runs straight into Mon 2 Mar. */
const BARS = [
  "2026-02-23", "2026-02-24", "2026-02-25", "2026-02-26", "2026-02-27",
  "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
];

function priceSeries() {
  return BARS.map((date, index) => ({
    date,
    open: 100 + index,
    high: 106 + index,
    low: 98 + index,
    close: 102 + index,
    volume: 1_000_000 + index * 1_000,
  }));
}

async function mockChartAndEvents(page: Page, events: Array<{ date: string; label?: string }>) {
  await mockPortfolioPageApi(page);

  // Registered after the base mock so these win, the pattern the other specs use.
  await page.route("**/api/v1/portfolio/stock/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ticker: "AAPL", prices: priceSeries(), news: [] }),
    });
  });
  await page.route("**/api/v1/market/events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        events.map((event, index) => ({
          id: `event-${index}`,
          label: event.label ?? "U.S. strikes on Iran begin",
          category: "geopolitical",
          start_date: event.date,
          end_date: null,
          source: "https://example.com/timeline",
          note: "",
        })),
      ),
    });
  });
}

async function openChart(page: Page) {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId("stock-tile-AAPL").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("tv-chart")).toBeVisible();
  return dialog;
}

/** Ink per x column across every canvas in the modal's chart, in bitmap pixels. */
async function inkProfile(page: Page): Promise<{ ink: number[]; height: number }> {
  return page.evaluate(() => {
    const container = document.querySelector('[role="dialog"] [data-testid="tv-chart"]');
    if (!container) return { ink: [], height: 0 };
    const canvases = Array.from(container.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const width = canvases.reduce((max, canvas) => Math.max(max, canvas.width), 0);
    const height = canvases.reduce((max, canvas) => Math.max(max, canvas.height), 0);
    const ink = new Array<number>(width).fill(0);
    for (const canvas of canvases) {
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0) continue;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (image.data[(y * canvas.width + x) * 4 + 3] > 0) ink[x] += 1;
        }
      }
    }
    return { ink, height };
  });
}

/** Sample only once the canvas has stopped changing, so no reading is mid-animation. */
async function stableInkProfile(page: Page): Promise<{ ink: number[]; height: number }> {
  let previous = await inkProfile(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(250);
    const current = await inkProfile(page);
    if (current.ink.length > 0 && JSON.stringify(current.ink) === JSON.stringify(previous.ink)) {
      return current;
    }
    previous = current;
  }
  return previous;
}

/** The columns the line occupies, found by removing everything the chart draws without it. */
async function lineColumns(page: Page, dialog: ReturnType<Page["getByRole"]>) {
  const toggle = dialog.getByTestId("chart-events-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const withLine = await stableInkProfile(page);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const withoutLine = await stableInkProfile(page);

  const columns: number[] = [];
  let peak = 0;
  for (let x = 0; x < withLine.ink.length; x += 1) {
    const added = withLine.ink[x] - (withoutLine.ink[x] ?? 0);
    if (added > 0) {
      columns.push(x);
      peak = Math.max(peak, added);
    }
  }
  return { columns, peak, height: withLine.height };
}

test("an event on a day the market was shut still draws a line, spanning the full height", async ({ page }) => {
  // 28 Feb 2026 was a Saturday. `timeToCoordinate` answers only for times that have a bar,
  // so the naive implementation draws nothing at all for exactly the events most worth
  // marking -- a weekend shock, whose whole effect lands at the next open.
  await mockChartAndEvents(page, [{ date: "2026-02-28" }]);
  const dialog = await openChart(page);

  const { columns, peak, height } = await lineColumns(page, dialog);

  expect(columns.length, "a line must be drawn for a non-trading-day event").toBeGreaterThan(0);
  // Narrow: a vertical line, not a band and not a repaint of the whole plot.
  expect(columns.length).toBeLessThanOrEqual(6);
  // Contiguous.
  expect(columns[columns.length - 1] - columns[0]).toBeLessThanOrEqual(6);
  // The Y-axis span that was asked for: the line covers essentially the whole pane height.
  expect(peak).toBeGreaterThanOrEqual(height * 0.9);
});

test("the line sits in the closed-market gap, between the Friday and the Monday", async ({ page }) => {
  // The strongest available statement about placement without hardcoding a pixel: render
  // the same chart three times, marking the Friday, then the Saturday, then the Monday, and
  // require the Saturday to land strictly between the two sessions that bracket it. A line
  // snapped onto either neighbouring bar -- the obvious wrong implementation -- collapses
  // one of these inequalities.
  const columnFor = async (date: string) => {
    await mockChartAndEvents(page, [{ date }]);
    const dialog = await openChart(page);
    const { columns } = await lineColumns(page, dialog);
    expect(columns.length, `no line drawn for ${date}`).toBeGreaterThan(0);
    return (columns[0] + columns[columns.length - 1]) / 2;
  };

  const friday = await columnFor("2026-02-27");
  const saturday = await columnFor("2026-02-28");
  const monday = await columnFor("2026-03-02");

  expect(friday, `friday=${friday} saturday=${saturday} monday=${monday}`).toBeLessThan(saturday);
  expect(saturday, `friday=${friday} saturday=${saturday} monday=${monday}`).toBeLessThan(monday);
});

test("the toggle removes the line and the legend together", async ({ page }) => {
  await mockChartAndEvents(page, [{ date: "2026-02-28", label: "U.S. strikes on Iran begin" }]);
  const dialog = await openChart(page);

  const legend = dialog.getByTestId("chart-events-legend");
  await expect(legend).toContainText("U.S. strikes on Iran begin");
  await expect(legend).toContainText("2026-02-28");

  await dialog.getByTestId("chart-events-toggle").click();
  await expect(legend).toHaveCount(0);
});

test("an event outside the loaded range draws nothing rather than clamping to an edge", async ({ page }) => {
  // Clamping would assert a date the chart is not showing, which is a stronger claim than
  // "no data here" and a false one.
  await mockChartAndEvents(page, [{ date: "2025-01-15" }]);
  const dialog = await openChart(page);

  const { columns } = await lineColumns(page, dialog);

  expect(columns, `unexpected line at columns ${columns.join(",")}`).toEqual([]);
});
