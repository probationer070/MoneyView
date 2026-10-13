import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

/**
 * Up candles must be painted in the up colour and down candles in the down colour, both on
 * the same chart. candle-colour.spec.ts only proves that candles are not black; a chart that
 * painted every candle in one colour would pass it. Each direction is counted on its own.
 *
 * Bars are chosen with clear bodies: an up bar opens 5000 and closes 5060, a down bar opens
 * 5100 and closes 5060. Alternating them gives three of each.
 */

const UP_BAR = { open: 5000, high: 5065, low: 4995, close: 5060, volume: 1_000_000_000 };
const DOWN_BAR = { open: 5100, high: 5105, low: 5055, close: 5060, volume: 1_000_000_000 };
const DAILY_HISTORY = [
  { date: "2026-04-01", ...UP_BAR },
  { date: "2026-04-02", ...DOWN_BAR },
  { date: "2026-04-03", ...UP_BAR },
  { date: "2026-04-04", ...DOWN_BAR },
  { date: "2026-04-05", ...UP_BAR },
  { date: "2026-04-06", ...DOWN_BAR },
];

/** tokens: --up / --down, as the chart is passed them through MarketOverviewClient. */
const DELTA_UP = { r: 0xd2, g: 0x1f, b: 0x3c };
const DELTA_DOWN = { r: 0x1e, g: 0x5b, b: 0xd8 };
const NEAR = 24;

test("up bars are painted in the up colour and down bars in the down colour", async ({ page }) => {
  await mockMarketPageApi(page, { detailOverrides: { "^GSPC": { daily_history: DAILY_HISTORY } } });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();

  const canvas = page.locator('[role="dialog"] canvas').first();
  await expect(canvas).toBeVisible();

  // Sampling before the series animates in reads an undrawn buffer (see candle-colour.spec.ts).
  await page.waitForTimeout(1200);

  const counts = await canvas.evaluate((element, near) => {
    const source = element as HTMLCanvasElement;
    const context = source.getContext("2d");
    if (!context) return null;
    const { width, height } = source;
    const data = context.getImageData(0, 0, width, height).data;
    const result = { up: 0, down: 0 };
    const within = (r: number, g: number, b: number, c: { r: number; g: number; b: number }) =>
      Math.abs(r - c.r) <= near && Math.abs(g - c.g) <= near && Math.abs(b - c.b) <= near;
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
      if (a < 200) continue;
      if (within(r, g, b, { r: 0xd2, g: 0x1f, b: 0x3c })) result.up += 1;
      if (within(r, g, b, { r: 0x1e, g: 0x5b, b: 0xd8 })) result.down += 1;
    }
    return result;
  }, NEAR);

  expect(counts, "the chart canvas should be readable").not.toBeNull();
  expect(counts!.up, `up bars should paint ${JSON.stringify(DELTA_UP)}`).toBeGreaterThan(50);
  expect(counts!.down, `down bars should paint ${JSON.stringify(DELTA_DOWN)}`).toBeGreaterThan(50);
});
