import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";
import { mockPortfolioPageApi, type PortfolioPageMockStats } from "./helpers/portfolioPageMock";
import { openPortfolioPanel } from "./helpers/portfolioPanels";

function corporateStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0,
    dcfFullReportRequests: 0,
    dcfBulkReportRequests: 0,
    comparisonRequests: 0,
    metricSaveRequests: 0,
    metricHistoryRequests: 0,
    quarterlyRequests: 0,
    ohlcvRequests: 0,
  };
}

function portfolioStats(): PortfolioPageMockStats {
  return {
    comparisonRequests: 0,
    comparisonHistoryRequests: 0,
    attributionRequests: 0,
    stockDetailRequests: 0,
    stockSnapshotHistoryRequests: 0,
  };
}

async function expectNoPageHorizontalOverflow(page: Page) {
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))
    .toBeTruthy();
}

async function expectScrollRegionContained(region: Locator) {
  const dimensions = await region.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.clientWidth).toBeGreaterThan(0);
  expect(dimensions.scrollWidth).toBeGreaterThanOrEqual(dimensions.clientWidth);
}

async function expectChartPanelRendered(page: Page, title: string) {
  const titleNode = page.getByText(title, { exact: true }).first();
  await expect(titleNode).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => titleNode.evaluate((element) => {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const hasRenderedChartSvg = Array.from(current.querySelectorAll("svg")).some((svg) => {
          const rect = svg.getBoundingClientRect();
          const style = window.getComputedStyle(svg);
          return rect.width > 20 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
        });
        if (hasRenderedChartSvg) return true;
        current = current.parentElement;
      }
      return false;
    }))
    .toBeTruthy();
}

test("portfolio analysis and holdings render state survives view and viewport changes", async ({ page }) => {
  const stats = portfolioStats();
  await mockPortfolioPageApi(page, stats);

  await page.setViewportSize({ width: 1366, height: 960 });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await openPortfolioPanel(page, "snapshot");
  await expect(page.getByText("Latest Snapshot Summary").first()).toBeVisible();
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await expect.poll(() => stats.comparisonRequests).toBe(2);
  await expect.poll(() => stats.comparisonHistoryRequests).toBe(1);
  await expect.poll(() => stats.attributionRequests).toBe(1);

  await openPortfolioPanel(page, "attribution");
  await expect(page.getByText("Portfolio Return")).toBeVisible();
  await expectChartPanelRendered(page, "Sector Allocation");
  await expectChartPanelRendered(page, "Attribution Effects (%)");

  await openPortfolioPanel(page, "snapshot");
  await page.getByLabel("Portfolio comparison source").selectOption("live");
  await page.getByLabel("Portfolio comparison universe").selectOption("custom");
  await page.getByLabel("Portfolio benchmark ticker").fill("^IXIC");
  await page.getByLabel("Portfolio custom tickers").fill("NVDA, TSLA");

  await openPortfolioPanel(page, "holdings");
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await openPortfolioPanel(page, "allocation");
  await expect(page.getByLabel("Portfolio table scroll region")).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Allocation", exact: true })).toBeVisible();
  await openPortfolioPanel(page, "holdings");
  await page.getByRole("button", { name: "Graph" }).click();
  await expect(page.getByText("Technology").first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Table", exact: true, pressed: true })).toBeVisible();
  await openPortfolioPanel(page, "snapshot");
  await expect(page.getByLabel("Portfolio comparison source")).toHaveValue("live");
  await expect(page.getByLabel("Portfolio comparison universe")).toHaveValue("custom");
  await expect(page.getByLabel("Portfolio benchmark ticker")).toHaveValue("^IXIC");
  await expect(page.getByLabel("Portfolio custom tickers")).toHaveValue("NVDA, TSLA");
  await openPortfolioPanel(page, "allocation");
  // The panel header repeats the section title, so anchor on the first match.
  await page.getByRole("heading", { name: "Portfolio Allocation Workspace" }).first().scrollIntoViewIfNeeded();
  await expect(page.getByText("Stock Search Panel")).toBeVisible();
  await expectScrollRegionContained(page.getByLabel("Portfolio table scroll region"));
});

test("corporate diagnostics and comparison chart panels stay rendered after dense state changes", async ({ page }) => {
  const stats = corporateStats();
  await mockCorporatePageApi(page, stats);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  await expectChartPanelRendered(page, "Company Status Diagnosis");
  await page.getByLabel("Include subjective Innovation, Governance, and ESG/Agency inputs").check();
  await page.getByRole("button", { name: "Refresh DCF" }).click();
  await expect.poll(() => stats.dcfRequests).toBe(1);
  await page.getByLabel("Comparison universe").selectOption("custom");
  await page.getByLabel("Custom tickers").fill("NVDA, TSLA");
  await page.getByLabel("Sort by").selectOption("roic_minus_wacc");
  await page.getByLabel("Direction").selectOption("asc");
  await page.getByRole("button", { name: "Refresh comparison" }).click();
  await expect.poll(() => stats.comparisonRequests).toBe(1);
  await expect(page.locator("div").filter({ hasText: /^Custom Universe$/ }).first()).toBeVisible();
  await expectChartPanelRendered(page, "Similar Stocks Spread View");
  await expectChartPanelRendered(page, "Price Vs Fair Value Map");
  await expect(page.getByRole("cell", { name: "NVDA" }).first()).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("Comparison universe")).toHaveValue("custom");
  await expect(page.getByLabel("Custom tickers")).toHaveValue("NVDA, TSLA");
  await expect(page.getByLabel("Sort by")).toHaveValue("roic_minus_wacc");
  await expect(page.getByLabel("Direction")).toHaveValue("asc");
  await page.getByText("Similar Stocks Spread View").scrollIntoViewIfNeeded();
  await expectChartPanelRendered(page, "Similar Stocks Spread View");
  await expectNoPageHorizontalOverflow(page);
});
