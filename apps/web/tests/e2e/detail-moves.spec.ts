import { expect, test, type Page } from "@playwright/test";
import { GEOPOLITICAL, mockEventsApi } from "./helpers/eventsApiMock";
import { makeBars, mockDetailPage, type PlantedMove } from "./helpers/detailPageMock";
import { stableInkProfile } from "./helpers/chartInk";
import { detectBigMoves } from "../../lib/detail/bigMoves";

test.use({ viewport: { width: 1280, height: 720 } });

// The second planted day is -3%, not the plan's -4%: with the +6% spike inside its 60-day window
// that day has a price multiple of about 2.6, and -4% would stay marked at price 3, so "raising
// the threshold removes it" could not be shown.
const PLANTED: PlantedMove[] = [
  { date: "2026-08-10", returnPct: 6, volumeMultiple: 3 },
  { date: "2026-09-14", returnPct: -3, volumeMultiple: 1.2 },
  { date: "2022-03-15", returnPct: -7, volumeMultiple: 3 },
];
const BARS = makeBars(260, { planted: PLANTED });
const LONG_BARS = makeBars(1300, { planted: PLANTED });
const CHART = '[data-testid="tv-chart"]';

async function open(page: Page, bars = BARS) {
  await mockDetailPage(page, "AAPL", { bars });
  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("big-move-list")).toBeVisible({ timeout: 60_000 });
}

/** The marked days as "date (shape)", in list order. */
async function marks(page: Page): Promise<string[]> {
  return page.getByTestId("big-move-list").locator("button").evaluateAll((buttons) =>
    buttons.map((button) => `${button.getAttribute("data-date")} (${button.getAttribute("data-shape")})`),
  );
}

test("default thresholds mark the planted days", async ({ page }) => {
  await open(page);
  expect(await marks(page)).toEqual(["2026-09-14 (hollow)", "2026-08-10 (filled)"]);
  await expect(page.getByTestId("big-move-count")).toHaveText("2");
});

test("raising the price threshold removes the smaller move", async ({ page }) => {
  await open(page);
  await page.getByTestId("threshold-price").fill("3");
  await expect.poll(() => marks(page)).toEqual(["2026-08-10 (filled)"]);
});

test("volume threshold 0 makes every mark hollow", async ({ page }) => {
  await open(page);
  await page.getByTestId("threshold-volume").fill("0");
  await expect.poll(() => marks(page)).toEqual(["2026-09-14 (hollow)", "2026-08-10 (hollow)"]);
});

test("thresholds persist across reload", async ({ page }) => {
  await open(page);
  await page.getByTestId("threshold-price").fill("3");
  await page.getByTestId("threshold-volume").fill("1.5");
  await expect.poll(() => marks(page)).toEqual(["2026-08-10 (filled)"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("big-move-list")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("threshold-price")).toHaveValue("3");
  await expect(page.getByTestId("threshold-volume")).toHaveValue("1.5");
  expect(await marks(page)).toEqual(["2026-08-10 (filled)"]);
  expect(await page.evaluate(() => window.localStorage.getItem("moneyview.detail.bigMove"))).toBe(JSON.stringify({ price: 3, volume: 1.5 }));
});

test("out-of-range input is clamped, and stored junk falls back to the defaults", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("moneyview.detail.bigMove", "not json"));
  await open(page);
  await expect(page.getByTestId("threshold-price")).toHaveValue("2");
  await page.getByTestId("threshold-price").fill("99");
  await page.getByTestId("threshold-price").blur();
  await expect(page.getByTestId("threshold-price")).toHaveValue("10");
  expect(await marks(page), "a price multiple of 10 is above every planted day").toEqual([]);
  await page.getByTestId("threshold-price").fill("0.1");
  await page.getByTestId("threshold-price").blur();
  await expect(page.getByTestId("threshold-price")).toHaveValue("0.5");
});

test("blocked storage uses default thresholds", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Storage.prototype.getItem = blocked;
    Storage.prototype.setItem = blocked;
    Storage.prototype.removeItem = blocked;
  });
  await open(page);
  expect(await marks(page)).toEqual(["2026-09-14 (hollow)", "2026-08-10 (filled)"]);
  await page.getByTestId("threshold-price").fill("3");
  await expect.poll(() => marks(page)).toEqual(["2026-08-10 (filled)"]);
  expect(errors, "nothing crashes").toEqual([]);
});

test("few bars give no marks and no NaN", async ({ page }) => {
  await open(page, makeBars(50, { planted: PLANTED }));
  expect(await marks(page)).toEqual([]);
  await expect(page.getByTestId("big-move-count")).toHaveText("0");
  expect(await page.locator("body").innerText()).not.toContain("NaN");
});

test("period buttons change the marked range", async ({ page }) => {
  await open(page, LONG_BARS);
  expect(await marks(page)).toEqual(["2026-09-14 (hollow)", "2026-08-10 (filled)"]);
  await page.getByRole("button", { name: "5Y", exact: true }).click();
  await expect.poll(() => marks(page)).toEqual(["2026-09-14 (hollow)", "2026-08-10 (filled)", "2022-03-15 (filled)"]);
  await page.getByRole("button", { name: "6M", exact: true }).click();
  await expect.poll(() => marks(page)).toEqual(["2026-09-14 (hollow)", "2026-08-10 (filled)"]);
});

test("the event switch hides and shows event lines", async ({ page }) => {
  await mockDetailPage(page, "AAPL", { bars: BARS });
  // Registered after the page mock, so it wins.
  await mockEventsApi(page, {
    categories: [GEOPOLITICAL],
    events: [{ id: "e1", label: "Event", category: "geopolitical", start_date: "2026-09-01", source: "https://example.com/t" }],
  });
  await page.goto("/detail/AAPL", { waitUntil: "domcontentloaded" });
  const toggle = page.getByTestId("chart-events-toggle");
  await expect(toggle).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(page.getByTestId("chart-events-filter"), "the category filter is replaced by the switch").toHaveCount(0);

  const withLine = await stableInkProfile(page, CHART);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const without = await stableInkProfile(page, CHART);
  const added = withLine.ink.filter((ink, x) => ink - (without.ink[x] ?? 0) > 0).length;
  expect(added, "switching off removes a narrow vertical line").toBeGreaterThan(0);
  expect(added).toBeLessThanOrEqual(6);

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const back = await stableInkProfile(page, CHART);
  expect(back.ink).toEqual(withLine.ink);
});

/** Snapshot every canvas alpha channel, so addedInk can later report where ink appeared. */
async function snapshot(page: Page) {
  await page.evaluate((selector) => {
    const canvases = Array.from(document.querySelectorAll(`${selector} canvas`)) as HTMLCanvasElement[];
    (window as unknown as { __snap: Uint8Array[] }).__snap = canvases.map((canvas) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      const alpha = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
      return alpha;
    });
  }, CHART);
}

/** Whether a pixel at a client position carries ink that the snapshot did not. */
async function addedAt(page: Page, at: { x: number; y: number }): Promise<boolean> {
  return page.evaluate(({ selector, x, y }) => {
    const canvases = Array.from(document.querySelectorAll(`${selector} canvas`)) as HTMLCanvasElement[];
    const before = (window as unknown as { __snap: Uint8Array[] }).__snap;
    return canvases.some((canvas, index) => {
      const rect = canvas.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
      const px = Math.round(((x - rect.left) / rect.width) * canvas.width);
      const py = Math.round(((y - rect.top) / rect.height) * canvas.height);
      const alpha = canvas.getContext("2d")!.getImageData(px, py, 1, 1).data[3];
      return alpha > 0 && !(before[index]?.[py * canvas.width + px] > 0);
    });
  }, { selector: CHART, ...at });
}

/** Where ink exists now that did not at the snapshot: pixel count and centroid in client coordinates. */
async function addedInk(page: Page): Promise<{ x: number; y: number; pixels: number } | null> {
  return page.evaluate((selector) => {
    const canvases = Array.from(document.querySelectorAll(`${selector} canvas`)) as HTMLCanvasElement[];
    const before = (window as unknown as { __snap: Uint8Array[] }).__snap;
    let sx = 0;
    let sy = 0;
    let n = 0;
    canvases.forEach((canvas, index) => {
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      const rect = canvas.getBoundingClientRect();
      for (let i = 0; i < canvas.width * canvas.height; i += 1) {
        if (data[i * 4 + 3] > 0 && !(before[index]?.[i] > 0)) {
          sx += rect.left + ((i % canvas.width) / canvas.width) * rect.width;
          sy += rect.top + (Math.floor(i / canvas.width) / canvas.height) * rect.height;
          n += 1;
        }
      }
    });
    return n === 0 ? null : { x: sx / n, y: sy / n, pixels: n };
  }, CHART);
}

test("marks are drawn on the chart: a filled mark is solid and a hollow one is a ring, and clicking it selects its day", async ({ page }) => {
  await open(page);
  await page.getByTestId("threshold-price").fill("10");
  await expect.poll(() => marks(page)).toEqual([]);
  await stableInkProfile(page, CHART);
  await snapshot(page);

  await page.getByTestId("threshold-price").fill("3");
  await expect.poll(() => marks(page)).toEqual(["2026-08-10 (filled)"]);
  await stableInkProfile(page, CHART);
  const filled = await addedInk(page);
  expect(filled, "the filled mark must put ink on the canvas").not.toBeNull();
  expect(await addedAt(page, filled!), "a filled mark is solid at its centre").toBe(true);

  await page.getByTestId("threshold-volume").fill("0");
  await expect.poll(() => marks(page)).toEqual(["2026-08-10 (hollow)"]);
  await stableInkProfile(page, CHART);
  const hollow = await addedInk(page);
  expect(hollow, "the hollow mark must put ink on the canvas").not.toBeNull();
  expect(await addedAt(page, hollow!), "a hollow mark is empty at its centre").toBe(false);

  const item = page.getByTestId("big-move-list").locator("button");
  await expect(item).toHaveAttribute("aria-pressed", "false");
  await page.mouse.click(hollow!.x, hollow!.y);
  await expect(item).toHaveAttribute("aria-pressed", "true");
  // Two clicks inside the library's double-click window are not reported as clicks.
  await page.waitForTimeout(600);
  await page.mouse.click(hollow!.x, hollow!.y);
  await expect(item).toHaveAttribute("aria-pressed", "false");
});

test("the list buttons select and deselect a day", async ({ page }) => {
  await open(page);
  const first = page.getByTestId("big-move-list").locator("button").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "false");
});

// The tests below call the detector directly. The planted days sit far from the 2.0 boundary, so
// the page tests above cannot tell a sample from a population deviation or an off-by-one window.

/** Reference price and volume multiples written the long way (sum-of-squares form, explicit loops). */
function reference(bars: ReturnType<typeof makeBars>, t: number) {
  const returns: number[] = [];
  for (let i = t - 60; i < t; i += 1) returns.push(bars[i].close / bars[i - 1].close - 1);
  const n = returns.length;
  const sumSquares = returns.reduce((acc, r) => acc + r * r, 0);
  const mean = returns.reduce((acc, r) => acc + r, 0) / n;
  const sd = Math.sqrt((sumSquares - n * mean * mean) / (n - 1));
  let volumeSum = 0;
  for (let i = t - 20; i < t; i += 1) volumeSum += bars[i].volume;
  return { price: Math.abs(bars[t].close / bars[t - 1].close - 1) / sd, volume: bars[t].volume / (volumeSum / 20) };
}

test("price and volume multiples match an independent computation on every reported day", () => {
  const moves = detectBigMoves(LONG_BARS, { price: 0.5, volume: 2 });
  expect(moves.length, "enough days to compare").toBeGreaterThan(200);
  const indexOf = new Map(LONG_BARS.map((bar, i) => [bar.date, i]));
  for (const move of moves) {
    const expected = reference(LONG_BARS, indexOf.get(move.date)!);
    expect(move.priceRatio, `price multiple on ${move.date}`).toBeCloseTo(expected.price, 9);
    expect(move.volumeRatio, `volume multiple on ${move.date}`).toBeCloseTo(expected.volume, 9);
  }
});

test("a multiple exactly at the threshold counts: >= for price and for volume", () => {
  const flat = makeBars(100, { planted: [{ date: "2026-10-23", returnPct: 8, volumeMultiple: 1 }] }).map((bar, i, all) => ({
    ...bar,
    volume: i === all.length - 1 ? 2_000_000 : 1_000_000,
  }));
  // Volume: the day is exactly 2x the 20-day mean (all other days are exactly 1,000,000).
  const [atVolume] = detectBigMoves(flat, { price: 2, volume: 2 });
  expect(atVolume.date).toBe("2026-10-23");
  expect(atVolume.volumeRatio).toBe(2);
  expect(atVolume.strong, "volume exactly at the threshold is filled").toBe(true);
  // Price: feed the detector its own multiple back as the threshold.
  const [atPrice] = detectBigMoves(flat, { price: 2, volume: 2 });
  expect(detectBigMoves(flat, { price: atPrice.priceRatio, volume: 2 }).map((move) => move.date)).toContain("2026-10-23");
  expect(detectBigMoves(flat, { price: atPrice.priceRatio * 1.0000001, volume: 2 }).map((move) => move.date)).not.toContain("2026-10-23");
});

test("the 60-return window: 61 bars give no mark, 62 bars give one", () => {
  const huge = (n: number) => makeBars(n, { planted: [{ date: "2026-10-23", returnPct: 15, volumeMultiple: 1 }] });
  expect(detectBigMoves(huge(61), { price: 2, volume: 2 })).toEqual([]);
  expect(detectBigMoves(huge(62), { price: 2, volume: 2 }).map((move) => move.date)).toEqual(["2026-10-23"]);
});

test("a zero volume threshold turns the volume test off, and from limits the reported days only", () => {
  const all = detectBigMoves(LONG_BARS, { price: 2, volume: 0 });
  expect(all.every((move) => !move.strong)).toBe(true);
  const since = detectBigMoves(LONG_BARS, { price: 2, volume: 0 }, "2026-01-01");
  expect(since.map((move) => move.date)).toEqual(all.map((move) => move.date).filter((date) => date >= "2026-01-01"));
  expect(since.length).toBeGreaterThan(0);
});
