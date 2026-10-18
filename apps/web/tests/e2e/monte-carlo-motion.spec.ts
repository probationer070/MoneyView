import { expect, test, type Page } from "@playwright/test";
import { installMonteCarloWorker, PATH_FIXTURE, VALUATION_FIXTURE } from "./helpers/monteCarloWorkerMock";

// A second path run: the same fixture with the terminal median (p50 at year 5) raised to 9,800,000.
const SECOND_FIXTURE = {
  ...PATH_FIXTURE,
  path_summary: (PATH_FIXTURE.path_summary as Array<Record<string, number>>).map((row) =>
    row.time === 5 ? { ...row, p50: 9_800_000 } : row,
  ),
};

// Valuation runs that move one end of the 80% interval, then both ends.
function valuationWith(summary: Record<string, number>) {
  return { ...VALUATION_FIXTURE, fair_value_summary: { ...VALUATION_FIXTURE.fair_value_summary, ...summary } };
}
const VALUATION_P90_ONLY = valuationWith({ fair_value_p90: 61_000 });
const VALUATION_BOTH_ENDS = valuationWith({ fair_value_p10: 39_000, fair_value_p90: 63_000 });

// Counts animate() calls on the scan line. Counting calls, not running animations, makes the reduced-motion check
// independent of how far a scan has got.
function recordScanStarts() {
  const w = window as unknown as { __scanStarts: number };
  w.__scanStarts = 0;
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (this: Element, ...args: Parameters<Element["animate"]>) {
    if (this.getAttribute("data-testid") === "scan-line") w.__scanStarts += 1;
    return animate.apply(this, args);
  };
}

async function openPage(page: Page, valuation?: unknown[]) {
  await page.addInitScript(recordScanStarts);
  // Hold every result until release(): the status stays "running" until the test lets the run finish.
  await installMonteCarloWorker(page, { path: [PATH_FIXTURE, SECOND_FIXTURE], valuation, hold: true });
  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
}

async function release(page: Page) {
  await page.evaluate(() => (window as unknown as { __mcRelease: () => void }).__mcRelease());
}

async function runPath(page: Page) {
  await page.getByRole("button", { name: "Run Path Simulation" }).click();
  await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
  await release(page);
  await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
}

async function runValuation(page: Page) {
  await page.getByTestId("mc-run-valuation").click();
  await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
  await release(page);
  await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
}

async function scanStarts(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __scanStarts: number }).__scanStarts);
}

// Running animations on the result area's scan line: the last one in DOM order (the panel's line comes first).
async function resultScanRunning(page: Page): Promise<number> {
  return page.evaluate(() => {
    const lines = document.querySelectorAll('[data-testid="scan-line"]');
    const line = lines[lines.length - 1];
    return line ? line.getAnimations().filter((animation) => animation.playState === "running").length : 0;
  });
}

// Two animation frames: effects scheduled by the last committed render have run by the second.
async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test.describe("motion on", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("a re-run shows the previous median struck through and the new one inserted", async ({ page }) => {
    await openPage(page);
    const median = page.getByTestId("mc-figure-median");
    await runPath(page);
    await expect(median.locator("del")).toHaveCount(0);

    await page.getByLabel("Expected annual return").fill("12");
    await runPath(page);
    await expect(median.locator("del")).toHaveText("KRW 9.64M");
    await expect(median.locator("ins")).toHaveText("KRW 9.80M");
  });

  test("switching tabs and back clears the before value", async ({ page }) => {
    await openPage(page);
    const median = page.getByTestId("mc-figure-median");
    await runPath(page);
    await page.getByLabel("Expected annual return").fill("12");
    await runPath(page);
    await expect(median.locator("del")).toHaveText("KRW 9.64M");

    await page.getByRole("tab", { name: /Risk Analysis/i }).click();
    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    await expect(median).toContainText("KRW 9.80M");
    await expect(page.getByTestId("mc-result-header").locator("del")).toHaveCount(0);
  });

  test("a third run with an identical result shows no del for that figure", async ({ page }) => {
    await openPage(page);
    const median = page.getByTestId("mc-figure-median");
    await runPath(page);
    await page.getByLabel("Expected annual return").fill("12");
    await runPath(page);
    await expect(median.locator("del")).toHaveText("KRW 9.64M");

    // Run 3 repeats the second fixture: the median is unchanged, so the figure shows no before value.
    await runPath(page);
    await expect(median).toContainText("KRW 9.80M");
    await expect(median.locator("del")).toHaveCount(0);
  });

  test("a run that lands after a switch away and back, while still in flight, shows no before value", async ({ page }) => {
    await openPage(page);
    const median = page.getByTestId("mc-figure-median");
    await runPath(page);
    await page.getByLabel("Expected annual return").fill("12");
    await page.getByRole("button", { name: "Run Path Simulation" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");

    await page.getByRole("tab", { name: /Risk Analysis/i }).click();
    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    await release(page);
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await expect(median).toContainText("KRW 9.80M");
    await expect(median.locator("del")).toHaveCount(0);
  });

  test("a result that lands while another tab is active shows no before value when the path tab returns", async ({ page }) => {
    await openPage(page);
    const median = page.getByTestId("mc-figure-median");
    await runPath(page);
    await page.getByLabel("Expected annual return").fill("12");
    await page.getByRole("button", { name: "Run Path Simulation" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");

    await page.getByRole("tab", { name: /Risk Analysis/i }).click();
    await release(page);
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");

    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    await expect(median).toContainText("KRW 9.80M");
    await expect(median.locator("del")).toHaveCount(0);
  });

  test("a completed run scans its result area in: the scan line animates when the result lands", async ({ page }) => {
    await openPage(page);
    await page.getByRole("button", { name: "Run Path Simulation" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
    await release(page);
    // The scan starts when the result lands; the animation lasts 500ms, so it is still running when sampled right after.
    await expect.poll(() => scanStarts(page), { intervals: [10] }).toBe(1);
    expect(await resultScanRunning(page)).toBeGreaterThan(0);
  });
});

test.describe("valuation before value", () => {
  test("a re-run that moves only the 80% interval's high end shows the old range struck", async ({ page }) => {
    await openPage(page, [VALUATION_FIXTURE, VALUATION_P90_ONLY]);
    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await runValuation(page);
    await runValuation(page);

    const interval = page.getByTestId("mc-figure-interval80");
    await expect(interval.locator("del")).toHaveText("KRW 41,200–58,900");
    await expect(interval.locator("ins")).toContainText("KRW 41,200–61,000");
  });

  test("a re-run that moves both ends shows the old range struck, formatted from the old pair", async ({ page }) => {
    await openPage(page, [VALUATION_FIXTURE, VALUATION_BOTH_ENDS]);
    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await runValuation(page);
    await runValuation(page);

    const interval = page.getByTestId("mc-figure-interval80");
    await expect(interval.locator("del")).toHaveText("KRW 41,200–58,900");
    await expect(interval.locator("ins")).toContainText("KRW 39,000–63,000");
  });
});

test.describe("motion reduced", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("before and after still show, and the scan line never animates", async ({ page }) => {
    await openPage(page);
    const median = page.getByTestId("mc-figure-median");
    await runPath(page);
    await page.getByLabel("Expected annual return").fill("12");
    await runPath(page);
    await expect(median.locator("del")).toHaveText("KRW 9.64M");
    await expect(median.locator("ins")).toHaveText("KRW 9.80M");
    // Both results have landed and their effects have run: no scan was started for either.
    await settle(page);
    expect(await scanStarts(page)).toBe(0);
  });
});
