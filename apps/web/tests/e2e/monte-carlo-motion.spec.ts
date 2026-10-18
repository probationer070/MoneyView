import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMonteCarloWorker, PATH_FIXTURE } from "./helpers/monteCarloWorkerMock";

// A second path run: the same fixture with the terminal median (p50 at year 5) raised to 9,800,000.
const SECOND_FIXTURE = {
  ...PATH_FIXTURE,
  path_summary: (PATH_FIXTURE.path_summary as Array<Record<string, number>>).map((row) =>
    row.time === 5 ? { ...row, p50: 9_800_000 } : row,
  ),
};

async function openPage(page: Page) {
  // Hold every result until release(): the status stays "running" until the test lets the run finish.
  await installMonteCarloWorker(page, { path: [PATH_FIXTURE, SECOND_FIXTURE], hold: true });
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

// The result area's scan line is the inner one: the tab panel's own ScanReveal line comes first in the DOM.
function resultScanLine(page: Page): Locator {
  return page.getByTestId("mc-panel").getByTestId("scan-line").last();
}

function runningAnimations(line: Locator): Promise<number> {
  return line.evaluate((el) => el.getAnimations().filter((animation) => animation.playState === "running").length);
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

  test("a completed run scans its result area in: the scan line animates within 100ms", async ({ page }) => {
    await openPage(page);
    await runPath(page);
    await expect.poll(() => runningAnimations(resultScanLine(page)), { timeout: 100, intervals: [10] }).toBeGreaterThan(0);
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
    expect(await runningAnimations(resultScanLine(page))).toBe(0);
  });
});
