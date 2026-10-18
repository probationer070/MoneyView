import { expect, test, type Locator, type Page } from "@playwright/test";
import { installMonteCarloWorker, PATH_FIXTURE, pathError } from "./helpers/monteCarloWorkerMock";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { tokens } from "../../lib/tokens.generated";

// The chart minimum height, from the token the layout reads (component.chart.min-height).
const CHART_MIN = Number.parseFloat(tokens.component.chart["min-height"]);

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
    await expect(var_.locator(".recharts-bar-rectangle")).toHaveCount(6);
    // Every bar has a drawn height, not only a node.
    await expect.poll(async () => (await barHeights(var_)).filter((h) => h > 0).length).toBe(6);

    // The percentile chart is the other view of the same area: switch to it.
    await page.getByRole("group", { name: "Risk chart" }).getByRole("button", { name: "Percentiles" }).click();
    const percentiles = panelOf(page, "Terminal Value Percentiles");
    await expect(percentiles.locator(".recharts-bar-rectangle")).toHaveCount(7);
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
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
    await expect(page.getByTestId("mc-status-progress")).toBeVisible();
    await expect(page.getByTestId("mc-cancel-valuation")).toBeEnabled();

    await page.getByRole("tab", { name: /Path Simulation/i }).click();
    const pathPanel = page.getByRole("tabpanel");
    await expect(pathPanel.getByTestId("mc-status")).toHaveText("Run canceled");
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
    await page.getByTestId("mc-run-valuation").click();
    await expect(page.getByTestId("mc-status-progress")).toBeVisible();

    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
    await expect(page.getByTestId("mc-status-progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run Correlation Analysis" })).toBeDisabled();

    await page.getByRole("tab", { name: /Corporate Valuation/i }).click();
    await expect(page.getByTestId("mc-status")).toHaveText("Run canceled");
    await expect(page.getByTestId("mc-status-progress")).toHaveCount(0);
    await expect(page.getByTestId("mc-run-valuation")).toBeEnabled();

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
    await expect(page.getByTestId("mc-status-progress")).toBeVisible();

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
    await expect(page.getByTestId("mc-status-progress")).toHaveCount(0);
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
    const panelBefore = (await page.getByTestId("mc-panel").boundingBox())!;
    for (const title of ["GBM + Jump-Diffusion Simulated Paths", "Percentile Cone"]) {
      const frame = (await panelOf(page, title).boundingBox())!;
      expect(frame.y + frame.height, `${title} (empty) ends inside the panel`).toBeLessThanOrEqual(panelBefore.y + panelBefore.height + 1);
    }
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");

    const panel = (await page.getByTestId("mc-panel").boundingBox())!;
    const header = (await page.getByTestId("mc-result-header").boundingBox())!;
    expect(header.y + header.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
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
    }
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

  test("the export menu follows the menu keyboard pattern", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    const trigger = page.getByTestId("mc-export");
    await trigger.click();
    await expect(page.getByRole("menu", { name: "Export" })).toBeVisible();
    const item = (key: string) => page.getByTestId(`mc-export-${key}`);
    await expect(item("summary")).toBeFocused();
    await expect(item("cone")).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("ArrowDown");
    await expect(item("cone")).toBeFocused();
    await expect(item("cone")).toHaveAttribute("tabindex", "0");
    await expect(item("summary")).toHaveAttribute("tabindex", "-1");
    await page.keyboard.press("End");
    await expect(item("histogram")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(item("summary")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(item("histogram")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(item("summary")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
    expect(download.suggestedFilename()).toBe("summary.csv");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("under reduced motion the run arrow does not move on hover or focus", async ({ page }) => {
    await openPath(page);
    const run = page.getByTestId("mc-run-path");
    const arrow = run.locator("span[aria-hidden=true]");
    const shift = () => arrow.evaluate((node) => getComputedStyle(node).translate);
    await run.hover();
    expect(["none", "0px", "0px 0px"]).toContain(await shift());
    await page.mouse.move(0, 0);
    await run.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(["none", "0px", "0px 0px"]).toContain(await shift());
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
  // The body is the scan line's next sibling. On /monte-carlo the result area has its own scan line; the panel's comes first.
  const bodyClass = (page: Page) => page.getByTestId("scan-line").first().evaluate((line) => line.nextElementSibling!.getAttribute("class"));

  test("a caller without bodyClassName gets a body with no class attribute", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("scan-line")).toBeAttached({ timeout: 60_000 });
    expect(await bodyClass(page)).toBeNull();
  });

  test("a caller with bodyClassName gets that class on the body", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("scan-line").first()).toBeAttached({ timeout: 60_000 });
    expect(await bodyClass(page)).toBe("flex min-h-0 flex-1 flex-col");
  });
});

test.describe("risk and distribution", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  const PROMPT = "Run the path simulation on the Path tab first.";
  const TABS = [
    ["risk", /Risk Analysis/],
    ["distribution", /Return Distribution/],
  ] as const;

  for (const [name, tab] of TABS) {
    test(`${name}: before a path run the tab asks for one, and its button opens Path`, async ({ page }) => {
      await openPath(page);
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByTestId("mc-run-prompt")).toHaveText(PROMPT);
      await expect(page.getByTestId("mc-status")).toHaveText("No analysis run yet");
      await page.getByTestId("mc-run-prompt-open").click();
      await expect(page.getByRole("tab", { name: /Path Simulation/ })).toHaveAttribute("aria-selected", "true");
    });

    test(`${name}: while a path run is in flight the tab shows its progress and no prompt`, async ({ page }) => {
      await openPath(page, { hold: true });
      await page.getByTestId("mc-run-path").click();
      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
      await expect(page.getByTestId("mc-status-progress")).toHaveText("50%");
      await expect(page.getByTestId("mc-run-prompt")).toHaveCount(0);
    });
  }

  test("risk: after a run the six risk figures are shown, and VaR 95 reads KRW 600,000", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Risk Analysis/ }).click();
    for (const key of ["var95", "var99", "cvar95", "maxDrawdown", "sortino", "skewness"]) {
      await expect(page.getByTestId(`mc-figure-${key}-value`)).toBeVisible();
    }
    await expect(page.getByTestId("mc-figure-var95-value")).toHaveText("KRW 600,000");
  });

  test("distribution: after a run the five distribution figures are shown", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Return Distribution/ }).click();
    for (const key of ["mean", "std", "kurtosis", "max", "min"]) {
      await expect(page.getByTestId(`mc-figure-${key}-value`)).toBeVisible();
    }
  });

  test("risk: the view toggle switches between the VaR chart and the percentile chart, and the statistical summary stays", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Risk Analysis/ }).click();
    const group = page.getByRole("group", { name: "Risk chart" });
    await expect(group.getByRole("button", { name: "VaR / CVaR" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "VaR / CVaR Risk Distribution" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Terminal Value Percentiles" })).toHaveCount(0);

    await group.getByRole("button", { name: "Percentiles" }).click();
    await expect(group.getByRole("button", { name: "Percentiles" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Terminal Value Percentiles" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "VaR / CVaR Risk Distribution" })).toHaveCount(0);
    await expect(panelOf(page, "Terminal Value Percentiles").getByText("KRW M", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Statistical Summary" })).toBeVisible();
  });

  test("risk: the two exports download risk_summary.csv and risk_histogram.csv", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Risk Analysis/ }).click();
    const files = { "risk-summary": "risk_summary.csv", "risk-histogram": "risk_histogram.csv" };
    for (const [key, file] of Object.entries(files)) {
      await page.getByTestId("mc-export").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`mc-export-${key}`).click()]);
      expect(download.suggestedFilename()).toBe(file);
    }
  });

  test("distribution: the two exports download return_histogram.csv and return_cdf.csv", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Return Distribution/ }).click();
    const files = { "return-histogram": "return_histogram.csv", "return-cdf": "return_cdf.csv" };
    for (const [key, file] of Object.entries(files)) {
      await page.getByTestId("mc-export").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`mc-export-${key}`).click()]);
      expect(download.suggestedFilename()).toBe(file);
    }
  });

  test("risk: at 1280x720 after a run, the header, both risk chart views and the statistical summary end inside the panel", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Risk Analysis/ }).click();

    const panel = (await page.getByTestId("mc-panel").boundingBox())!;
    const bottom = panel.y + panel.height + 1;
    const header = (await page.getByTestId("mc-result-header").boundingBox())!;
    expect(header.y + header.height, "result header ends inside the panel").toBeLessThanOrEqual(bottom);

    const group = page.getByRole("group", { name: "Risk chart" });
    const summary = (await page.getByRole("heading", { name: "Statistical Summary" }).locator("xpath=..").boundingBox())!;
    expect(summary.y + summary.height, "statistical summary ends inside the panel").toBeLessThanOrEqual(bottom);

    for (const [view, title] of [["VaR / CVaR", "VaR / CVaR Risk Distribution"], ["Percentiles", "Terminal Value Percentiles"]] as const) {
      await group.getByRole("button", { name: view }).click();
      const frame = (await panelOf(page, title).boundingBox())!;
      expect(frame.y + frame.height, `${title} ends inside the panel`).toBeLessThanOrEqual(bottom);
      const surface = (await panelOf(page, title).locator(".recharts-surface").first().boundingBox())!;
      expect(surface.height, `${title} chart height`).toBeGreaterThanOrEqual(200);
      expect(surface.y + surface.height, `${title} chart ends inside its frame`).toBeLessThanOrEqual(frame.y + frame.height + 1);
    }
  });

  test("distribution: at 1280x720 after a run, the histogram and CDF sit side by side inside the panel, each at least 200px tall", async ({ page }) => {
    await openPath(page);
    await page.getByTestId("mc-run-path").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await page.getByRole("tab", { name: /Return Distribution/ }).click();

    const panel = (await page.getByTestId("mc-panel").boundingBox())!;
    const bottom = panel.y + panel.height + 1;
    const header = (await page.getByTestId("mc-result-header").boundingBox())!;
    expect(header.y + header.height, "result header ends inside the panel").toBeLessThanOrEqual(bottom);

    const histogramTitle = "Return Histogram with Fitted Normal Curve";
    const histogram = (await panelOf(page, histogramTitle).boundingBox())!;
    const cdf = (await panelOf(page, "CDF Comparison").boundingBox())!;
    expect(Math.abs(histogram.y - cdf.y), "the two charts share a top edge").toBeLessThanOrEqual(1);
    expect(histogram.x + histogram.width, "the histogram sits left of the CDF").toBeLessThanOrEqual(cdf.x + 1);
    for (const [title, frame] of [[histogramTitle, histogram], ["CDF Comparison", cdf]] as const) {
      expect(frame.y + frame.height, `${title} ends inside the panel`).toBeLessThanOrEqual(bottom);
      const surface = (await panelOf(page, title).locator(".recharts-surface").first().boundingBox())!;
      expect(surface.height, `${title} chart height`).toBeGreaterThanOrEqual(CHART_MIN);
      // The chart fills its frame (same bound as the valuation chart): a fixed-height chart stops short of the frame bottom.
      const gap = frame.y + frame.height - (surface.y + surface.height);
      expect(gap, `${title} chart bottom is inside its frame`).toBeGreaterThanOrEqual(-1);
      expect(gap, `${title} chart fills its frame`).toBeLessThanOrEqual(40);
    }
  });
});

test.describe("valuation", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function openValuation(page: Page, heading: RegExp, tab: RegExp): Promise<void> {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: tab }).click();
  }

  const priceOk = (ticker: string, price: number) => JSON.stringify({
    status: "ok",
    data: {
      ticker,
      status: "ok",
      price,
      as_of_date: "2026-04-19",
      source: "cache",
      freshness_status: "fresh_cache",
      retry_after_seconds: null,
      detail_note: "Latest price served from local cache.",
    },
  });

  test("after a run the 80% interval reads KRW 41,200–58,900 and the median reads KRW 50,000", async ({ page }) => {
    await openValuation(page, /Simulation Lab/, /Corporate Valuation/);
    await expect(page.getByTestId("mc-figure-interval80-value")).toHaveText("—");
    await page.getByTestId("mc-run-valuation").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("mc-figure-interval80-value")).toHaveText("KRW 41,200–58,900");
    await expect(page.getByTestId("mc-figure-median-value")).toHaveText("KRW 50,000");
  });

  test.describe("ko", () => {
    test.use({ locale: "ko-KR" });

    test("ko: the interval reads 41,200–58,900원 and the median reads 50,000원", async ({ page }) => {
      await openValuation(page, /시뮬레이션 랩/, /기업가치 평가/);
      await page.getByTestId("mc-run-valuation").click();
      await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
      await expect(page.getByTestId("mc-figure-interval80-value")).toHaveText("41,200–58,900원");
      await expect(page.getByTestId("mc-figure-median-value")).toHaveText("50,000원");
    });

    test("ko: a loaded price lookup is announced in Korean under the ticker", async ({ page }) => {
      await page.route("**/api/v1/stock/AAPL/price", (route) => route.fulfill({ status: 200, contentType: "application/json", body: priceOk("AAPL", 211400) }));
      await openValuation(page, /시뮬레이션 랩/, /기업가치 평가/);
      await page.getByLabel("티커").fill("AAPL");
      await page.getByLabel("티커").press("Tab");
      await expect(page.getByTestId("mc-price-lookup")).toHaveText("AAPL 가격을 캐시에서 불러왔습니다.");
    });
  });

  test("the lookup message sits under the Ticker input and above the next field", async ({ page }) => {
    await page.route("**/api/v1/stock/AAPL/price", (route) => route.fulfill({ status: 200, contentType: "application/json", body: priceOk("AAPL", 211400) }));
    await openValuation(page, /Simulation Lab/, /Corporate Valuation/);
    await page.getByLabel("Ticker").fill("AAPL");
    await page.getByLabel("Ticker").press("Tab");
    const message = page.getByTestId("mc-price-lookup");
    await expect(message).toHaveText("AAPL price loaded from cache.");
    await expect(message).toHaveAttribute("role", "status");

    const input = (await page.getByLabel("Ticker").boundingBox())!;
    const box = (await message.boundingBox())!;
    const next = (await page.locator("label", { hasText: "Current stock price" }).boundingBox())!;
    expect(box.y, "the message starts below the Ticker input").toBeGreaterThanOrEqual(input.y + input.height - 1);
    expect(box.y + box.height, "the message ends above the next field").toBeLessThanOrEqual(next.y + 1);
  });

  test("the two valuation exports download valuation_summary.csv and valuation_distribution.csv", async ({ page }) => {
    await openValuation(page, /Simulation Lab/, /Corporate Valuation/);
    await page.getByTestId("mc-run-valuation").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    const files = { "valuation-summary": "valuation_summary.csv", "valuation-distribution": "valuation_distribution.csv" };
    for (const [key, file] of Object.entries(files)) {
      await page.getByTestId("mc-export").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`mc-export-${key}`).click()]);
      expect(download.suggestedFilename()).toBe(file);
    }
  });

  test("at 1280x720 after a run, the header, the distribution chart and the statistics table end inside the panel", async ({ page }) => {
    await openValuation(page, /Simulation Lab/, /Corporate Valuation/);
    await page.getByTestId("mc-run-valuation").click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");

    const panel = (await page.getByTestId("mc-panel").boundingBox())!;
    const bottom = panel.y + panel.height + 1;
    const header = (await page.getByTestId("mc-result-header").boundingBox())!;
    expect(header.y + header.height, "result header ends inside the panel").toBeLessThanOrEqual(bottom);

    const frame = (await panelOf(page, "Fair Value Distribution").boundingBox())!;
    expect(frame.y + frame.height, "fair-value distribution ends inside the panel").toBeLessThanOrEqual(bottom);
    const surface = (await panelOf(page, "Fair Value Distribution").locator(".recharts-surface").first().boundingBox())!;
    expect(surface.height, "fair-value distribution chart height").toBeGreaterThanOrEqual(200);
    // The chart fills the chart area: its bottom sits just above the panel bottom (measured 21px). A fixed height
    // overflows the panel (gap < 0) or stops well short (gap > 40).
    const gap = panel.y + panel.height - (surface.y + surface.height);
    expect(gap, "chart bottom is not below the panel bottom").toBeGreaterThanOrEqual(0);
    expect(gap, "chart bottom is close to the panel bottom").toBeLessThanOrEqual(40);

    const stats = (await page.getByRole("heading", { name: "Valuation Statistics" }).locator("xpath=..").boundingBox())!;
    expect(stats.y + stats.height, "valuation statistics end inside the panel").toBeLessThanOrEqual(bottom);
  });

  test("Run and Cancel stay where they are while the 11-field rail scrolls", async ({ page }) => {
    await openValuation(page, /Simulation Lab/, /Corporate Valuation/);
    const inputs = page.getByTestId("mc-rail-inputs");
    // Precondition: the 11 fields do not fit, so there is something to scroll.
    expect(await inputs.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const run = page.getByTestId("mc-run-valuation");
    const before = await run.boundingBox();
    await inputs.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect(await inputs.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect(await run.boundingBox()).toEqual(before);
    expect(before!.y + before!.height).toBeLessThanOrEqual(720);
  });
});

test.describe("correlation", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function openCorrelation(page: Page, options?: Parameters<typeof installMonteCarloWorker>[1]): Promise<void> {
    await installMonteCarloWorker(page, options);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    await expect(page.getByRole("button", { name: "Run Correlation Analysis" })).toBeVisible();
  }

  test("the matrix fits the 320px rail: no value is clipped by its input or cell", async ({ page }) => {
    await openCorrelation(page);
    const matrix = page.getByTestId("mc-correlation-matrix");
    // The widest value a cell takes (sign and two decimals) goes into every editable cell, so a cell that would clip it shows.
    for (const input of await matrix.locator("input").all()) await input.fill("-0.95");
    // Upper triangle of a 4x4 matrix: six editable cells. Each value is measured as text against its own padding box.
    const inputs = await matrix.locator("input").evaluateAll((nodes) => nodes.map((node) => {
      const input = node as HTMLInputElement;
      const style = getComputedStyle(input);
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font-family:${style.fontFamily};font-size:${style.fontSize};font-weight:${style.fontWeight};letter-spacing:${style.letterSpacing}`;
      probe.textContent = input.value;
      document.body.appendChild(probe);
      const textWidth = probe.getBoundingClientRect().width;
      probe.remove();
      const available = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return { value: input.value, textWidth, available };
    }));
    expect(inputs).toHaveLength(6);
    for (const input of inputs) expect(input.textWidth, `input ${input.value}`).toBeLessThanOrEqual(input.available + 0.5);

    // The read-only cells (diagonal and lower triangle) must not overflow either.
    const cells = await matrix.locator("td:not(:has(input))").evaluateAll((nodes) => nodes.map((node) => ({
      text: node.textContent ?? "",
      scroll: node.scrollWidth,
      client: node.clientWidth,
    })));
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.scroll, `cell ${cell.text}`).toBeLessThanOrEqual(cell.client + 1);

    // Last, so a narrower rail shows its clipped values first and the width is pinned after them.
    const rail = (await page.getByTestId("mc-rail").boundingBox())!;
    expect(rail.width).toBeCloseTo(320, 0);
  });

  test("the rail has no Cancel: its only action is Run Correlation Analysis, and the tab never shows Run canceled", async ({ page }) => {
    await openCorrelation(page, { hold: true });
    const rail = page.getByTestId("mc-rail");
    await expect(rail.getByRole("button", { name: /cancel/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /cancel/i })).toHaveCount(0);
    await expect(rail.getByRole("button", { name: "Run Correlation Analysis" })).toHaveCount(1);
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "running");
    await expect(page.getByTestId("mc-status")).not.toHaveText("Run canceled");
    await page.evaluate(() => (window as unknown as { __mcRelease: () => void }).__mcRelease());
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
  });

  test("the detail toggle switches between the Spearman chart and the heatmap", async ({ page }) => {
    await openCorrelation(page);
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");

    const group = page.getByRole("group", { name: "Correlation detail" });
    await expect(group.getByRole("button", { name: "Spearman rho" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Spearman rho Sensitivity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Correlation Coefficient Heatmap" })).toHaveCount(0);

    await group.getByRole("button", { name: "Heatmap" }).click();
    await expect(group.getByRole("button", { name: "Heatmap" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Correlation Coefficient Heatmap" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Spearman rho Sensitivity" })).toHaveCount(0);

    await group.getByRole("button", { name: "Spearman rho" }).click();
    await expect(page.getByRole("heading", { name: "Spearman rho Sensitivity" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Correlation Coefficient Heatmap" })).toHaveCount(0);
  });

  test("each export item downloads its file; the menu is disabled before a run", async ({ page }) => {
    await openCorrelation(page);
    await expect(page.getByTestId("mc-export")).toBeDisabled();
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    const files = { frontier: "correlation_frontier.csv", sensitivity: "correlation_sensitivity.csv", heatmap: "correlation_heatmap.csv" };
    for (const [key, file] of Object.entries(files)) {
      await page.getByTestId("mc-export").click();
      const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId(`mc-export-${key}`).click()]);
      expect(download.suggestedFilename()).toBe(file);
    }
  });

  test("at 1280x720 after a run, the header and both chart frames end inside the panel, and the frontier is at least 200px tall", async ({ page }) => {
    await openCorrelation(page);
    await page.getByRole("button", { name: "Run Correlation Analysis" }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");

    const panel = (await page.getByTestId("mc-panel").boundingBox())!;
    const header = (await page.getByTestId("mc-result-header").boundingBox())!;
    expect(header.y + header.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
    for (const title of ["Efficient Frontier", "Spearman rho Sensitivity"]) {
      const frame = (await panelOf(page, title).boundingBox())!;
      expect(frame.y + frame.height, `${title} ends inside the panel`).toBeLessThanOrEqual(panel.y + panel.height + 1);
    }
    const surface = await panelOf(page, "Efficient Frontier").locator(".recharts-surface").first().boundingBox();
    expect(surface!.height).toBeGreaterThanOrEqual(200);
    const toggle = (await page.getByRole("group", { name: "Correlation detail" }).boundingBox())!;
    expect(toggle.y + toggle.height).toBeLessThanOrEqual(panel.y + panel.height + 1);

    await page.getByRole("group", { name: "Correlation detail" }).getByRole("button", { name: "Heatmap" }).click();
    const heatmap = (await panelOf(page, "Correlation Coefficient Heatmap").boundingBox())!;
    expect(heatmap.y + heatmap.height, "the heatmap ends inside the panel").toBeLessThanOrEqual(panel.y + panel.height + 1);
  });

  test("Run Correlation Analysis stays where it is while the rail scrolls", async ({ page }) => {
    await openCorrelation(page);
    const inputs = page.getByTestId("mc-rail-inputs");
    // Precondition: the asset table, matrix and slider do not fit, so there is something to scroll.
    expect(await inputs.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    const run = page.getByTestId("mc-run-correlation");
    const before = await run.boundingBox();
    await inputs.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    expect(await inputs.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect(await run.boundingBox()).toEqual(before);
    expect(before!.y + before!.height).toBeLessThanOrEqual(720);
  });
});

test.describe("failed after a result", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  const CASES = [
    ["risk", /Risk Analysis/, "VaR / CVaR Risk Distribution"],
    ["distribution", /Return Distribution/, "Return Histogram with Fitted Normal Curve"],
  ] as const;

  for (const [name, tab, title] of CASES) {
    test(`${name}: a second path run that fails keeps the first result's charts under the error notice and the failed status`, async ({ page }) => {
      await openPath(page, { path: [PATH_FIXTURE, pathError("Mock worker failure")] });
      await page.getByTestId("mc-run-path").click();
      await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
      await page.getByTestId("mc-run-path").click();
      await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "failed");

      await page.getByRole("tab", { name: tab }).click();
      await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "failed");
      await expect(page.getByTestId("mc-status")).toHaveText("Run failed");
      await expect(page.getByText("Mock worker failure")).toBeVisible();
      await expect(page.getByTestId("mc-run-prompt")).toHaveCount(0);
      // The older result is still drawn: the chart has bars, and the export menu is still enabled.
      await expect.poll(async () => (await barHeights(panelOf(page, title))).filter((h) => h > 0).length).toBeGreaterThan(0);
      await expect(page.getByTestId("mc-export")).toBeEnabled();
    });
  }
});

type TabCase = { key: string; tab: RegExp; run: string; frame: string; ownsRun: boolean };
const TAB_CASES: TabCase[] = [
  { key: "path", tab: /Path Simulation/, run: "mc-run-path", frame: "GBM + Jump-Diffusion Simulated Paths", ownsRun: true },
  { key: "risk", tab: /Risk Analysis/, run: "mc-run-path", frame: "VaR / CVaR Risk Distribution", ownsRun: false },
  { key: "distribution", tab: /Return Distribution/, run: "mc-run-path", frame: "Return Histogram with Fitted Normal Curve", ownsRun: false },
  { key: "valuation", tab: /Corporate Valuation/, run: "mc-run-valuation", frame: "Fair Value Distribution", ownsRun: true },
  { key: "correlation", tab: /Correlation Model/, run: "mc-run-correlation", frame: "Efficient Frontier", ownsRun: true },
];

test.describe("no page scroll, all tabs", () => {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    for (const stage of ["before", "after"] as const) {
      for (const c of TAB_CASES) {
        test(`${c.key} ${stage} a run at ${viewport.width}x${viewport.height} does not scroll the page`, async ({ page }) => {
          await page.setViewportSize(viewport);
          await openPath(page);
          if (stage === "after") {
            // Risk and distribution show the path run; the other tabs run on their own tab.
            if (c.key !== "path" && c.ownsRun) await page.getByRole("tab", { name: c.tab }).click();
            await page.getByTestId(c.run).click();
            await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
          }
          await page.getByRole("tab", { name: c.tab }).click();
          await expect(page.getByRole("tab", { name: c.tab })).toHaveAttribute("aria-selected", "true");
          await page.evaluate(() => document.fonts.ready);
          await expectNoPageScroll(page);

          const panel = (await page.getByTestId("mc-panel").boundingBox())!;
          const header = (await page.getByTestId("mc-result-header").boundingBox())!;
          const frame = (await panelOf(page, c.frame).boundingBox())!;
          const size = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, inner: window.innerHeight }));
          console.log(`HEIGHTS ${JSON.stringify({ tab: c.key, stage, width: viewport.width, scroll: size.scroll, inner: size.inner, panelBottom: Math.round(panel.y + panel.height), headerBottom: Math.round(header.y + header.height), frameBottom: Math.round(frame.y + frame.height) })}`);
          if (viewport.width === 1280) {
            // ONE_SCREEN_ROUTES gives the shell a 24px bottom pad (5rem otherwise), so the panel reaches 24px above the edge.
            expect(Math.round(panel.y + panel.height), "the panel ends 24px above the viewport bottom").toBe(viewport.height - 24);
            expect(header.y + header.height, "result header ends inside the panel").toBeLessThanOrEqual(panel.y + panel.height + 1);
            expect(frame.y + frame.height, "the first chart frame ends inside the panel").toBeLessThanOrEqual(panel.y + panel.height + 1);
          }
          if (process.env.DESIGN_CAPTURE) {
            await page.screenshot({
              path: `design-capture/${process.env.DESIGN_CAPTURE}/monte-carlo-${c.key}-${stage}-${viewport.width}.png`,
              animations: "disabled",
            });
          }
        });
      }
    }
  }
});

function catalogText(messages: unknown, key: string): string {
  let node = messages as Record<string, unknown>;
  for (const part of key.split(".")) node = node[part] as Record<string, unknown>;
  return node as unknown as string;
}

test.describe("Korean", () => {
  test.use({ locale: "ko-KR", viewport: { width: 1280, height: 720 } });

  // Per tab: the rail field labels, the run button and the chart titles (and the other fixed copy the tab renders).
  const KEYS: Record<string, string[]> = {
    path: [
      "monteCarlo.path.run", "monteCarlo.path.fields.initialInvestment", "monteCarlo.path.fields.expectedReturn",
      "monteCarlo.path.fields.volatility", "monteCarlo.path.fields.horizon", "monteCarlo.path.paths.title", "monteCarlo.path.cone.title",
    ],
    risk: [
      "monteCarlo.risk.view.percentiles", "monteCarlo.risk.figures.sortino",
      "monteCarlo.risk.figures.skewness", "monteCarlo.risk.var.title", "monteCarlo.risk.summary.title", "monteCarlo.shared.basedOnPath",
    ],
    distribution: [
      "monteCarlo.distribution.figures.mean", "monteCarlo.distribution.figures.std", "monteCarlo.distribution.figures.kurtosis",
      "monteCarlo.distribution.figures.max", "monteCarlo.distribution.figures.min", "monteCarlo.distribution.histogram.title",
      "monteCarlo.distribution.cdf.title", "monteCarlo.shared.basedOnPath",
    ],
    valuation: [
      "monteCarlo.valuation.run", "monteCarlo.valuation.fields.ticker", "monteCarlo.valuation.fields.currentPrice", "monteCarlo.valuation.fields.baseEps",
      "monteCarlo.valuation.fields.discountRate", "monteCarlo.valuation.fields.forecastPeriod", "monteCarlo.valuation.distribution.title",
      "monteCarlo.valuation.statistics.title",
    ],
    correlation: [
      "monteCarlo.correlation.run", "monteCarlo.correlation.matrix", "monteCarlo.correlation.simulations", "monteCarlo.correlation.figures.optimalMu",
      "monteCarlo.correlation.figures.portfolioSigma", "monteCarlo.correlation.figures.diversification", "monteCarlo.correlation.figures.optimalSharpe",
      "monteCarlo.correlation.view.sensitivity", "monteCarlo.correlation.view.heatmap", "monteCarlo.correlation.frontier.title",
    ],
  };

  for (const c of TAB_CASES) {
    test(`${c.key}: the rail labels, run button and chart titles render the Korean catalog text`, async ({ page }) => {
      await installMonteCarloWorker(page);
      await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "시뮬레이션 랩", exact: true })).toBeVisible({ timeout: 60_000 });
      // Risk and distribution have their figures only after the path run.
      if (!c.ownsRun) {
        await page.getByRole("button", { name: ko.monteCarlo.path.run }).click();
        await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
      }
      await page.getByRole("tab", { name: new RegExp(catalogText(ko, `monteCarlo.tabs.${c.key}`)) }).click();

      for (const key of KEYS[c.key]) {
        const korean = catalogText(ko, key);
        expect(korean, `${key} is Korean`).toMatch(/[가-힣]/);
        expect(korean, `${key} differs from the English text`).not.toBe(catalogText(en, key));
        await expect(page.getByTestId("mc-panel").getByText(korean).first(), key).toBeVisible();
      }
      for (const english of [en.monteCarlo.path.run, en.monteCarlo.valuation.run, en.monteCarlo.correlation.run]) {
        await expect(page.getByRole("button", { name: english, exact: true })).toHaveCount(0);
      }
    });
  }

  test("path: the named strings read 초기 투자금, 경로 시뮬레이션 실행 and 시뮬레이션 경로", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("초기 투자금")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "경로 시뮬레이션 실행" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /시뮬레이션 경로/ })).toBeVisible();
  });

  test("the input suffixes read 원, not KRW, on the path and valuation rails", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("초기 투자금")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("mc-rail-inputs")).not.toContainText("KRW");
    await expect(page.getByTestId("mc-rail-inputs")).toContainText("원");
    await page.getByRole("tab", { name: /기업가치 평가/ }).click();
    await expect(page.getByLabel(ko.monteCarlo.valuation.fields.baseEps)).toBeVisible();
    await expect(page.getByTestId("mc-rail-inputs")).not.toContainText("KRW");
    await expect(page.getByTestId("mc-rail-inputs")).toContainText("원");
  });

  test("the efficient frontier tooltip reads Korean: axis names carry no English", async ({ page }) => {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "시뮬레이션 랩", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /상관관계 모형/ }).click();
    await page.getByRole("button", { name: ko.monteCarlo.correlation.run }).click();
    await expect(page.getByTestId("mc-status")).toHaveAttribute("data-state", "ready");
    const point = panelOf(page, ko.monteCarlo.correlation.frontier.title).locator(".recharts-scatter-symbol").first();
    await expect(point).toBeVisible();
    await point.hover();
    const tooltip = page.locator(".recharts-tooltip-wrapper").first();
    await expect(tooltip).toContainText(ko.monteCarlo.correlation.frontier.axisRisk);
    await expect(tooltip).toContainText(ko.monteCarlo.correlation.frontier.axisReturn);
    await expect(tooltip).toContainText(ko.monteCarlo.correlation.frontier.axisSharpe);
    await expect(tooltip).not.toContainText(/[A-Za-z]/);
  });
});

test.describe("correlation inputs", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function openCorrelationTab(page: Page): Promise<void> {
    await installMonteCarloWorker(page);
    await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("tab", { name: /Correlation Model/i }).click();
    await expect(page.getByTestId("mc-correlation-matrix")).toBeVisible();
  }

  test("editing an upper cell updates its mirror in the lower triangle", async ({ page }) => {
    await openCorrelationTab(page);
    const matrix = page.getByTestId("mc-correlation-matrix");
    const upper = matrix.locator("input").first();
    await upper.fill("0.35");
    await expect(upper).toHaveValue("0.35");
    // Row 2, column 1 mirrors row 1, column 2 (the first upper cell); it is read-only.
    await expect(matrix.locator("tbody tr").nth(1).locator("td").first()).toHaveText("0.35");
  });

  test("a correlation outside [-1, 1] clamps to the bound, in the cell and in its mirror", async ({ page }) => {
    await openCorrelationTab(page);
    const matrix = page.getByTestId("mc-correlation-matrix");
    const upper = matrix.locator("input").first();
    const mirror = matrix.locator("tbody tr").nth(1).locator("td").first();
    await upper.fill("5");
    await expect(upper).toHaveValue("1");
    await expect(mirror).toHaveText("1.00");
    await upper.fill("-3");
    await expect(upper).toHaveValue("-1");
    await expect(mirror).toHaveText("-1.00");
  });

  test("the number of simulations stays within 500 and 5,000", async ({ page }) => {
    await openCorrelationTab(page);
    const slider = page.getByRole("slider", { name: "Number of Simulations" });
    const readout = page.getByTestId("mc-rail-inputs").getByText("Number of Simulations").locator("xpath=..").locator("span").last();
    // fill() rejects values outside the range input's bounds, so set the raw value the way a script or autofill would.
    const setSlider = (value: string) => slider.evaluate((node, next) => {
      const input = node as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await setSlider("2000");
    await expect(readout).toHaveText("2,000");
    await setSlider("999999");
    await expect(readout).toHaveText("5,000");
    await setSlider("1");
    await expect(readout).toHaveText("500");
  });
});
