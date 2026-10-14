import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";
import { lowerPanel, openLowerTab } from "./helpers/corporateDcf";

// Spec 2026-10-14 §2 and §7 tests 1-5.
const SUMMARY = {
  report_id: "verdict-1", ticker: "AAPL", estimated_value: 240.5, intrinsic_value_per_share: 240.5 as number | null,
  enterprise_value: 1462.4, equity_value: 1300.2, valuation_method: "fcff_equity_bridge", bridge_quality: "ok",
  current_price: 210.4, upside_pct: 14.31, terminal_value_share_pct: 70.71, wacc_minus_terminal_growth: null,
  terminal_growth_binding_constraint: null, status: "Undervalued", generated_at: "2026-10-14T00:00:00Z",
};

/** The SSE body the page's DCF stream reads, with one summary. */
function dcfStream(overrides: Partial<typeof SUMMARY>) {
  const summary = { ...SUMMARY, ...overrides };
  return [
    "event: phase1", `data: ${JSON.stringify({ phase: "phase1", summary })}`, "",
    "event: complete", `data: ${JSON.stringify({ phase: "complete", report_id: summary.report_id, generated_at: summary.generated_at })}`, "", "",
  ].join("\n");
}

function newStats(): CorporatePageMockStats {
  return {
    dcfRequests: 0, dcfFullReportRequests: 0, dcfBulkReportRequests: 0, comparisonRequests: 0,
    metricSaveRequests: 0, metricHistoryRequests: 0, quarterlyRequests: 0, ohlcvRequests: 0,
  };
}

async function gotoCorporate(page: Page) {
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
}

const verdict = (page: Page) => page.getByTestId("corporate-verdict");

test.describe("the verdict block", () => {
  const cases = [
    { name: "Undervalued", overrides: { status: "Undervalued", upside_pct: 14.31 }, label: "Undervalued", dir: "up", glyph: "▲", value: "+14.3%", intrinsic: "$240.5" },
    { name: "Overvalued", overrides: { status: "Overvalued", estimated_value: 190.2, intrinsic_value_per_share: 190.2, upside_pct: -9.6 }, label: "Overvalued", dir: "down", glyph: "▼", value: "-9.6%", intrinsic: "$190.2" },
    { name: "Bridge Incomplete", overrides: { status: "Bridge Incomplete", bridge_quality: "missing", intrinsic_value_per_share: null, estimated_value: 1462.4, upside_pct: 0 }, label: "Per-share value unavailable", dir: "flat", glyph: "■", value: "—", intrinsic: "—" },
    { name: "an unknown status", overrides: { status: "Fairly Valued", upside_pct: 0.4 }, label: "Fairly Valued", dir: "up", glyph: "▲", value: "+0.4%", intrinsic: "$240.5" },
  ] as const;

  for (const c of cases) {
    test(`${c.name} reads "${c.label}" with ${c.glyph} ${c.value}`, async ({ page }) => {
      await mockCorporatePageApi(page);
      await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: dcfStream(c.overrides) }));
      await gotoCorporate(page);
      await page.getByRole("button", { name: "Refresh DCF" }).click();
      await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
      await expect(verdict(page).locator('[data-part="label"]')).toContainText(c.label);
      await expect(verdict(page).locator('[data-part="intrinsic"]')).toHaveText(c.intrinsic);
      const badge = verdict(page).getByTestId("delta-badge");
      await expect(badge).toHaveAttribute("data-dir", c.dir);
      await expect(badge.locator('[aria-hidden="true"]')).toHaveText(c.glyph);
      await expect(badge.locator('[data-part="value"]')).toHaveText(c.value);
    });
  }

  test("an unbridged verdict puts the EV beside the empty per-share slot, labelled as EV", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
      status: 200, contentType: "text/event-stream",
      body: dcfStream({ status: "Bridge Incomplete", bridge_quality: "missing", intrinsic_value_per_share: null, estimated_value: 1462.4, upside_pct: 0 }),
    }));
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page).locator('[data-part="ev"]')).toHaveText("EV $1,462.4", { timeout: 30_000 });
    await expect(verdict(page).locator('[data-part="intrinsic"]')).not.toContainText("1,462.4");
  });

  test("before any DCF it says DCF not calculated, never N/A, and asks for nothing", async ({ page }) => {
    const stats = newStats();
    await mockCorporatePageApi(page, stats);
    await gotoCorporate(page);
    await expect(verdict(page)).toHaveAttribute("data-state", "idle");
    await expect(verdict(page)).toContainText("DCF not calculated");
    await expect(verdict(page)).not.toContainText("N/A");
    await expect(page.getByTestId("corporate-kpis")).not.toContainText("N/A");
    await page.waitForLoadState("networkidle");
    expect(stats.dcfRequests).toBe(0);
  });

  test("a refusal is shown inside the verdict block as content", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
      status: 422, contentType: "application/json",
      body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "Free cash flow is zero or negative over the forecast, so the model cannot value it." } }),
    }));
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "refused");
    await expect(verdict(page).getByTestId("dcf-refusal")).toContainText("zero or negative over the forecast");
  });

  test("Verdict detail opens the Intrinsic DCF calculation", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Verdict detail" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Apple Intrinsic DCF$/ })).toBeVisible();
  });
});

test("the four KPI tiles open their own details", async ({ page }) => {
  await mockCorporatePageApi(page);
  await gotoCorporate(page);
  const kpis = page.getByTestId("corporate-kpis");
  await expect(kpis.getByRole("button")).toHaveCount(4);
  for (const [tile, heading] of [
    [/^ROIC - WACC/, /ROIC - WACC Spread/],
    [/^Bottom-up Ke/, /Bottom-up Ke/],
    [/^WACC/, /Apple WACC$/],
    [/^Levered Beta/, /Apple Levered Beta/],
  ] as const) {
    await kpis.getByRole("button", { name: tile }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: heading })).toBeVisible();
    await dialog.getByRole("button", { name: "Close modal" }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test.describe("the assumption table", () => {
  test("✎ opens one row's slider at a time, and moving it saves like before", async ({ page }) => {
    const stats = newStats();
    await mockCorporatePageApi(page, stats);
    await gotoCorporate(page);
    const table = page.getByTestId("assumption-table");
    await expect(table.getByRole("slider")).toHaveCount(0);
    await table.getByRole("button", { name: "Edit Growth Rate" }).click();
    await expect(page.getByTestId("assumption-slider-growth")).toBeVisible();
    await table.getByRole("button", { name: "Edit WACC" }).click();
    await expect(page.getByTestId("assumption-slider-wacc")).toBeVisible();
    await expect(page.getByTestId("assumption-slider-growth")).toHaveCount(0);
    await expect(table.getByRole("slider")).toHaveCount(1);
    await table.getByRole("button", { name: "Edit WACC" }).click();
    await expect(table.getByRole("slider")).toHaveCount(0);

    await table.getByRole("button", { name: "Edit Growth Rate" }).click();
    await page.getByTestId("assumption-slider-growth").getByRole("slider").fill("8");
    await expect(page.getByTestId("assumption-row-growth")).toContainText("8.0%");
    await expect.poll(() => stats.metricSaveRequests).toBe(1);
  });

  test("the fixed country risk premium has no slider, and ⓘ opens a row's detail", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const table = page.getByTestId("assumption-table");
    await expect(table.getByRole("button", { name: "Edit Country Risk Premium" })).toHaveCount(0);
    await table.getByRole("button", { name: "Debt Ratio detail" }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Apple Debt Ratio/ })).toBeVisible();
  });

  test("the ⋯ menu holds the source refresh, the ROIC basis and the growth basis", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expect(page.getByRole("button", { name: "Refresh source data" })).toHaveCount(0);
    await page.getByRole("button", { name: "Assumption options" }).click();
    const menu = page.getByTestId("assumption-menu");
    await expect(menu.getByRole("button", { name: "Refresh source data" })).toBeVisible();
    await expect(menu.getByLabel("ROIC Basis")).toBeVisible();
    await expect(menu.getByText("Growth Basis")).toBeVisible();
    await expect(page.getByTestId("source-data-status")).toContainText("Source data stays idle on first load until refreshed.");
  });
});

test.describe("the ⋯ menu and the busy verdict", () => {
  test("Escape closes the ⋯ menu and returns focus to its toggle", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const toggle = page.getByRole("button", { name: "Assumption options" });
    await toggle.click();
    await expect(page.getByTestId("assumption-menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("assumption-menu")).toHaveCount(0);
    await expect(toggle).toBeFocused();
  });

  test("a press outside the ⋯ menu closes it", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Assumption options" }).click();
    await expect(page.getByTestId("assumption-menu")).toBeVisible();
    await verdict(page).click({ position: { x: 20, y: 20 } });
    await expect(page.getByTestId("assumption-menu")).toHaveCount(0);
  });

  test("a refresh over a cached DCF keeps the cached verdict and shows it is calculating", async ({ page }) => {
    // The shared mock's stream writes the session cache (phase 2); a phase-1-only body would not.
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });

    // Hold the next stream until the test releases it, so the cached verdict is on screen while it runs.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: dcfStream({}) });
    });
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-busy", "true");
    await expect(verdict(page).locator('[data-part="busy"]')).toHaveText("Calculating…");
    await expect(verdict(page).locator('[data-part="intrinsic"]')).toHaveText("$240.5");
    release();
    await expect(verdict(page)).not.toHaveAttribute("data-busy", "true", { timeout: 30_000 });
  });
});

test.describe("the lower tabs", () => {
  test("diagnostics is the default, each tab mounts only its own content, and the choice survives leaving the page", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const tabs = page.getByTestId("corporate-lower-tabs");
    await expect(tabs.getByRole("tab", { name: "Core Diagnostics" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByText("Hurdle Rate Decomposition", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("DCF Core Modules")).toHaveCount(0);
    await openLowerTab(page, "DCF");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
    await expect(page.getByText("Hurdle Rate Decomposition", { exact: true })).toHaveCount(0);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await gotoCorporate(page);
    await expect(tabs.getByRole("tab", { name: "DCF" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
  });

  test("an unknown stored tab falls back to diagnostics", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("moneyview.tab.corporate.lowerTab", JSON.stringify("bogus")));
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expect(page.getByTestId("corporate-lower-tabs").getByRole("tab", { name: "Core Diagnostics" })).toHaveAttribute("aria-selected", "true");
  });

  test("the DCF tab loads the full report only on request, in place, and shows the sensitivity grid", async ({ page }) => {
    const stats = newStats();
    await mockCorporatePageApi(page, stats);
    await gotoCorporate(page);
    // CalculationDetailModal is a next/dynamic chunk: open and close one detail first so that a
    // modal opened below mounts at once, and the no-dialog check does not race its compile.
    const kpis = page.getByTestId("corporate-kpis");
    await kpis.getByRole("button", { name: /^ROIC - WACC/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Close modal" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await openLowerTab(page, "DCF");
    await page.waitForLoadState("networkidle");
    expect(stats.dcfFullReportRequests).toBe(0);
    await lowerPanel(page).getByRole("button", { name: "Load Full Report" }).click();
    await expect(lowerPanel(page).getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 });
    expect(stats.dcfFullReportRequests).toBe(1);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the comparison tab is a toolbar, one status line and a scrolling table", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await openLowerTab(page, "Target Stock Comparison");
    await expect(lowerPanel(page).getByText("Comparison stays idle on first load.")).toBeVisible();
    const toolbar = page.getByTestId("comparison-toolbar");
    await expect(toolbar.getByRole("button", { name: "Calculate All DCF Reports" })).toBeDisabled();
    await toolbar.getByRole("button", { name: "Refresh comparison" }).click();
    const status = page.getByTestId("comparison-status");
    await expect(status).toContainText(/Watchlist \d+\/\d+ synced/);
    await expect(status).toContainText("Benchmark: ^GSPC.");
    const scroll = page.getByTestId("comparison-table-scroll");
    await expect(scroll.getByRole("cell", { name: "GOOGL" }).first()).toBeVisible({ timeout: 30_000 });
    expect(await scroll.evaluate((element) => getComputedStyle(element).overflowY)).toBe("auto");
    await expect(toolbar.getByRole("button", { name: "Calculate All DCF Reports" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /Calculate All/ })).toHaveCount(1);
  });

  test("the comparison table header stays at the top of its own scroll box", async ({ page }) => {
    await mockCorporatePageApi(page);
    // The mock's watchlist has only a few rows; add enough that the table box must scroll.
    await page.route((url) => url.pathname === "/api/v1/corporate/comparison", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const rows = body.data.rows;
      const filler = Array.from({ length: 14 }, (_, i) => ({ ...rows[0], ticker: `FILL${i}`, group_name: "stock" }));
      await route.fulfill({ response, json: { ...body, data: { ...body.data, rows: [...rows, ...filler] } } });
    });
    await gotoCorporate(page);
    await openLowerTab(page, "Target Stock Comparison");
    await page.getByTestId("comparison-toolbar").getByRole("button", { name: "Refresh comparison" }).click();
    const box = page.getByTestId("comparison-table-scroll");
    await expect(box.getByRole("cell", { name: "FILL13" })).toBeAttached({ timeout: 30_000 });
    expect(await box.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const boxTop = (await box.boundingBox())!.y;
    const rowBefore = (await box.locator("tbody tr").first().boundingBox())!.y;
    await box.evaluate((element) => { element.scrollTop = 200; });
    expect(await box.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(Math.abs((await box.locator("thead").boundingBox())!.y - boxTop)).toBeLessThan(1);
    expect((await box.locator("tbody tr").first().boundingBox())!.y).toBeLessThan(rowBefore);
  });
});
