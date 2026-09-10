import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

/**
 * Candles must be painted, not black.
 *
 * `lightweight-charts` draws to a canvas, and a canvas cannot resolve a CSS custom
 * property: assigning an invalid colour is silently ignored and the context keeps what it
 * had, which for a fresh one is black. Every candlestick surface handed the chart
 * `var(--delta-up)` directly, so the candles rendered black -- while `detail/[ticker]`
 * passed literal hex and looked correct, which is why the symptom read as inconsistent
 * rather than broken.
 *
 * Asserted on decoded pixels rather than on props, because "the candles are black" is a
 * fact about what was painted. A test that checked the option object would have passed
 * throughout the defect: the option was set, it was just unpaintable.
 */

/** globals.css: red is a gain, blue is a loss -- the convention the app states in copy. */
const DELTA_UP = { r: 0xe5, g: 0x45, b: 0x45 };
const DELTA_DOWN = { r: 0x45, g: 0x89, b: 0xe5 };

const NEAR = 24;

function close(a: number, b: number) {
  return Math.abs(a - b) <= NEAR;
}

test("candles are painted in the delta colours, not left black", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Open detail for S&P 500" }).click();
  await expect(page.getByRole("dialog", { name: "S&P 500" })).toBeVisible();

  const canvas = page.locator('[role="dialog"] canvas').first();
  await expect(canvas).toBeVisible();

  // The series animates in. Sampling immediately reads a canvas that has been sized but
  // not yet drawn, which shows as an all-transparent buffer and would pass a
  // "nothing is black" assertion while proving nothing.
  await page.waitForTimeout(1200);

  const pixels = await canvas.evaluate((element) => {
    const source = element as HTMLCanvasElement;
    const context = source.getContext("2d");
    if (!context) return null;
    const { width, height } = source;
    const data = context.getImageData(0, 0, width, height).data;
    const counts = { opaque: 0, black: 0, up: 0, down: 0 };
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b, a] = [data[index], data[index + 1], data[index + 2], data[index + 3]];
      if (a < 200) continue;
      counts.opaque += 1;
      if (r < 32 && g < 32 && b < 32) counts.black += 1;
      if (Math.abs(r - 0xe5) <= 24 && Math.abs(g - 0x45) <= 24 && Math.abs(b - 0x45) <= 24) counts.up += 1;
      if (Math.abs(r - 0x45) <= 24 && Math.abs(g - 0x89) <= 24 && Math.abs(b - 0xe5) <= 24) counts.down += 1;
    }
    return counts;
  });

  expect(pixels, "the chart canvas should be readable").not.toBeNull();
  expect(pixels!.opaque, "the canvas should have painted something").toBeGreaterThan(200);

  // The real assertion. Before the fix these candles were solid black; the delta colours
  // never appeared at all.
  const coloured = pixels!.up + pixels!.down;
  expect(
    coloured,
    `expected candles in ${JSON.stringify(DELTA_UP)} or ${JSON.stringify(DELTA_DOWN)}; ` +
      `saw ${pixels!.black} near-black of ${pixels!.opaque} opaque pixels`,
  ).toBeGreaterThan(50);

  // And the failure mode named in the report: a chart whose body is mostly black.
  expect(
    pixels!.black / pixels!.opaque,
    "most of the painted chart is black, which is the defect this guards",
  ).toBeLessThan(0.5);

  // Guard the helper too, so a future refactor cannot make `close` vacuous.
  expect(close(DELTA_UP.r, 0xe5)).toBe(true);
  expect(close(DELTA_UP.r, 0x00)).toBe(false);
});
