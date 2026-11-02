import { expect, test, type Page } from "@playwright/test";
import { mockCorporatePageApi } from "./helpers/corporatePageMock";
import { lowerPanel } from "./helpers/corporateDcf";

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
    await expect(guide).toContainText("Peer A, B, C는 모든 기업에 같은 고정 예시점입니다.");
    await expect(guide).toContainText("이 기업의 최적 부채비율을 계산한 것이 아닙니다.");
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
    await expect(page.getByRole("tooltip")).toContainText("Peer A, B, C는 고정 예시점입니다.");
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
    await expect(panel.getByTestId("example-badge-beta")).toHaveAttribute("title", /Operating bar and the curve are examples/);
    await expect(panel.getByTestId("example-badge-peers")).toHaveAttribute("title", /Peer A, B and C are fixed example points/);
    await expect(panel.getByTestId("example-badge-peers")).toContainText("Example");
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
