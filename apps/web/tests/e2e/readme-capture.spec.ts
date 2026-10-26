import { expect, test, type Page } from "@playwright/test";
import { mockCasesApi } from "./helpers/casesApiMock";
import { openLowerTab, refreshDcf } from "./helpers/corporateDcf";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";
import { mockEventsApi } from "./helpers/eventsApiMock";
import { json } from "./helpers/mockUtils";
import { mockSignalsApi } from "./helpers/signalsApiMock";
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

// ---- every tab ---------------------------------------------------------------------------

function spread(id: string, label: string, numerator: string, drift: number, wave: number) {
  // A smooth, deterministic 60-point relative-strength line indexed to 100.
  const series = Array.from({ length: 60 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 6, 28) + i * 86_400_000).toISOString().slice(0, 10);
    return { date: day, value: Number((100 + drift * i + wave * Math.sin(i / 6)).toFixed(2)) };
  });
  return {
    id, label, numerator, denominator: "^GSPC", requested_window_days: 90,
    actual_window_start: series[0].date, actual_window_end: series[59].date, actual_window_days: 88, observations: 60,
    basis: `(${numerator}_t / ${numerator}_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at ${series[0].date}`,
    series, latest: series[59].value, refused_reason: null,
  };
}

test("market spreads tab", async ({ page }) => {
  await mockMarketPageApi(page);
  const rows = [spread("semis", "Semiconductors", "SOXX", 0.12, 2.5), spread("cloud", "Cloud", "SKYY", -0.05, 1.8),
    spread("ai", "AI", "BOTZ", 0.06, 3.2), spread("energy", "Energy", "XLE", -0.09, 1.2)];
  await page.route("**/api/v1/market/spreads**", (route) => json(route, rows));
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Spreads" }).click();
  await shot(page, "market-spreads");
});

test("portfolio panels", async ({ page }) => {
  await mockPortfolioPageApi(page);
  await page.goto("/portfolio", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  for (const panel of ["attribution", "allocation", "holdings"] as const) {
    await openPortfolioPanel(page, panel);
    await shot(page, `portfolio-${panel}`);
  }
});

test("news", async ({ page }) => {
  const headlines = [
    ["AAPL", "Apple widens its services lineup ahead of the holiday quarter"],
    ["MSFT", "Microsoft cloud revenue beats estimates on AI demand"],
    ["NVDA", "Nvidia ships its next data-center platform to the first customers"],
    ["AMZN", "Amazon expands same-day delivery to twelve more cities"],
    ["GOOGL", "Alphabet's search ads hold steady as AI answers roll out"],
    ["TSLA", "Tesla's quarterly deliveries edge past analyst forecasts"],
  ];
  await page.route(/\/api\/v1\/news\/feed(\?|$)/, (route) => json(route, headlines.map(([ticker, headline], index) => ({
    id: index + 1, ticker, headline, url: `https://example.com/news/${index + 1}`, source: "Sample Wire",
    published_date: "2026-10-26", published_at: `2026-10-26T0${index}:15:00Z`, sentiment: "neutral", importance: 1,
  }))));
  await page.goto("/news", { waitUntil: "networkidle" });
  await shot(page, "news");
});

test("corporate tabs", async ({ page }) => {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "networkidle" });
  await refreshDcf(page);
  for (const [tab, name] of [["Core Diagnostics", "diagnostics"], ["DCF", "dcf"], ["Target Stock Comparison", "comparison"]] as const) {
    await openLowerTab(page, tab);
    if (tab === "DCF") {
      await page.getByTestId("corporate-page-tabs").getByRole("tabpanel").getByRole("button", { name: "Load Full Report" }).click();
      await page.waitForTimeout(1000);
    }
    await shot(page, `corporate-${name}`);
  }
});

test("simulation lab tabs", async ({ page }) => {
  await installMonteCarloWorker(page);
  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Run Path Simulation" }).click();
  for (const [tab, name] of [[/Risk Analysis/i, "risk"], [/Return Distribution/i, "distribution"], [/Corporate Valuation/i, "valuation"], [/Correlation Model/i, "correlation"]] as const) {
    await page.getByRole("tab", { name: tab }).click();
    // A tab with its own run button shows its result rather than an empty chart.
    const run = page.getByRole("button", { name: /^Run /i }).first();
    if (await run.isVisible().catch(() => false)) await run.click();
    await shot(page, `monte-carlo-${name}`);
  }
});

test("decisions, cases list, events and macro signals", async ({ page }) => {
  await mockDecisionsApi(page);
  await page.goto("/decisions", { waitUntil: "networkidle" });
  await shot(page, "decisions");
  await mockCasesApi(page);
  await page.goto("/cases", { waitUntil: "networkidle" });
  await shot(page, "cases-list");
  await mockMarketPageApi(page);
  await mockEventsApi(page);
  await page.goto("/events", { waitUntil: "networkidle" });
  await shot(page, "events");
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "networkidle" });
  await shot(page, "signals");
});
