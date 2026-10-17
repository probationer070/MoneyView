import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMonteCarloWorker } from "./helpers/monteCarloWorkerMock";

// The panel (ChartPanelFrame section) that owns a heading. It stays the same element whether or not the chart drew.
function panelOf(page: Page, heading: string): Locator {
  return page.getByRole("heading", { name: heading }).locator("xpath=ancestor::section[1]");
}

async function barHeights(panel: Locator): Promise<number[]> {
  return panel.locator(".recharts-bar-rectangle").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
}

test.describe("risk charts draw", () => {
  test("both risk charts draw their bars after a path run", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Run Path Simulation" }).click();
    await page.getByRole("tab", { name: /Risk Analysis/i }).click();

    const var_ = panelOf(page, "VaR / CVaR Risk Distribution");
    const percentiles = panelOf(page, "Terminal Value Percentiles");
    await expect(var_.locator(".recharts-bar-rectangle")).toHaveCount(6);
    await expect(percentiles.locator(".recharts-bar-rectangle")).toHaveCount(7);

    // Every bar has a drawn height, not only a node.
    await expect.poll(async () => (await barHeights(var_)).filter((h) => h > 0).length).toBe(6);
    await expect.poll(async () => (await barHeights(percentiles)).filter((h) => h > 0).length).toBe(7);
  });
});

test.describe("KRW amounts after a path run", () => {
  test("en: the median reads KRW 9.64M and the path chart's Y axis is labelled KRW M", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Run Path Simulation" }).click();

    await expect(page.getByText("KRW 9.64M").first()).toBeVisible();
    await expect(panelOf(page, "GBM + Jump-Diffusion Simulated Paths").getByText("KRW M", { exact: true })).toBeVisible();
    await expect(page.getByText("964 M KRW")).toHaveCount(0);
  });

  test.describe("ko", () => {
    test.use({ locale: "ko-KR" });

    test("ko: the median reads 964만원 and the path chart's Y axis is labelled 만원", async ({ page }) => {
      await installMonteCarloWorker(page);
      await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "시뮬레이션 랩", exact: true })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Run Path Simulation" }).click();

      await expect(page.getByText("964만원").first()).toBeVisible();
      await expect(panelOf(page, "GBM + Jump-Diffusion Simulated Paths").getByText("만원", { exact: true })).toBeVisible();
    });
  });
});

// Releases held worker runs in queue order: the superseded run's stale result first, then the new job's.
async function releaseHeld(page: Page, count: number): Promise<void> {
  await page.evaluate((n) => {
    const w = window as unknown as { __mcRelease: () => void };
    for (let index = 0; index < n; index += 1) w.__mcRelease();
  }, count);
}

async function cancelRequestCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __mcCancelled: string[] }).__mcCancelled.length);
}

test.describe("superseded run", () => {
  test("a path run superseded by a valuation run leaves the path tab canceled, and the valuation run completes", async ({ page }) => {
    await installMonteCarloWorker(page, { hold: true });
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Run Path Simulation" }).click();
    await expect(page.getByText("Worker progress")).toBeVisible();

    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await page.getByRole("button", { name: "Run Valuation" }).click();
    const valuationPanel = page.getByRole("tabpanel");
    await expect(valuationPanel.getByText("Running valuation")).toBeVisible();
    await expect(valuationPanel.getByText("Worker progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();

    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    const pathPanel = page.getByRole("tabpanel");
    await expect(pathPanel.getByText("Run canceled")).toBeVisible();
    await expect(pathPanel.getByText("Worker progress")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run Path Simulation" })).toBeEnabled();

    await releaseHeld(page, 2);
    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await expect(page.getByRole("tabpanel").getByText("Results ready")).toBeVisible();
    await expect.poll(() => cancelRequestCount(page)).toBe(1);
  });

  test("a valuation run superseded by a correlation run leaves the valuation tab canceled, and the correlation run completes", async ({ page }) => {
    await installMonteCarloWorker(page, { hold: true });
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await page.getByRole("button", { name: "Run Valuation" }).click();
    await expect(page.getByText("Worker progress")).toBeVisible();

    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    const correlationPanel = page.getByRole("tabpanel");
    await expect(correlationPanel.getByText("Running correlation analysis")).toBeVisible();
    await expect(correlationPanel.getByText("Worker progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run Correlation Analysis" })).toBeDisabled();

    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    const valuationPanel = page.getByRole("tabpanel");
    await expect(valuationPanel.getByText("Run canceled")).toBeVisible();
    await expect(valuationPanel.getByText("Worker progress")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run Valuation" })).toBeEnabled();

    await releaseHeld(page, 2);
    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    await expect(page.getByRole("tabpanel").getByText("Results ready")).toBeVisible();
    await expect.poll(() => cancelRequestCount(page)).toBe(1);
  });

  test("a correlation run superseded by a path run goes back to idle, never Run canceled, and the path run completes", async ({ page }) => {
    await installMonteCarloWorker(page, { hold: true });
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    await expect(page.getByText("Worker progress")).toBeVisible();

    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    await page.getByRole("button", { name: "Run Path Simulation" }).click();
    const pathPanel = page.getByRole("tabpanel");
    await expect(pathPanel.getByText("Running path simulation")).toBeVisible();
    await expect(pathPanel.getByText("Worker progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();

    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    const correlationPanel = page.getByRole("tabpanel");
    await expect(correlationPanel.getByText("No analysis run yet")).toBeVisible();
    await expect(correlationPanel.getByText("Run canceled")).toHaveCount(0);
    await expect(correlationPanel.getByText("Worker progress")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Run Correlation Analysis" })).toBeEnabled();

    await releaseHeld(page, 2);
    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    await expect(page.getByRole("tabpanel").getByText("Results ready")).toBeVisible();
    await expect.poll(() => cancelRequestCount(page)).toBe(1);
  });
});
