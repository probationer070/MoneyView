import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { fairValueFixture } from "./helpers/fairValueMock";
import { lowerPanel } from "./helpers/corporateDcf";
import { buildFormulaContext } from "../../app/corporate/formulaContext";
import { substitutedFormula } from "../../app/corporate/substitutedFormula";

// Spec 2026-11-02-corporate-explainers-plan §4 and §6 P1: every corporate tab explains itself, and the
// comparison columns carry their definitions.

async function gotoCorporateKo(page: Page) {
  await mockCorporatePageApi(page);
  await page.goto("/corporate", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "기업 분석" })).toBeVisible({ timeout: 60_000 });
}

async function openTab(page: Page, name: string) {
  const tab = page.getByTestId("corporate-page-tabs").getByRole("tab", { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

async function expectNoPageScroll(page: Page, where: string) {
  const size = await page.evaluate(() => ({ height: document.scrollingElement!.scrollHeight, innerHeight: window.innerHeight }));
  expect(size.height, `${where}: the page does not scroll`).toBeLessThanOrEqual(size.innerHeight);
}

test.describe("corporate tab guides, in Korean", () => {
  test.use({ locale: "ko-KR", viewport: { width: 1280, height: 720 } });

  const tabs = [
    { name: "요약", key: "summary", says: "허들레이트는 무엇과 비교하나" },
    { name: "진단 차트", key: "diagnostics", says: "1보다 크면 주가가 시장보다 크게 움직이므로" },
    { name: "DCF", key: "dcf", says: "운전자본과 인수는 포함하지 않습니다" },
    { name: "종목 비교", key: "comparison", says: "시장 전체의 수익률입니다. 모든 행이 같은 기준선입니다." },
  ];

  for (const tab of tabs) {
    test(`the ${tab.key} tab has a closed guide that opens without scrolling the page`, async ({ page }) => {
      await gotoCorporateKo(page);
      await openTab(page, tab.name);
      const toggle = page.getByTestId("corporate-guide-toggle");
      await expect(toggle).toHaveText("이 화면 읽는 법");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByText(tab.says)).toHaveCount(0);
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const guide = lowerPanel(page).getByTestId(`corporate-guide-${tab.key}`);
      await expect(guide.getByText(tab.says)).toBeVisible();
      await expectNoPageScroll(page, tab.key);
      await toggle.click();
      await expect(guide).toHaveCount(0);
    });
  }

  test("an open guide follows the tab: switching tabs shows that tab's guide", async ({ page }) => {
    await gotoCorporateKo(page);
    await page.getByTestId("corporate-guide-toggle").click();
    await expect(lowerPanel(page).getByTestId("corporate-guide-summary")).toBeVisible();
    await openTab(page, "DCF");
    await expect(lowerPanel(page).getByTestId("corporate-guide-dcf")).toBeVisible();
    await expect(lowerPanel(page).getByTestId("corporate-guide-summary")).toHaveCount(0);
  });

  test("the diagnostics guide says which chart values are fixed examples, not this company's", async ({ page }) => {
    await gotoCorporateKo(page);
    await openTab(page, "진단 차트");
    await page.getByTestId("corporate-guide-toggle").click();
    const guide = lowerPanel(page).getByTestId("corporate-guide-diagnostics");
    // P4 replaced the fixed Peer A-C with same-sector watchlist companies (plan 2026-11-02 §6.5).
    await expect(guide).toContainText("회색 점은 같은 섹터의 관심종목(최대 4개)이며, 각 종목의 실제 지표입니다.");
    await expect(guide).toContainText("Industry는 이 기업 자체의 비레버리지 베타입니다(업종 평균 아님).");
  });

  test("comparison column names read in Korean and each shows its definition on hover", async ({ page }) => {
    await gotoCorporateKo(page);
    await openTab(page, "종목 비교");
    await lowerPanel(page).getByRole("button", { name: "비교 새로고침" }).click();
    const header = lowerPanel(page).getByRole("columnheader", { name: "시장 암시 수익률(연)", exact: true });
    await expect(header).toBeVisible({ timeout: 30_000 });
    await expect(lowerPanel(page).getByRole("columnheader", { name: "CAPM 요구수익률", exact: true })).toBeVisible();
    await header.locator("span").first().hover();
    await expect(page.getByRole("tooltip")).toContainText("지금 시장가치와 정확히 같아지는 연 수익률");
  });

  test("a diagnostics chart's help reads in Korean", async ({ page }) => {
    await gotoCorporateKo(page);
    await openTab(page, "진단 차트");
    const trigger = lowerPanel(page).getByText("매트릭스 해석 상세 열기", { exact: true });
    await expect(trigger).toBeVisible({ timeout: 30_000 });
    await trigger.hover();
    await expect(page.getByRole("tooltip")).toContainText("회색 점은 같은 섹터의 관심종목입니다.");
  });
});

// Plan 2026-11-02 §6 P2: fixed example values are labelled, and the matrix splits into four named
// quadrants around ROIC = WACC and the long-run growth reference (the risk-free rate, 4.2%).
test.describe("example labels and the value matrix quadrants", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function gotoCorporateEn(page: Page) {
    await mockCorporatePageApi(page);
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  }

  async function setAssumption(page: Page, key: string, label: string, value: string) {
    const table = page.getByTestId("assumption-table");
    await table.getByRole("button", { name: `Edit ${label}` }).click();
    await page.getByTestId(`assumption-slider-${key}`).getByRole("slider").fill(value);
    await table.getByRole("button", { name: `Edit ${label}` }).click();
  }

  test("each diagnostic chart with fixed example values carries an Example badge that says what is fixed", async ({ page }) => {
    await gotoCorporateEn(page);
    await openTab(page, "Core Diagnostics");
    const panel = lowerPanel(page);
    await expect(panel.getByTestId("example-badge-regions")).toHaveAttribute("title", /regional bars and line are fixed example indicators/);
    await expect(panel.getByTestId("example-badge-beta")).toHaveAttribute("title", /Operating bar is an example/);
    // The matrix has no example points since P4: its comparison points are real companies.
    await expect(panel.getByTestId("example-badge-peers")).toHaveCount(0);
  });

  const cases = [
    { growth: "8", wacc: "10", quadrant: "growthCreates", text: "Growth adds value" },
    { growth: "2", wacc: "10", quadrant: "returnCash", text: "Return cash" },
    { growth: "8", wacc: "24", quadrant: "fixReturns", text: "Fix returns first" },
    { growth: "2", wacc: "24", quadrant: "restructure", text: "Restructure" },
    // Either side of the 4.2% growth reference.
    { growth: "4.5", wacc: "10", quadrant: "growthCreates", text: "Growth adds value" },
    { growth: "4", wacc: "10", quadrant: "returnCash", text: "Return cash" },
  ];
  for (const c of cases) {
    test(`growth ${c.growth}%, ROIC 18%, WACC ${c.wacc}% sits in "${c.text}"`, async ({ page }) => {
      await gotoCorporateEn(page);
      await setAssumption(page, "roic", "ROIC", "18");
      await setAssumption(page, "wacc", "WACC", c.wacc);
      await setAssumption(page, "growth", "Growth Rate", c.growth);
      await openTab(page, "Core Diagnostics");
      const label = lowerPanel(page).getByTestId("matrix-company-quadrant");
      await expect(label).toHaveAttribute("data-quadrant", c.quadrant, { timeout: 30_000 });
      await expect(label).toContainText(c.text);
      await expect(lowerPanel(page).getByTestId("matrix-growth-line")).toHaveText("Long-run growth 4.2%");
    });
  }

  test("the matrix names all four quadrants, and its detail names the company's quadrant", async ({ page }) => {
    await gotoCorporateEn(page);
    await setAssumption(page, "roic", "ROIC", "18");
    await setAssumption(page, "wacc", "WACC", "10");
    await setAssumption(page, "growth", "Growth Rate", "2");
    await openTab(page, "Core Diagnostics");
    const panel = lowerPanel(page);
    for (const [quadrant, text] of [["growthCreates", "Growth adds value"], ["returnCash", "Return cash"], ["fixReturns", "Fix returns first"], ["restructure", "Restructure"]]) {
      await expect(panel.getByTestId(`matrix-corner-${quadrant}`)).toHaveText(text);
    }
    await panel.getByRole("button", { name: /Open matrix interpretation details/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Slow and creating value: return cash");
  });
});

// Plan 2026-11-02 §6.3, P3 (D2): the Ke card is the Ke the WACC was built with.
test.describe("the Ke card is the WACC's Ke", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  const tile = (page: Page, label: string) => page.getByTestId("corporate-kpis").locator(":scope > *").filter({ hasText: label });

  async function gotoWithMetrics(page: Page, patch?: Record<string, number>) {
    await mockCorporatePageApi(page, undefined, patch ? { aaplMetricsPatch: patch } : undefined);
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  }

  test("statement metrics: the card shows the backend's Ke and beta, not a re-levered one", async ({ page }) => {
    await gotoWithMetrics(page, { levered_beta: 1.37, cost_of_equity: 12.34, tax_rate: 0.2 });
    await expect(tile(page, "Bottom-up Ke")).toContainText("12.3%");
    await expect(tile(page, "Levered Beta")).toContainText("1.37");
    // Moving the unlevered beta changes the DCF inputs, not the WACC's Ke.
    const table = page.getByTestId("assumption-table");
    await table.getByRole("button", { name: "Edit Unlevered Beta" }).click();
    await page.getByTestId("assumption-slider-unleveredBeta").getByRole("slider").fill("2");
    await expect(tile(page, "Bottom-up Ke")).toContainText("12.3%");
    await openTab(page, "Core Diagnostics");
    // Beta x ERP: 1.37 x 5.5% = 7.5%.
    await expect(lowerPanel(page).getByRole("button", { name: /Beta x ERP: 7\.5%/ })).toBeVisible({ timeout: 30_000 });
  });

  test("metrics without a WACC Ke: the card re-levers with the WACC's ERP 5.5% and tax 21%", async ({ page }) => {
    await gotoWithMetrics(page);
    // 1.05 x [1 + 0.79 x 18/82] = 1.23; 4.2 + 1.23 x 5.5 + 0.8 = 11.8%.
    await expect(tile(page, "Levered Beta")).toContainText("1.23");
    await expect(tile(page, "Bottom-up Ke")).toContainText("11.8%");
  });
});

test.describe("formulas when the beta is the WACC's", () => {
  const inputs = {
    assumptions: { roic: 21.1, wacc: 7.3, reinvestment: 33.3, unleveredBeta: 0.61 },
    derived: { spread: 13.8, bottomUpKe: 11.9, leveredBeta: 1.37, sustainableGrowth: 7.7, debtToEquity: 0.45, taxRate: 0.2, keFromWacc: true },
    impliedErp: 4.6,
    impliedMarketReturn: 8.8,
    waccAudit: null,
    dcfData: null,
  };

  test("the levered beta is named as the WACC's, not printed as an unequal Hamada identity", () => {
    const ctx = buildFormulaContext(inputs);
    expect(substitutedFormula("leveredBeta", ctx)).toBe("βL = the beta inside the WACC = 1.37");
    expect(substitutedFormula("bottomUpKe", ctx)).toBe("Ke = rf + βL × ERP + CRP = 4.2% + 1.37 × 5.5% + 0.8% = 11.9%");
  });

  test("re-levered metrics still print the Hamada identity with their own tax rate", () => {
    const ctx = buildFormulaContext({ ...inputs, derived: { ...inputs.derived, leveredBeta: 0.83, keFromWacc: false } });
    expect(substitutedFormula("leveredBeta", ctx)).toBe("βL = βU × [1 + (1 − t) × D/E] = 0.61 × [1 + (1 − 20.0%) × 0.45] = 0.83");
  });
});

// Plan 2026-11-02 §6.5, P4 (D3, owner 2026-11-03): the premium is the ticker's own, and the U-curve is gone.
test.describe("country risk premium by reporting currency, and no U-curve", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  async function goto(page: Page, patch?: Record<string, number>) {
    await mockCorporatePageApi(page, undefined, patch ? { aaplMetricsPatch: patch } : undefined);
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
  }

  test("a US reporter's premium of 0% reaches the table, Ke and the hurdle chart", async ({ page }) => {
    await goto(page, { crp: 0 });
    await expect(page.getByTestId("assumption-row-crp")).toContainText("0.0%");
    // No WACC Ke in this mock, so Ke is re-levered: 4.2 + 1.23 x 5.5 + 0 = 11.0%.
    await expect(page.getByTestId("corporate-kpis").locator(":scope > *").filter({ hasText: "Bottom-up Ke" })).toContainText("11.0%");
    await openTab(page, "Core Diagnostics");
    await expect(lowerPanel(page).getByRole("button", { name: "CRP: 0.0%" })).toBeVisible({ timeout: 30_000 });
  });

  test("a premium of 0.8% stays 0.8% end to end", async ({ page }) => {
    await goto(page, { crp: 0.8 });
    await expect(page.getByTestId("assumption-row-crp")).toContainText("0.8%");
    await expect(page.getByTestId("corporate-kpis").locator(":scope > *").filter({ hasText: "Bottom-up Ke" })).toContainText("11.8%");
  });

  test("the beta chart has bars only: no WACC curve", async ({ page }) => {
    await goto(page);
    await openTab(page, "Core Diagnostics");
    const beta = lowerPanel(page).locator("div.p-5", { has: page.getByText("Bottom-up Beta", { exact: true }) }).first();
    await expect(beta.locator(".recharts-bar-rectangle").first()).toBeVisible({ timeout: 30_000 });
    await expect(beta.locator(".recharts-line")).toHaveCount(0);
    await expect(lowerPanel(page).getByText("U-Curve")).toHaveCount(0);
  });
});

test.describe("the value matrix compares with real same-sector companies", () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test("Apple's matrix shows Microsoft (same sector, mocked metrics) and no fixed example points", async ({ page }) => {
    let msftMetricsRequests = 0;
    page.on("request", (request) => { if (new URL(request.url()).pathname.endsWith("/corporate/metrics/MSFT")) msftMetricsRequests += 1; });
    await mockCorporatePageApi(page);
    await page.goto("/corporate", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
    // Not loaded until the matrix is on screen.
    expect(msftMetricsRequests).toBe(0);
    await openTab(page, "Core Diagnostics");
    const matrix = lowerPanel(page).locator("div.p-5", { has: page.getByText("4-Quadrant Value Driver Matrix", { exact: true }) }).first();
    await expect(matrix.locator(".recharts-scatter-symbol")).toHaveCount(2, { timeout: 30_000 });
    expect(msftMetricsRequests).toBeGreaterThan(0);
    await expect(lowerPanel(page).getByText("Peer A")).toHaveCount(0);
  });
});

// ERROR-LOG 2026-11-03: a ticker whose statements and price are in different currencies is refused.
test.describe("a mixed-currency DCF refusal reads as a sentence", () => {
  for (const [locale, heading, button, text] of [
    ["en-US", /Corporate Analysis/i, "Refresh DCF", "The statements are in a different currency from the price"],
    ["ko-KR", "기업 분석", "DCF 새로고침", "재무제표 통화가 주가 통화와 달라서"],
  ] as const) {
    test.describe(locale, () => {
      test.use({ locale });
      test("the verdict shows why there is no value", async ({ page }) => {
        await mockCorporatePageApi(page);
        await page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
          status: 422, contentType: "application/json",
          body: JSON.stringify({ detail: { code: "currency_mismatch", message: "AAPL reports in TWD and trades in USD; a value per share would mix the two" } }),
        }));
        await page.goto("/corporate", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 60_000 });
        await page.getByRole("button", { name: button }).click();
        const verdict = page.getByTestId("corporate-verdict");
        await expect(verdict).toHaveAttribute("data-state", "refused");
        await expect(verdict.getByTestId("dcf-refusal")).toContainText(text);
      });
    });
  }
});

// A refused 5-year DCF still shows the Damodaran-style 10-year case value, labelled with its source (never mixed in).
test.describe("a refused 5-year DCF shows the 10-year case value", () => {
  const refuseDcf = (page: Page) => page.route("**/api/v1/corporate/dcf/AAPL/stream", (route) => route.fulfill({
    status: 422, contentType: "application/json",
    body: JSON.stringify({ detail: { code: "non_positive_fcff", message: "AAPL has a non-positive FCFF in year 1" } }),
  }));

  for (const [locale, heading, button, source, label] of [
    ["en-US", /Corporate Analysis/i, "Refresh DCF", "10-year case", "10-year case value"],
    ["ko-KR", "기업 분석", "DCF 새로고침", "10년 케이스", "10년 케이스 적정가"],
  ] as const) {
    test.describe(locale, () => {
      test.use({ locale });
      test("the refusal is followed by the labelled 10-year value", async ({ page }) => {
        await mockCorporatePageApi(page);
        await refuseDcf(page);
        await page.goto("/corporate", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: heading })).toBeVisible({ timeout: 60_000 });
        await page.getByRole("button", { name: button }).click();
        const verdict = page.getByTestId("corporate-verdict");
        await expect(verdict).toHaveAttribute("data-state", "refused");
        const fallback = verdict.getByTestId("verdict-fallback");
        await expect(fallback).toBeVisible();
        // The fixture's 145.50 per share, formatted for the locale: the integer part is enough to tell it apart.
        await expect(fallback.locator("[data-part=fallback-value]")).toContainText("145");
        await expect(fallback.getByText(label, { exact: true })).toBeVisible();
        await expect(fallback.locator("[data-part=fallback-source]")).toContainText(source);
      });
    });
  }

  test.describe("en-US", () => {
    test.use({ locale: "en-US" });

    test("no positive value means no fallback, and the refusal still shows", async ({ page }) => {
      const fairValue = { ...fairValueFixture("AAPL"), value_per_share: null, gap_pct: null, value_note: "non_positive_value: test" };
      await mockCorporatePageApi(page, undefined, { fairValue });
      await refuseDcf(page);
      await page.goto("/corporate", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Refresh DCF" }).click();
      const verdict = page.getByTestId("corporate-verdict");
      await expect(verdict).toHaveAttribute("data-state", "refused");
      await expect(verdict.getByTestId("dcf-refusal")).toBeVisible();
      await expect(verdict.getByTestId("verdict-fallback")).toHaveCount(0);
    });

    test("a valued DCF shows no fallback", async ({ page }) => {
      await mockCorporatePageApi(page);
      await page.goto("/corporate", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: /Corporate Analysis/i })).toBeVisible({ timeout: 60_000 });
      await page.getByRole("button", { name: "Refresh DCF" }).click();
      const verdict = page.getByTestId("corporate-verdict");
      await expect(verdict).toHaveAttribute("data-state", "valued", { timeout: 60_000 });
      await expect(verdict.getByTestId("verdict-fallback")).toHaveCount(0);
    });
  });
});
