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
      await page.getByRole("button", { name: "경로 시뮬레이션 실행" }).click();

      await expect(page.getByText("964만원").first()).toBeVisible();
      await expect(panelOf(page, "GBM + 점프 확산 시뮬레이션 경로").getByText("만원", { exact: true })).toBeVisible();
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
    await expect(page.getByTestId("mc-status-progress")).toBeVisible();

    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await page.getByRole("button", { name: "Run Valuation" }).click();
    const valuationPanel = page.getByRole("tabpanel");
    await expect(valuationPanel.getByText("Running valuation")).toBeVisible();
    await expect(valuationPanel.getByText("Worker progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeEnabled();

    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    const pathPanel = page.getByRole("tabpanel");
    await expect(pathPanel.getByText("Run canceled")).toBeVisible();
    await expect(pathPanel.getByTestId("mc-status-progress")).toHaveCount(0);
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
    await expect(pathPanel.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
    await expect(pathPanel.getByTestId("mc-status-progress")).toBeVisible();
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

test.describe("frame", () => {
  const TAB_KEY = "moneyview.tab.monteCarlo.tab";

  test("the chosen tab survives a reload", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Return Distribution/i }).click();
    await expect(page.getByRole("tab", { name: /Return Distribution/i })).toHaveAttribute("aria-selected", "true");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("tab", { name: /Return Distribution/i })).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate((key) => window.sessionStorage.getItem(key), TAB_KEY)).toBe('"distribution"');
  });

  for (const stored of ['"bogus"', '"constructor"', "not json"]) {
    test(`an unknown stored tab (${stored}) opens Path`, async ({ page }) => {
      await installMonteCarloWorker(page);
      await page.addInitScript(([key, value]) => window.sessionStorage.setItem(key, value), [TAB_KEY, stored]);
      await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("tab", { name: /Path Simulation/i })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("button", { name: "Run Path Simulation" })).toBeVisible();
    });
  }

  test("the header is one title and one subtitle line", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    const h1 = page.getByRole("heading", { level: 1, name: "Simulation Lab" });
    await expect(h1).toBeVisible({ timeout: 60_000 });
    const header = h1.locator("xpath=..");
    // Only the h1 and the subtitle: an eyebrow would be a third child.
    await expect(header.locator(":scope > *")).toHaveCount(2);
    const subtitle = header.getByText("Path, risk, distribution, valuation and correlation simulations");
    await expect(subtitle).toBeVisible();
    const box = await subtitle.evaluate((node) => ({
      height: node.clientHeight,
      line: Number.parseFloat(getComputedStyle(node).lineHeight),
    }));
    expect(box.height).toBeLessThanOrEqual(box.line + 1);
  });
});

// Same shape as the degraded output in monte-carlo-chart-guard.spec.ts: several normalization warnings, invalid charts.
const DEGRADED_FIXTURE = {
  ticker: "SIM",
  model: "mock",
  execution_mode: "interactive",
  path_summary: [{ time: "bad-row", mean: 1e7, p05: 8e6, p10: 8.5e6, p25: 9e6, p50: 1e7, p75: 1.1e7, p90: 1.15e7, p95: 1.2e7 }],
  sample_paths: [{ time: 0, path_1: 1e7 }, { time: "bad-time", path_1: Number.NaN }],
  risk_metrics: { loss_probability: 12, sharpe_ratio: 1.1, sortino_ratio: 1, skewness: 0.2, kurtosis: 3.4, max_return: 25, min_return: -12, var95: 6, var99: 9, cvar95: 11, mean_return: 10, median_return: 9, volatility: 18, excess_kurtosis: 0.4 },
  histogram: [{ return: -5, frequency: 3, loss_bucket: 1 }, { return: "broken", frequency: 4 }],
  normal_fit: [{ return: -5, density: 0.5 }, { return: "broken", density: 0.2 }],
  cdf_comparison: [{ return: "broken", simulated_cdf: 0.4, normal_cdf: 0.3 }],
};

async function openPath(page: Page, options?: Parameters<typeof installMonteCarloWorker>[1]): Promise<void> {
  await installMonteCarloWorker(page, options);
  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
}

async function expectNoPageScroll(page: Page): Promise<void> {
  const size = await page.evaluate(() => ({
    height: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    width: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.height, "the page does not scroll").toBeLessThanOrEqual(size.innerHeight);
  expect(size.width, "the page is not wider than the viewport").toBeLessThanOrEqual(size.clientWidth + 1);
}

test.describe("path", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("the header and both charts end inside the panel after a run, and each chart is at least 200px tall", async ({ page }) => {
    await openPath(page);
    // Until /monte-carlo joins ONE_SCREEN_ROUTES (Task 10) the shell keeps 5rem of bottom padding, 54px less than the
    // 503px panel budget. Apply the one-screen padding here so the test measures the budget this layout is built for.
    await page.addStyleTag({ content: "main { --main-pad-bottom: 1.5rem !important; }" });
    const before = await page.getByTestId("mc-result-header").boundingBox();
    const panelBefore = (await page.getByTestId("mc-panel").boundingBox())!;
    for (const title of ["GBM + Jump-Diffusion Simulated Paths", "Percentile Cone"]) {
      const frame = (await panelOf(page, title).boundingBox())!;
      expect(frame.y + frame.height, `${title} (empty) ends inside the panel`).toBeLessThanOrEqual(panelBefore.y + panelBefore.height + 1);
      console.log("MC path before-run frame", title, Math.round(frame.height));
    }
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");

    const panel = (await page.getByTestId("mc-panel").boundingBox())!;
    const header = (await page.getByTestId("mc-result-header").boundingBox())!;
    expect(header.y + header.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    const heights: Record<string, number> = { panel: panel.height, headerBefore: before!.height, header: header.height };
    for (const title of ["GBM + Jump-Diffusion Simulated Paths", "Percentile Cone"]) {
      const frame = (await panelOf(page, title).boundingBox())!;
      expect(frame.y + frame.height, `${title} ends inside the panel`).toBeLessThanOrEqual(panel.y + panel.height + 1);
      const rect = await panelOf(page, title).locator(".recharts-surface").first().evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { height: box.height, bottom: box.bottom };
      });
      const surface = rect.height;
      expect(surface, `${title} chart height`).toBeGreaterThanOrEqual(200);
      expect(rect.bottom, `${title} chart ends inside its frame`).toBeLessThanOrEqual(frame.y + frame.height + 1);
      heights[title] = Math.round(surface);
      heights[`${title} frame`] = Math.round(frame.height);
    }
    console.log("MC path heights", JSON.stringify(heights));
  });

  test("Run and Cancel stay where they are while the inputs scroll", async ({ page }) => {
    await openPath(page);
    const inputs = page.getByTestId("mc-rail-inputs");
    // Precondition: the 8 fields do not fit, so there is something to scroll.
    expect(await inputs.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const run = page.getByTestId("mc-run-path");
    const before = await run.boundingBox();
    await inputs.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect(await inputs.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    const after = await run.boundingBox();
    expect(after).toEqual(before);
    expect(after!.y + after!.height).toBeLessThanOrEqual(720);
    const actions = (await page.getByTestId("mc-rail-actions").boundingBox())!;
    const box = (await inputs.boundingBox())!;
    expect(actions.y).toBeGreaterThanOrEqual(box.y + box.height - 1);
  });

  test("every figure reads a dash before a run; after it the median is KRW 9.64M and the status is ready", async ({ page }) => {
    await openPath(page);
    await expect(page.getByTestId("mc-status")).toHaveText("No analysis run yet");
    for (const key of ["median", "expectedReturn", "lossProbability", "sharpe"]) {
      await expect(page.getByTestId(`mc-figure-${key}-value`)).toHaveText("—");
    }
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-figure-median-value")).toHaveText("KRW 9.64M");
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
  });

  test("a held run shows its progress and can be cancelled", async ({ page }) => {
    await openPath(page, { hold: true });
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status-progress")).toHaveText("50%");
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
    await expect(page.getByTestId("mc-cancel-path")).toBeEnabled();
    await page.getByTestId("mc-cancel-path").click();
    await expect(page.getByTestId("mc-status")).toHaveText("Run canceled");
  });

  test("each export item downloads its file; the menu is disabled before a run", async ({ page }) => {
    await openPath(page);
    await expect(page.getByTestId("mc-export")).toBeDisabled();
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    const files = { summary: "summary.csv", cone: "percentile_cone.csv", paths: "sample_paths.csv", histogram: "terminal_distribution.csv" };
    for (const [key, file] of Object.entries(files)) {
      await page.getByTestId("mc-export").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`mc-export-${key}`).click()]);
      expect(download.suggestedFilename()).toBe(file);
      await expect(page.getByRole("menu")).toHaveCount(0);
    }
  });

  test("the cone legend carries the KRW range of each interval", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    const legend = page.getByTestId("mc-cone-legend");
    await expect(legend).toContainText("5%-95% · KRW 8.00M–KRW 12.10M");
    await expect(legend).toContainText("Median · KRW 9.64M");
  });

  test("several warnings start collapsed behind a toggle and one click shows them", async ({ page }) => {
    await openPath(page, { path: [DEGRADED_FIXTURE] });
    await page.getByTestId("mc-run-path").click();
    const toggle = page.getByTestId("mc-warnings-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByText(/Dropped invalid percentile-cone row 1\./)).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText(/Dropped invalid percentile-cone row 1\./)).toBeVisible();
  });
});

test.describe("path at 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the rail starts collapsed, Run stays visible, the page does not scroll, and the toggle opens the inputs", async ({ page }) => {
    await openPath(page);
    const toggle = page.getByTestId("mc-rail-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("mc-run-path")).toBeVisible();
    await expectNoPageScroll(page);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByLabel("Initial investment")).toBeVisible();
    await expect(page.getByTestId("mc-run-path")).toBeVisible();
    await expectNoPageScroll(page);
  });
});

test.describe("ScanReveal body class", () => {
  // The body is the scan line's next sibling.
  const bodyClass = (page: Page) => page.getByTestId("scan-line").evaluate((line) => line.nextElementSibling!.getAttribute("class"));

  test("a caller without bodyClassName gets a body with no class attribute", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("scan-line")).toBeAttached({ timeout: 60_000 });
    expect(await bodyClass(page)).toBeNull();
  });

  test("a caller with bodyClassName gets that class on the body", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("scan-line")).toBeAttached({ timeout: 60_000 });
    expect(await bodyClass(page)).toBe("flex min-h-0 flex-1 flex-col");
  });
});
