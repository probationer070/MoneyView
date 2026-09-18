import { expect, test, type Page } from "@playwright/test";
import { GEOPOLITICAL, mockEventsApi, setAllEventCategories } from "./helpers/eventsApiMock";

/**
 * The ticker detail page must not rebuild its chart when event lines arrive or the filter changes.
 *
 * A rebuild runs `chart.remove()` and creates the chart again, which throws away the reader's
 * zoom and pan and snaps the view back to the full history. `TVChart`'s setup effect depends on
 * the identity of `lineSeriesData`, and the detail page passes none, so a default of `[]` gave
 * the chart a new array on every render of `OHLCVChartCard` -- which, once that card owned the
 * event filter and fetched the events, happened on first load and on every click.
 *
 * Every other event-line test runs in the portfolio modal, which passes a memoised series and
 * so never exposed this. That is why this one opens `/detail`.
 *
 * Detection: a rebuild destroys the canvases and creates new ones, so a marker set on the
 * original canvases does not survive it. That measures "was it rebuilt", which is the defect,
 * rather than inferring it from zoom state the page does not expose.
 *
 * The detail page fetches its prices on the server from the harness API, which reads the local
 * database, so this needs AAPL history there -- the same live-data dependency as
 * market-overview.live.spec.ts. The events request is made in the browser and is mocked.
 */

const CHART = '[data-testid="tv-chart"]';

async function markCanvases(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const chart = document.querySelector(selector);
    const canvases = chart ? Array.from(chart.querySelectorAll("canvas")) : [];
    for (const canvas of canvases) (canvas as unknown as { __probe?: boolean }).__probe = true;
    return canvases.length;
  }, CHART);
}

/** How many canvases now in the chart still carry the marker, and how many there are. */
async function markedCanvases(page: Page): Promise<{ marked: number; total: number }> {
  return page.evaluate((selector) => {
    const chart = document.querySelector(selector);
    const canvases = chart ? Array.from(chart.querySelectorAll("canvas")) : [];
    const marked = canvases.filter((canvas) => (canvas as unknown as { __probe?: boolean }).__probe).length;
    return { marked, total: canvases.length };
  }, CHART);
}

test("the detail page reads its ticker from the route", async ({ page }) => {
  // In Next.js 16 a page's `params` is a Promise. Reading `params.ticker` synchronously yields
  // undefined, so every ticker's page fetched /detail/UNDEFINED and rendered "No data available
  // for UNDEFINED" -- the whole page, for every symbol, with no error anywhere but the dev log.
  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });

  // Wait for the page to settle into one of its two outcomes before the absence check. Checked
  // before anything renders, "no UNDEFINED text" holds trivially -- the same vacuous absence
  // assertion that ERROR-LOG.md 2026-09-13 records.
  const noData = page.getByText(/No data available for/i);
  await expect(page.locator(CHART).or(noData).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/No data available for UNDEFINED/i), "the page read no ticker from its route").toHaveCount(0);
  await expect(page.locator(CHART).first(), "the detail page needs AAPL history in the local database").toBeVisible();
});

test("the detail chart is not rebuilt when event lines arrive or the filter changes", async ({ page }) => {
  let releaseEvents: () => void = () => {};
  const eventsHeld = new Promise<void>((resolve) => {
    releaseEvents = resolve;
  });

  // Held until the canvases are marked, so the arrival of events is observed as its own step.
  await mockEventsApi(page, {
    categories: [GEOPOLITICAL],
    holdEvents: eventsHeld,
    events: [{
      id: "us-iran-strikes-begin-2026-02-28",
      label: "U.S. strikes on Iran begin",
      category: "geopolitical",
      start_date: "2026-02-28",
      source: "https://example.com/timeline",
    }],
  });

  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });

  const chart = page.locator(CHART).first();
  await expect(chart, "the detail page needs AAPL history in the local database").toBeVisible({ timeout: 60_000 });
  await expect.poll(() => markCanvases(page), { timeout: 30_000 }).toBeGreaterThan(0);

  // Settle past mount before trusting the marker, then confirm it took.
  await page.waitForTimeout(500);
  const markedAtStart = await markCanvases(page);
  expect((await markedCanvases(page)).marked).toBe(markedAtStart);

  // 1. Events arrive. The card re-renders to show its filter; the chart must not be rebuilt.
  releaseEvents();
  const filter = page.getByTestId("chart-events-filter");
  await expect(filter).toHaveText(/Events · 1 of 1/, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const afterEvents = await markedCanvases(page);
  // Guarded: with no canvases at all, `marked === total` would hold at 0 and prove nothing.
  expect(afterEvents.total, "the chart must still be on the page").toBeGreaterThan(0);
  expect(afterEvents.marked, `rebuilt when events arrived: ${JSON.stringify(afterEvents)}`).toBe(afterEvents.total);

  // 2. The filter hides every category. Same requirement.
  await setAllEventCategories(page, "chart-events-filter", false);
  await page.waitForTimeout(500);
  const afterFilter = await markedCanvases(page);
  expect(afterFilter.marked, `rebuilt when the filter changed: ${JSON.stringify(afterFilter)}`).toBe(afterFilter.total);
  expect(afterFilter.total).toBeGreaterThan(0);
});
