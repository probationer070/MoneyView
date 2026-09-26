import { expect, test, type Page } from "@playwright/test";
import { DIFF_RESULT, PRICING_RESULT, SIMULATE_RESULT, SIMULATE_SUPPRESSED, mockCasesApi } from "./helpers/casesApiMock";
import { mockValuationApi } from "./helpers/valuationPageMock";

async function gotoCases(page: Page, query = "") {
  await page.goto(`/cases${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /^Cases$/ })).toBeVisible({ timeout: 60_000 });
}

test.describe("the cases list", () => {
  test("the sidebar links to it and it lists every stored case with its parent", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCases(page);
    await expect(page.getByRole("link", { name: "Cases", exact: true })).toBeVisible();
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(3);
    const fork = page.getByTestId("case-row-2");
    await expect(fork.getByRole("link", { name: "AAPL higher margin" })).toHaveAttribute("href", "/cases/2");
    await expect(fork.getByRole("link", { name: "conservative_AAPL_2026-01-01" })).toHaveAttribute("href", "/cases/1");
  });

  test("?ticker= presets the filter and hides other tickers", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCases(page, "?ticker=MSFT");
    await expect(page.getByLabel("Ticker filter")).toHaveValue("MSFT");
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(1);
    await expect(page.getByTestId("case-row-3")).toBeVisible();
  });

  test("an empty store says so, and does not point at a generator that does not exist", async ({ page }) => {
    await mockCasesApi(page, { cases: [] });
    await gotoCases(page);
    await expect(page.getByText("No stored cases yet.")).toBeVisible();
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(0);
    await expect(page.getByRole("main").getByText(/Valuation tab|generat/i)).toHaveCount(0);
  });

  test("a failed list load is an error, with no rows", async ({ page }) => {
    await mockCasesApi(page, { listStatus: 500 });
    await gotoCases(page);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByTestId(/^case-row-/)).toHaveCount(0);
  });
});

test("the valuation page links to the chosen ticker's stored cases", async ({ page }) => {
  await mockValuationApi(page, {
    cases: [{ id: 1, case_name: "conservative_AEP_2026-01-01", ticker: "AEP", as_of_date: "2026-09-04", base_year: 2025, target_year: 2035, parent_case_id: null }],
  });
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel(/ticker/i).fill("AEP");
  await page.getByLabel(/ticker/i).press("Enter");
  await expect(page.getByRole("link", { name: /Stored cases for AEP/ })).toHaveAttribute("href", "/cases?ticker=AEP");
});

test("the valuation page does not link when the chosen ticker has no stored cases", async ({ page }) => {
  // Cases exist, but for a different ticker: the link must not appear for AEP.
  await mockValuationApi(page, {
    cases: [{ id: 1, case_name: "conservative_AAPL_2026-01-01", ticker: "AAPL", as_of_date: "2026-09-04", base_year: 2025, target_year: 2035, parent_case_id: null }],
  });
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel(/ticker/i).fill("AEP");
  await page.getByLabel(/ticker/i).press("Enter");
  await expect(page.getByTestId("verdict-panel")).toBeVisible();
  await expect(page.getByRole("link", { name: /Stored cases/ })).toHaveCount(0);
});

test("the valuation page reads the case list only after a panel has loaded", async ({ page }) => {
  // GET /valuation/cases and GET /valuation/verdict/{ticker} share one records-sync lock on
  // the server (apps/api/routes/valuation.py), so the case list must not be requested until
  // the verdict query has already succeeded -- not merely kept off the render path.
  const stats = await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });

  // No ticker chosen yet: the case list must not have been requested. There is no success
  // event to wait on for an absence, so this is a fixed settle -- acceptable only because we
  // are asserting a request did NOT happen, not waiting on one that will.
  await page.waitForTimeout(1500);
  expect(stats.casesRequests()).toBe(0);

  await page.getByLabel(/ticker/i).fill("AEP");
  await page.getByLabel(/ticker/i).press("Enter");
  await expect(page.getByTestId("verdict-panel")).toBeVisible();
  await expect.poll(() => stats.casesRequests()).toBe(1);
});

async function gotoCase(page: Page, id: number) {
  await page.goto(`/cases/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("case-valuation")).toBeVisible({ timeout: 60_000 });
}

test.describe("one case", () => {
  test("the page loads the case the URL names, with its valuation", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 3);
    await expect(page.getByRole("heading", { name: "conservative_MSFT_2026-01-01" })).toBeVisible();
    const valuation = page.getByTestId("case-valuation");
    await expect(valuation.getByTestId("value-per-share-diluted")).toHaveText("49.96");
    await expect(valuation.getByTestId("terminal-share")).toHaveText("66.3%");
    const yearTable = valuation.getByRole("table", { name: "Year by year" });
    await expect(yearTable.getByRole("row")).toHaveCount(11); // header + 10 years
    await expect(valuation.getByRole("cell", { name: "2026" })).toBeVisible();
    await expect(valuation.getByRole("cell", { name: "2035" })).toBeVisible();
    const row2026 = yearTable.getByRole("row").filter({ has: page.getByRole("cell", { name: "2026", exact: true }) });
    await expect(row2026.getByRole("cell", { name: "9.00%" })).toBeVisible();
    const segmentTable = valuation.getByRole("table", { name: "Segments in the target year" });
    await expect(segmentTable.getByRole("cell", { name: "27.3%" })).toBeVisible();
  });

  test("an engine refusal to run the case is content, not an error and not a zero", async ({ page }) => {
    await mockCasesApi(page, { runStatus: 422, runDetail: "WACC must exceed terminal growth: 0.030 >= 0.030" });
    await gotoCase(page, 1);
    const valuation = page.getByTestId("case-valuation");
    await expect(valuation.getByTestId("case-valuation-refusal")).toHaveText("WACC must exceed terminal growth: 0.030 >= 0.030");
    await expect(valuation.getByRole("alert")).toHaveCount(0);
    await expect(valuation.getByTestId("value-per-share-diluted")).toHaveCount(0);
  });

  test("inputs show rates as percentages and narrated fields with their claim", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    const inputs = page.getByTestId("case-inputs");
    await expect(inputs.getByTestId("input-case.wacc_stable")).toContainText("7.40%");
    const margin = inputs.getByTestId("input-segment.Core.base_margin");
    await expect(margin).toContainText("20.00%");
    await expect(margin).toContainText("trailing three-year margin");
    await expect(margin).toContainText("probable");
    await expect(inputs.getByTestId("input-segment.Core.tam_target")).toContainText("not set");
  });

  test("a fork names its parent", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 2);
    await expect(page.getByRole("link", { name: "case 1" })).toHaveAttribute("href", "/cases/1");
  });

  test("an invalid id in the URL is content, not an alert", async ({ page }) => {
    await mockCasesApi(page);
    await page.goto("/cases/abc", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Not a case id: abc")).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });
});

test.describe("why a fork's value moved", () => {
  test("one bar per changed input, labelled from → to, and the contributions add up", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 2);
    const why = page.getByTestId("case-why");
    await expect(why.getByTestId("why-headline")).toHaveText("49.96 → 52.32 (+2.36 per share)");
    await expect(why.getByTestId(/^why-bar-/)).toHaveCount(3);
    await expect(why.getByTestId("why-bar-0")).toContainText("WACC, stable");
    await expect(why.getByTestId("why-bar-0")).toContainText("7.40% → 8.10%");
    await expect(why.getByTestId("why-bar-0")).toContainText("−6.14");
    await expect(why.getByTestId("why-bar-1")).toContainText("Core · Base margin");
    await expect(why.getByTestId("why-bar-1")).toContainText("20.00% → 22.00%");
    await expect(why.getByTestId("why-bar-2")).toContainText("Core · Margin, target");
    await expect(why.getByTestId("why-bar-2")).toContainText("28.00% → 35.00%");
    await expect(why.getByTestId("why-bar-2")).toContainText("+8.00");
    await expect(why.getByTestId("why-sum")).toHaveText("Contributions sum to +2.36, the whole difference.");
    await expect(why.getByRole("alert")).toHaveCount(0);
  });

  test("contributions that do not add up are flagged, not trusted", async ({ page }) => {
    await mockCasesApi(page, { diffResult: { ...DIFF_RESULT, total_difference: -9.0 } });
    await gotoCase(page, 2);
    await expect(page.getByTestId("case-why").getByRole("alert")).toContainText("do not add up");
  });

  test("a refusal to attribute is content that names the cap", async ({ page }) => {
    await mockCasesApi(page, {
      diffStatus: 422,
      diffDetail: "too_many_changed_inputs: case 2 changes 25 inputs; the Shapley cap is 12",
    });
    await gotoCase(page, 2);
    const why = page.getByTestId("case-why");
    await expect(why.getByTestId("case-why-refusal")).toContainText("the Shapley cap is 12");
    await expect(why.getByTestId(/^why-bar-/)).toHaveCount(0);
    await expect(why.getByRole("alert")).toHaveCount(0);
  });

  test("a case with no parent has no such section", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    await expect(page.getByTestId("case-why")).toHaveCount(0);
  });
});

test.describe("forking a case", () => {
  async function addChange(page: Page, index: number, field: string, value: string) {
    await page.getByRole("button", { name: "Add a change" }).click();
    const row = page.getByTestId(`fork-row-${index}`);
    await row.getByLabel("Field").selectOption(field);
    await row.getByLabel("New value").fill(value);
    return row;
  }

  test("a rate typed as a percentage is sent as a fraction, unnarrated as a bare number", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    await page.getByLabel("New case name").fill("higher WACC");
    await addChange(page, 0, "case.wacc_stable", "8.1");
    await page.getByRole("button", { name: "Create fork" }).click();
    await expect(page).toHaveURL(/\/cases\/4$/);
    await expect(page.getByRole("heading", { name: "higher WACC" })).toBeVisible();
    await expect(page.getByTestId("fork-row-0")).toHaveCount(0);
    await expect(page.getByLabel("New case name")).toHaveValue("");
    expect(stats.forkPosts[0]).toEqual({ case_name: "higher WACC", overrides: { case: { wacc_stable: 0.081 }, segments: {} } });
  });

  test("a narrated change is sent with its claim and three_p, and cannot be sent without them", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    await page.getByLabel("New case name").fill("margin up");
    const row = await addChange(page, 0, "segment.Core.base_margin", "22");
    await page.getByRole("button", { name: "Create fork" }).click();
    await expect(row.getByTestId("row-problem")).toContainText("needs a claim");
    expect(stats.forkPosts).toHaveLength(0);
    const valueInput = row.getByLabel("New value");
    await expect(valueInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = await valueInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText("needs a claim");

    await row.getByLabel("Claim").fill("pricing power holds");
    await row.getByLabel("Three-P").selectOption("plausible");
    await page.getByRole("button", { name: "Create fork" }).click();
    await expect(page).toHaveURL(/\/cases\/4$/);
    expect(stats.forkPosts[0]).toEqual({
      case_name: "margin up",
      overrides: { case: {}, segments: { Core: { base_margin: { value: 0.22, claim: "pricing power holds", three_p: "plausible" } } } },
    });
  });

  test("the counter counts only rows that change a value", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    await addChange(page, 0, "case.wacc_stable", "8.1");
    await addChange(page, 1, "case.terminal_growth", "3");  // equal to the stored 0.03
    await expect(page.getByTestId("fork-counter")).toHaveText("1 of 12 changed inputs");
    await expect(page.getByTestId("fork-row-1")).toContainText("unchanged, will be ignored");
  });

  test("a server refusal is shown verbatim and marks the row it names", async ({ page }) => {
    await mockCasesApi(page, {
      forkStatus: 422,
      forkDetail: "narrative_required: margin_target needs a three_p of ['plausible', 'possible', 'probable'], got ''",
    });
    await gotoCase(page, 1);
    await page.getByLabel("New case name").fill("x");
    await addChange(page, 0, "case.wacc_stable", "8.1");
    const target = await addChange(page, 1, "segment.Core.margin_target", "30");
    await target.getByLabel("Claim").fill("scale");
    await target.getByLabel("Three-P").selectOption("possible");
    await page.getByRole("button", { name: "Create fork" }).click();
    await expect(page.getByTestId("fork-refusal")).toHaveText(
      "narrative_required: margin_target needs a three_p of ['plausible', 'possible', 'probable'], got ''",
    );
    await expect(page.getByTestId("fork-refusal")).toHaveAttribute("role", "status");
    await expect(target).toHaveAttribute("data-highlighted", "true");
    await expect(page.getByTestId("fork-row-0")).toHaveAttribute("data-highlighted", "false");
  });

  test("a 500 is an error, not a refusal", async ({ page }) => {
    await mockCasesApi(page, { forkStatus: 500, forkDetail: "internal server error" });
    await gotoCase(page, 1);
    await page.getByLabel("New case name").fill("x");
    await addChange(page, 0, "case.wacc_stable", "8.1");
    await page.getByRole("button", { name: "Create fork" }).click();
    const error = page.getByTestId("fork-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("fork-refusal")).toHaveCount(0);
    await expect(page.locator('[data-testid^="fork-row-"][data-highlighted="true"]')).toHaveCount(0);
  });

  test("submitting with no actual change shows a message and posts nothing", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    await page.getByLabel("New case name").fill("x");
    await addChange(page, 0, "case.terminal_growth", "3"); // stored value is 0.03 -- unchanged
    await page.getByRole("button", { name: "Create fork" }).click();
    await expect(page.getByTestId("fork-nothing-changed")).toHaveText("Change at least one value to fork.");
    expect(stats.forkPosts).toHaveLength(0);
  });
});

test.describe("uncertainty (simulate this case)", () => {
  async function addDistribution(page: Page, field: string, shape: string, params: Record<string, string>) {
    await page.getByRole("button", { name: "Add an input" }).click();
    const row = page.getByTestId("simulate-row-0");
    await row.getByLabel("Field").selectOption(field);
    await row.getByLabel("Shape").selectOption(shape);
    for (const [label, value] of Object.entries(params)) await row.getByLabel(label).fill(value);
    return row;
  }

  test("the section is not called Monte Carlo", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    await expect(page.getByRole("heading", { name: "Uncertainty (simulate this case)" })).toBeVisible();
    await expect(page.getByTestId("case-simulate")).not.toContainText("Monte Carlo");
  });

  test("rate parameters are sent as fractions, and results show accounting, stats and association", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect.poll(() => stats.simulatePosts.length).toBe(1);

    expect(stats.simulatePosts[0]).toEqual({
      runs: 2000,
      distributions: { case: { wacc_stable: { shape: "normal", mean: 0.074, sd: 0.005 } }, segments: {} },
    });
    const results = page.getByTestId("simulate-results");
    await expect(results.getByTestId("simulate-accounting")).toHaveText("1,934 of 2,000 draws valued · 66 refused (3.3%)");
    await expect(results.getByTestId("simulate-p50")).toHaveText("49.10");
    await expect(results.getByText("among accepted draws").first()).toBeVisible();
    await expect(results.getByTestId("association-0")).toContainText("WACC, stable");
    await expect(results.getByTestId("association-0")).toContainText("−0.81");
    await expect(results.getByTestId("simulate-histogram")).toBeVisible();
  });

  test("association is shown as signed coefficients, never as shares of 100%", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const association = page.getByTestId("simulate-association");
    await expect(association.getByTestId("association-1")).toContainText("+0.42");
    await expect(association).not.toContainText("%");
  });

  test("a suppressed simulation shows the accounting and why, and no statistics at all", async ({ page }) => {
    await mockCasesApi(page, { simulateResult: SIMULATE_SUPPRESSED });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "uniform", { Low: "6", High: "12" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const results = page.getByTestId("simulate-results");
    await expect(results.getByTestId("simulate-accounting")).toHaveText("1,500 of 2,000 draws valued · 500 refused (25.0%)");
    await expect(results.getByTestId("simulate-suppressed")).toHaveText(SIMULATE_SUPPRESSED.suppressed!);
    await expect(results.getByTestId("simulate-stats")).toHaveCount(0);
    await expect(results.getByTestId("simulate-histogram")).toHaveCount(0);
    await expect(results.getByTestId("simulate-association")).toHaveCount(0);
    await expect(results).not.toContainText("0.00");
  });

  test("an overflowed statistic is omitted on its own, not zeroed", async ({ page }) => {
    const overflowed = {
      ...SIMULATE_RESULT,
      not_finite:
        "omitted ['mean']: the surviving values are individually finite but this aggregate of them overflows, " +
        "so it cannot be reported as a number",
    };
    delete overflowed.mean;
    await mockCasesApi(page, { simulateResult: overflowed });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const results = page.getByTestId("simulate-results");
    await expect(results.getByTestId("simulate-p10")).toBeVisible();
    await expect(results.getByTestId("simulate-p50")).toBeVisible();
    await expect(results.getByTestId("simulate-p90")).toBeVisible();
    await expect(results.getByTestId("simulate-mean")).toHaveCount(0);
    await expect(results.getByTestId("simulate-not-finite")).toHaveText(overflowed.not_finite);
    await expect(results.getByTestId("simulate-histogram")).toBeVisible();
    await expect(results.getByTestId("simulate-suppressed")).toHaveCount(0);
  });

  test("p50 itself overflowing does not trip suppression, which reads only the API's own signal", async ({ page }) => {
    // Distinguishes `"suppressed" in result` from the wrong `!("p50" in result)`: both checks
    // agree whenever p50 is present, or whenever the whole summary is suppressed (no stats at
    // all). They disagree only here -- p50 individually omitted, nothing else withheld.
    const overflowed = {
      ...SIMULATE_RESULT,
      not_finite:
        "omitted ['p50']: the surviving values are individually finite but this aggregate of them overflows, " +
        "so it cannot be reported as a number",
    };
    delete overflowed.p50;
    await mockCasesApi(page, { simulateResult: overflowed });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const results = page.getByTestId("simulate-results");
    await expect(results.getByTestId("simulate-p10")).toBeVisible();
    await expect(results.getByTestId("simulate-p50")).toHaveCount(0);
    await expect(results.getByTestId("simulate-p90")).toBeVisible();
    await expect(results.getByTestId("simulate-mean")).toBeVisible();
    await expect(results.getByTestId("simulate-not-finite")).toHaveText(overflowed.not_finite);
    await expect(results.getByTestId("simulate-suppressed")).toHaveCount(0);
  });

  // RUN_RESULT.value_per_share_diluted is 49.96, so pointValue is 49.96 for all three tests below.
  test("the histogram marks the bin holding the case's own value", async ({ page }) => {
    await mockCasesApi(page); // SIMULATE_RESULT's bins are 35..67 in steps of 1: 49.96 falls in [49, 50).
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const mark = page.getByTestId("simulate-results").getByTestId("histogram-mark");
    await expect(mark).toContainText("49.00");
    await expect(mark).toContainText("50.00");
  });

  test("a point value on the last bin's top edge is still marked, matching np.histogram's closed last bin", async ({ page }) => {
    const topEdge = {
      ...SIMULATE_RESULT,
      histogram: [
        { lower: 47.96, upper: 48.96, count: 20 },
        { lower: 48.96, upper: 49.96, count: 15 },
      ],
    };
    await mockCasesApi(page, { simulateResult: topEdge });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const mark = page.getByTestId("simulate-results").getByTestId("histogram-mark");
    await expect(mark).toContainText("48.96");
    await expect(mark).toContainText("49.96");
  });

  test("a point value outside the simulated range marks no bin", async ({ page }) => {
    const outside = {
      ...SIMULATE_RESULT,
      histogram: Array.from({ length: 32 }, (_, i) => ({ lower: 60 + i, upper: 61 + i, count: 10 + (i % 7) })),
    };
    await mockCasesApi(page, { simulateResult: outside });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const results = page.getByTestId("simulate-results");
    await expect(results).toContainText("lies outside the simulated range");
    await expect(results.getByTestId("histogram-mark")).toHaveCount(0);
  });

  test("the seed is shown and a rerun sends it back", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect(page.getByTestId("simulate-seed")).toContainText("1234");
    await page.getByRole("button", { name: "Rerun with this seed" }).click();
    await expect.poll(() => stats.simulatePosts.length).toBe(2);
    expect(stats.simulatePosts[1].seed).toBe(1234);
  });

  test("a rerun reproduces the displayed result, ignoring form edits made since", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    const row = await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect.poll(() => stats.simulatePosts.length).toBe(1);
    await row.getByLabel("Std dev").fill("1.2");
    await page.getByRole("button", { name: "Rerun with this seed" }).click();
    await expect.poll(() => stats.simulatePosts.length).toBe(2);
    expect(stats.simulatePosts[1].distributions).toEqual(stats.simulatePosts[0].distributions);
    expect(stats.simulatePosts[1].seed).toBe(1234);
  });

  test("a row with a problem is marked aria-invalid on its first param input, described by the problem", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    // A narrated field (margin_target) with its narrative left empty: a row problem, not a
    // seed or runs problem, so this isolates the param-input wiring F5 adds.
    const row = await addDistribution(page, "segment.Core.margin_target", "triangular", { Low: "24", "Most likely": "28", High: "30" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const firstInput = row.getByLabel("Low");
    await expect(firstInput).toHaveAttribute("aria-invalid", "true");
    const describedBy = await firstInput.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`#${describedBy}`)).toContainText("claim");
  });

  test("a bad seed blocks sending, with the problem shown", async ({ page }) => {
    const stats = await mockCasesApi(page);
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByLabel("Seed (optional)").fill("-1");
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect(page.getByText("the seed must be a whole number of 0 or more")).toBeVisible();
    expect(stats.simulatePosts.length).toBe(0);
  });

  test("a refusal to simulate is shown verbatim, not as an error", async ({ page }) => {
    await mockCasesApi(page, {
      simulateStatus: 422,
      simulateDetail: "invalid_distribution: case.wacc_stable: sd must be positive",
    });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    await expect(page.getByTestId("simulate-refusal")).toHaveText("invalid_distribution: case.wacc_stable: sd must be positive");
    await expect(page.getByTestId("case-simulate").getByRole("alert")).toHaveCount(0);
  });

  test("a 500 is an error, not a refusal", async ({ page }) => {
    await mockCasesApi(page, { simulateStatus: 500, simulateDetail: "internal server error" });
    await gotoCase(page, 1);
    await addDistribution(page, "case.wacc_stable", "normal", { Mean: "7.4", "Std dev": "0.5" });
    await page.getByRole("button", { name: "Simulate" }).click();
    const error = page.getByTestId("simulate-error");
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute("role", "alert");
    await expect(page.getByTestId("simulate-refusal")).toHaveCount(0);
  });
});

test.describe("market cross-check (EV/Sales)", () => {
  test("shows the implied EV beside the DCF's, the multiple, the gap and its source", async ({ page }) => {
    await mockCasesApi(page);
    await gotoCase(page, 1);
    const pricing = page.getByTestId("case-pricing");
    await expect(pricing.getByTestId("pricing-implied-ev")).toHaveText("8,000");
    await expect(pricing.getByTestId("pricing-dcf-ev")).toHaveText("4,946.3");
    await expect(pricing.getByTestId("pricing-multiple")).toHaveText("×8.00");
    // 4946.3 / 8000 - 1 = -0.3817 -> "38.2% below", sign turned into words, never "-38.2%".
    await expect(pricing.getByTestId("pricing-gap")).toHaveText(
      "The DCF values the business 38.2% below what its industry's EV/Sales implies.",
    );
    await expect(pricing.getByTestId("pricing-source")).toContainText(PRICING_RESULT.source);
  });

  test("a DCF above the implied value says above", async ({ page }) => {
    await mockCasesApi(page, { pricingResult: { ...PRICING_RESULT, dcf_to_implied: 0.25 } });
    await gotoCase(page, 1);
    await expect(page.getByTestId("pricing-gap")).toHaveText(
      "The DCF values the business 25.0% above what its industry's EV/Sales implies.",
    );
  });

  test("a case that cannot be priced says why, as content", async ({ page }) => {
    await mockCasesApi(page, {
      pricingStatus: 422,
      pricingDetail: "no_ticker: this case has no ticker, so no industry can be found for it",
    });
    await gotoCase(page, 1);
    const pricing = page.getByTestId("case-pricing");
    await expect(pricing.getByTestId("case-pricing-refusal")).toHaveText(
      "no_ticker: this case has no ticker, so no industry can be found for it",
    );
    await expect(pricing.getByRole("alert")).toHaveCount(0);
    await expect(pricing.getByTestId("pricing-implied-ev")).toHaveCount(0);
  });
});
