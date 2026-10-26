import { expect, test, type Page } from "@playwright/test";
import { mockCasesApi } from "./helpers/casesApiMock";
import { refreshDcf } from "./helpers/corporateDcf";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { mockDetailPage } from "./helpers/detailPageMock";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { installMonteCarloWorker } from "./helpers/monteCarloWorkerMock";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel, portfolioModal } from "./helpers/portfolioPanels";
import { mockRiskRecords } from "./helpers/riskApiMock";
import { mockValuationApi } from "./helpers/valuationPageMock";

// The README screenshots (data/img/readme-*.png). Fixture data only: the repo is public, and a
// capture of a running app would publish the owner's watchlist. Run with
//   README_CAPTURE=1 npx playwright test tests/e2e/readme-capture.spec.ts
test.skip(!process.env.README_CAPTURE, "set README_CAPTURE=1 to refresh the README screenshots");
test.use({ viewport: { width: 1440, height: 810 } });

const OUT = "../../data/img";

async function shot(page: Page, name: string) {
  await page.waitForTimeout(800); // past chart and panel animations
  await page.evaluate(() => {
    // Dev-server badges (Next.js's, and any other floating dev widget) sit fixed in the bottom
    // corners; they are not part of the app a reader would see.
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      if (style.position === "fixed" && box.width < 120 && box.height < 120 && box.bottom > innerHeight - 140) {
        el.style.visibility = "hidden";
      }
    }
    document.querySelectorAll("nextjs-portal").forEach((el) => ((el as HTMLElement).style.display = "none"));
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.screenshot({ path: `${OUT}/readme-${name}.png`, animations: "disabled" });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-26T06:30:00Z"));
});

test("market overview", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await shot(page, "market");
});

test("portfolio", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await shot(page, "portfolio");
  await openPortfolioPanel(page, "snapshot");
  await shot(page, "portfolio-snapshot");
  await openPortfolioPanel(page, "holdings");
  const holding = page.locator('[role="button"]').filter({ hasText: /Inc\.|Corporation|Apple|Microsoft/ }).first();
  await holding.click();
  await expect(portfolioModal(page)).toBeVisible();
  await expect(portfolioModal(page).getByText("ROIC - WACC", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "portfolio-stock");
});

test("corporate analysis", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "networkidle" });
  await expect(page.getByTestId("fair-value-line")).toHaveAttribute("data-state", "valued", { timeout: 60_000 });
  await refreshDcf(page);
  await shot(page, "corporate");
});

test("stock detail", async ({ page }) => {
  await mockDetailPage(page, "AAPL");
  await page.goto("/detail/AAPL", { waitUntil: "networkidle" });
  await expect(page.getByTestId("tile-1w")).toBeVisible({ timeout: 60_000 });
  // Open one big move's "why it moved" card.
  await page.getByTestId("big-move-list").getByRole("button").first().click();
  await page.waitForTimeout(500);
  await shot(page, "detail");
});

test("signal records", async ({ page }) => {
  await mockRiskRecords(page);
  await page.goto("/alerts/risk/5", { waitUntil: "networkidle" });
  await expect(page.getByTestId("records-report").locator('[data-section="themes"] tbody tr').first()).toBeVisible({ timeout: 60_000 });
  await shot(page, "alerts");
});

test("valuation", async ({ page }) => {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "networkidle" });
  // The evidence panel's fixture is AEP; the fair-value block takes the same ticker.
  await page.getByLabel(/ticker/i).fill("AEP");
  await page.getByLabel(/ticker/i).press("Enter");
  await expect(page.getByTestId("fair-value")).toBeVisible({ timeout: 60_000 });
  await shot(page, "valuation");
});

test("valuation case", async ({ page }) => {
  await mockCasesApi(page);
  await page.goto("/cases/1", { waitUntil: "networkidle" });
  await expect(page.getByTestId("case-valuation")).toBeVisible({ timeout: 60_000 });
  await shot(page, "cases");
});

test("simulation lab", async ({ page }) => {
  await installMonteCarloWorker(page);
  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Run Path Simulation" }).click();
  await shot(page, "monte-carlo");
});
