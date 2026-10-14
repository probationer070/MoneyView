import { expect, test, type Locator, type Page } from "@playwright/test";
import { mockCorporatePageApi, type CorporatePageMockStats } from "./helpers/corporatePageMock";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { loadFullDcfReportInTab, lowerPanel, openDetailTab, openLowerTab, refreshDcf } from "./helpers/corporateDcf";

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

test.describe("the page tabs", () => {
  test("Summary is the default, each tab mounts only its own content, and the choice survives leaving the page", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const tabs = page.getByTestId("corporate-page-tabs");
    await expect(tabs.getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    // Prefixed ids: the detail modal's own Summary tab (Task 8) must not share an id with this one.
    await expect(page.locator("#corporate-tab-summary")).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page)).toHaveAttribute("aria-labelledby", "corporate-tab-summary");
    await expect(lowerPanel(page).getByTestId("corporate-verdict")).toBeVisible();
    await expect(page.getByText("Hurdle Rate Decomposition", { exact: true })).toHaveCount(0);
    await openLowerTab(page, "DCF");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
    await expect(page.getByTestId("corporate-verdict")).toHaveCount(0);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await gotoCorporate(page);
    await expect(tabs.getByRole("tab", { name: "DCF" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByText("DCF Core Modules").first()).toBeVisible();
  });

  test("an unknown stored tab falls back to Summary", async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem("moneyview.tab.corporate.pageTab", JSON.stringify("bogus")));
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    // The restore runs in an effect after hydration; let it run before reading the selection.
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Summary" })).toHaveAttribute("aria-selected", "true");
    await expect(lowerPanel(page).getByTestId("corporate-verdict")).toBeVisible();
  });

  test("a pre-D10 lower-tab choice is carried over, and the old key is dropped", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    // An older session: only the lower-tab key, written before the page had page tabs. Seeded once,
    // not via addInitScript, which would re-seed on the reload.
    await page.evaluate(() => {
      window.sessionStorage.removeItem("moneyview.tab.corporate.pageTab");
      window.sessionStorage.setItem("moneyview.tab.corporate.lowerTab", JSON.stringify("comparison"));
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "Target Stock Comparison" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem("moneyview.tab.corporate.lowerTab"))).toBeNull();
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
// Spec §2A: the document never scrolls; overflow belongs to the tab panel. Sideways is checked too,
// because both 390 px regressions (ERROR-LOG 2026-10-14) widened the page rather than lengthening it.
async function expectNoPageScroll(page: Page, where: string) {
  const size = await page.evaluate(() => ({
    height: document.scrollingElement!.scrollHeight,
    innerHeight: window.innerHeight,
    width: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(size.height, `${where}: the page does not scroll`).toBeLessThanOrEqual(size.innerHeight);
  expect(size.width, `${where}: the page is not wider than the viewport`).toBeLessThanOrEqual(size.clientWidth + 1);
}

test.describe("at 1280x720", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // Spec §2A and §7 test 1. The header, the verdict strip and the tab bar end inside 720px. The Summary
  // blocks end inside the Summary panel, so the answer needs neither a page scroll nor a panel scroll.
  async function expectSummaryFits(page: Page) {
    const panel = await lowerPanel(page).boundingBox();
    expect(panel, "the Summary panel is rendered").not.toBeNull();
    const panelBottom = panel!.y + panel!.height;
    const blocks: [string, Locator, number][] = [
      // The eyebrow sits above the title and is the header's top edge: the title alone can clear
      // the bar on a lower top padding, because the eyebrow pushes it down.
      ["header eyebrow", page.getByRole("heading", { name: /Corporate Analysis/i }).locator("xpath=preceding-sibling::div[1]"), 720],
      ["title", page.getByRole("heading", { name: /Corporate Analysis/i }), 720],
      ["company line", page.getByTestId("corporate-company-line"), 720],
      ["verdict strip", page.getByTestId("corporate-verdict-strip"), 720],
      ["tab bar", page.getByRole("tablist", { name: "Corporate analysis sections" }), 720],
      ["verdict", page.getByTestId("corporate-verdict"), panelBottom],
      ["KPI row", page.getByTestId("corporate-kpis"), panelBottom],
      ["assumption table", page.getByTestId("assumption-table"), panelBottom],
    ];
    for (const [name, locator, bottom] of blocks) {
      const box = await locator.boundingBox();
      expect(box, `${name} is rendered`).not.toBeNull();
      expect(box!.y, `${name} starts below the 48px bar`).toBeGreaterThanOrEqual(48);
      expect(box!.y + box!.height, `${name} ends by ${Math.round(bottom)}px`).toBeLessThanOrEqual(bottom);
    }
    await expect(page.getByTestId("corporate-kpis").getByRole("button")).toHaveCount(4);
    const scroll = await page.getByTestId("assumption-scroll").boundingBox();
    expect(scroll!.height, "the assumption table scrolls inside its 288px budget").toBeLessThanOrEqual(288);
    await expectNoPageScroll(page, "Summary");
  }

  test("header, strip, tab bar and the whole Summary tab fit with no scroll of any kind", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await expectSummaryFits(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await expectSummaryFits(page);
    await page.getByTestId("assumption-table").getByRole("button", { name: "Edit WACC" }).click();
    await expect(page.getByTestId("assumption-slider-wacc")).toBeVisible();
    await expectSummaryFits(page);
  });
});

test.describe("the header row", () => {
  test("a company not in the list is added from the search's last entry", async ({ page }) => {
    await mockCorporatePageApi(page);
    let posted: unknown = null;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/companies")) posted = request.postDataJSON();
    });
    await gotoCorporate(page);
    await expect(page.getByTestId("add-company-form")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add for Analysis" })).toHaveCount(0);
    await page.getByLabel("Company Search").fill("zzzq");
    await page.getByRole("option", { name: "Not in the list → add" }).click();
    const form = page.getByTestId("add-company-form");
    await expect(form.getByLabel("Symbol")).toHaveValue("ZZZQ");
    await form.getByLabel("Company name").fill("Zed Quartz");
    await form.getByRole("button", { name: "Add for Analysis" }).click();
    await expect.poll(() => posted).toEqual({ ticker: "ZZZQ", name: "Zed Quartz", source: "manual" });
    await expect(page.getByTestId("corporate-company-line")).toContainText("Zed Quartz");
    await expect(form).toHaveCount(0);
  });

  test("the keyboard reaches the add form from the search, with focus in its first field", async ({ page }) => {
    await mockCorporatePageApi(page);
    let posted: unknown = null;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/companies")) posted = request.postDataJSON();
    });
    await gotoCorporate(page);
    const search = page.getByLabel("Company Search");
    await search.fill("zzzq");
    await search.press("Enter");
    const form = page.getByTestId("add-company-form");
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Symbol")).toHaveValue("ZZZQ");
    await expect(form.getByLabel("Company name")).toBeFocused();
    await page.keyboard.type("Zed Quartz");
    await page.keyboard.press("Enter");
    await expect.poll(() => posted).toEqual({ ticker: "ZZZQ", name: "Zed Quartz", source: "manual" });
    await expect(page.getByTestId("corporate-company-line")).toContainText("Zed Quartz");
    await expect(form).toHaveCount(0);
  });

  test("a listed match never offers the add entry", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByLabel("Company Search").fill("Micro");
    await expect(page.getByRole("option", { name: /Microsoft/ })).toBeVisible();
    await expect(page.getByRole("option", { name: "Not in the list → add" })).toHaveCount(0);
  });

  test("the page has one way to the full report and no idle sentence", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "View Full Report" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Intrinsic DCF/ })).toHaveCount(0);
    await expect(page.getByText("DCF stays idle on first load until you refresh it.")).toHaveCount(0);
    await expect(page.getByTestId("dcf-updated")).toContainText("Last updated");
    await expect(page.getByTestId("corporate-company-line")).toHaveText(/^Apple · .+ · \$210\.4$/);
    await expect(page.getByTestId("corporate-company-line").locator("span.type-mono")).toHaveText("$210.4");
    await expect(page.getByTestId("dcf-updated")).toHaveClass(/type-mono/);
  });
});

test.describe("in Korean", () => {
  test.use({ locale: "ko-KR" });

  test("title, verdict, a figure and a bilingual header read in Korean", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "기업 분석" })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("corporate-verdict")).toContainText("DCF 미계산");
    await expect(page.getByTestId("corporate-kpis")).toContainText("10.0%");
    await expect(page.getByRole("columnheader", { name: "항목", exact: true })).toBeVisible();
    await expect(page.getByTestId("corporate-page-tabs").getByRole("tab", { name: "종목 비교" })).toBeVisible();
  });
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test.describe(`at ${viewport.width}x${viewport.height}, on every page tab`, () => {
    test.use({ viewport });

    test("the page never scrolls; the panel takes the overflow", async ({ page }) => {
      await mockCorporatePageApi(page);
      await gotoCorporate(page);
      await refreshDcf(page);
      await expectNoPageScroll(page, "Summary");
      await openLowerTab(page, "Core Diagnostics");
      await expect(lowerPanel(page).getByText("Hurdle Rate Decomposition", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expectNoPageScroll(page, "Core Diagnostics");
      const report = await loadFullDcfReportInTab(page);
      await expect(report.getByText("WACC x Terminal Growth Sensitivity")).toBeVisible({ timeout: 30_000 });
      await expectNoPageScroll(page, "DCF");
      await openLowerTab(page, "Target Stock Comparison");
      await lowerPanel(page).getByRole("button", { name: "Refresh comparison" }).click();
      await expect(lowerPanel(page).getByText("Price Vs Fair Value Map")).toBeVisible({ timeout: 30_000 });
      await expectNoPageScroll(page, "Target Stock Comparison");
      // The comparison tab is taller than its panel at both sizes: the panel, not the page, scrolls.
      const panel = await lowerPanel(page).evaluate((element) => ({
        overflows: element.scrollHeight > element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
      }));
      expect(panel).toEqual({ overflows: true, overflowY: "auto" });
    });
  });
}

test.describe("the verdict strip", () => {
  const strip = (page: Page) => page.getByTestId("corporate-verdict-strip");

  const valuedCases = [
    { name: "a bridged valuation", overrides: {}, intrinsic: "$240.5", dir: "up", value: "+14.3%", label: "Undervalued" },
    {
      name: "an unbridged valuation",
      overrides: { status: "Bridge Incomplete", bridge_quality: "missing", intrinsic_value_per_share: null, estimated_value: 1462.4, upside_pct: 0 },
      intrinsic: "—", dir: "flat", value: "—", label: "Per-share value unavailable",
    },
  ] as const;

  for (const c of valuedCases) {
    test(`${c.name}: the strip shows what the Summary block shows`, async ({ page }) => {
      await mockCorporatePageApi(page);
      await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) =>
        route.fulfill({ status: 200, contentType: "text/event-stream", body: dcfStream(c.overrides) }));
      await gotoCorporate(page);
      await page.getByRole("button", { name: "Refresh DCF" }).click();
      for (const target of [verdict(page), strip(page)]) {
        await expect(target).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
        await expect(target.locator('[data-part="intrinsic"]')).toHaveText(c.intrinsic);
        await expect(target.getByTestId("delta-badge")).toHaveAttribute("data-dir", c.dir);
        await expect(target.getByTestId("delta-badge").locator('[data-part="value"]')).toHaveText(c.value);
        await expect(target.locator('[data-part="label"]')).toContainText(c.label);
      }
      await expect(strip(page)).not.toContainText("1,462.4");
    });
  }

  test("idle and refused: the strip carries the block's state and never a number", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
      status: 422, contentType: "application/json",
      body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "Free cash flow is zero or negative over the forecast, so the model cannot value it." } }),
    }));
    await gotoCorporate(page);
    await expect(verdict(page)).toHaveAttribute("data-state", "idle");
    await expect(strip(page)).toHaveAttribute("data-state", "idle");
    await expect(strip(page)).toHaveText("DCF not calculated");
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "refused");
    await expect(strip(page)).toHaveAttribute("data-state", "refused");
    await expect(strip(page)).toContainText("Not valued");
    await expect(strip(page)).toHaveAttribute("title", /zero or negative over the forecast/);
    await expect(strip(page)).not.toContainText("$");
  });

  test("every page tab shows the strip, and it opens the Intrinsic DCF detail", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await refreshDcf(page);
    for (const tab of ["Core Diagnostics", "DCF", "Target Stock Comparison", "Summary"] as const) {
      await openLowerTab(page, tab);
      await expect(strip(page), tab).toBeVisible();
      await expect(strip(page).locator('[data-part="intrinsic"]'), tab).toHaveText("$240.5");
      await expect(strip(page).locator('[data-part="label"]'), tab).toContainText("Undervalued");
    }
    await openLowerTab(page, "DCF");
    await strip(page).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: /Apple Intrinsic DCF$/ })).toBeVisible();
  });
});

// Spec §2A (D10): a one-screen page leaves 24px under its panel, and every other page keeps the 80px pad.
test.describe("the bottom pad", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("corporate leaves 24px under the panel, and portfolio keeps 80px", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    const panel = await lowerPanel(page).boundingBox();
    expect(panel, "the tab panel is rendered").not.toBeNull();
    expect(720 - (panel!.y + panel!.height), "the gap under the panel").toBeLessThanOrEqual(24 + 1);
    await mockPortfolioPageApi(page);
    await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeAttached({ timeout: 60_000 });
    expect(await page.locator("main").evaluate((element) => getComputedStyle(element).paddingBottom)).toBe("80px");
  });
});

test.describe("the verdict strip cues", () => {
  test("a strip over other tickers' cached source data says so, and its title gives the full message", async ({ page }) => {
    await mockCorporatePageApi(page);
    await page.addInitScript(() => {
      window.sessionStorage.setItem("moneyview:corporate-active-ticker:v1", JSON.stringify("MSFT"));
      window.sessionStorage.setItem("moneyview:corporate-metric-history-cache:v1", JSON.stringify({
        snapshot: "AAPL",
        result: {
          ticker: "AAPL", start_year: 2021, country_risk_premium: 0.8, growth_cagr: 5.5, growth_recent_average: 5.2,
          annual_growth_rates: [{ year: 2025, value: 5.3 }], roic_recent_average: 17.8, roic_all_year_average: 17.1,
          annual_roic: [{ year: 2025, value: 17.5 }],
        },
        lastUpdatedAt: "2026-04-10T10:00:00Z",
      }));
    });
    await gotoCorporate(page);
    const stale = page.getByTestId("corporate-verdict-strip").locator('[data-part="stale"]');
    await expect(stale).toContainText("Stale source");
    await expect(stale).toHaveAttribute("title", "Cached source data is for AAPL. Refresh for MSFT.");
  });

  test("a strip over a cached value carries data-busy while a refresh runs", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(verdict(page)).toHaveAttribute("data-state", "valued", { timeout: 30_000 });

    // Hold the next stream until the test releases it, so the cached value is on the strip while it runs.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/v1/corporate/dcf/AAPL/stream", async (route) => {
      await gate;
      await route.fulfill({ status: 200, contentType: "text/event-stream", body: dcfStream({}) });
    });
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    const strip = page.getByTestId("corporate-verdict-strip");
    await expect(strip).toHaveAttribute("data-busy", "true");
    await expect(strip).toHaveAttribute("data-state", "valued");
    release();
    await expect(strip).not.toHaveAttribute("data-busy", "true", { timeout: 30_000 });
  });
});

test.describe("the DCF uses the inputs on screen", () => {
  // The hydrated values the held metrics response carries. They differ from the seed.
  const HYDRATED = { esg_penalty: 41, fcff: 150, reinvestment: 60 };

  // The page boots on a running clock; the clock is paused once it is up and before the held metrics are
  // released. The 250 ms debounce in page.tsx then cannot fire, so only a read of the assumptions made at
  // click time can reach a request. The hydration lands inside the debounce window.
  async function openWithHydrationHeld(page: Page) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await mockCorporatePageApi(page, undefined, { holdAaplMetrics: held, aaplMetricsPatch: HYDRATED });
    await page.clock.install({ time: new Date("2026-10-15T00:00:00Z") });
    await gotoCorporate(page);
    // The first open of the detail modal loads its chunk, which a paused clock stalls. Open and close it now.
    await page.getByTestId("assumption-table").getByRole("button", { name: "WACC detail" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close modal" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const pageNow = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(pageNow + 1000);
    release();
    await expect(page.getByTestId("assumption-row-esgPenalty")).toContainText("41.0");
    await expect(page.getByTestId("assumption-row-reinvestment")).toContainText("60.0%");
  }

  test("Refresh DCF sends the hydrated inputs on screen, not a copy from before hydration", async ({ page }) => {
    await openWithHydrationHeld(page);
    const stream = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/dcf/AAPL/stream"));
    await page.getByRole("button", { name: "Refresh DCF" }).click();
    const body = (await stream).postDataJSON() as Record<string, number>;
    expect({ esg_penalty: body.esg_penalty, fcff: body.fcff, reinvestment: body.reinvestment }).toEqual(HYDRATED);
  });

  test("Sensitivity Calculate sends the hydrated inputs on screen too", async ({ page }) => {
    const bodies: Record<string, number>[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/corporate/dcf/AAPL")) bodies.push(request.postDataJSON());
    });
    await openWithHydrationHeld(page);
    await page.getByTestId("assumption-table").getByRole("button", { name: "WACC detail" }).click();
    const dialog = page.getByRole("dialog");
    await openDetailTab(dialog, "Sensitivity");
    await dialog.getByRole("button", { name: "Calculate", exact: true }).click();
    await expect(dialog.getByTestId("sensitivity-row-up")).toContainText("$240.5");
    expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      expect({ esg_penalty: body.esg_penalty, fcff: body.fcff, reinvestment: body.reinvestment }).toEqual(HYDRATED);
    }
  });

  test("the sensitivity Current row shows a dash while the page's DCF is stale", async ({ page }) => {
    await mockCorporatePageApi(page);
    await gotoCorporate(page);
    await refreshDcf(page);
    await page.getByTestId("assumption-table").getByRole("button", { name: "WACC detail" }).click();
    const dialog = page.getByRole("dialog");
    await openDetailTab(dialog, "Sensitivity");
    await expect(dialog.getByTestId("sensitivity-row-current").getByRole("cell").nth(2)).toHaveText("$240.50");

    await dialog.getByRole("button", { name: "Close modal" }).click();
    await page.getByTestId("assumption-table").getByRole("button", { name: "Edit WACC" }).click();
    await page.getByTestId("assumption-slider-wacc").getByRole("slider").press("Home");
    await expect(page.getByText("Stale", { exact: true }).first()).toBeVisible();
    await page.getByTestId("assumption-table").getByRole("button", { name: "WACC detail" }).click();
    await openDetailTab(dialog, "Sensitivity");
    await expect(dialog.getByTestId("sensitivity-row-current").getByRole("cell").nth(2)).toHaveText("—");
  });
});
