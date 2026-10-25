import { expect, test, type Page } from "@playwright/test";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import type { SurgeEventOut } from "../../../../packages/shared-types";
import {
  candidateCard, crashCard, mockRiskRecords, REPORT_ALERT, SURGE_DETAILS, SURGE_HISTORY,
} from "./helpers/riskApiMock";

// Risk UI spec §4 and plan Task 6: the record reports on /alerts/[kind]/[id] and the theme level chart.
const report = (page: Page) => page.getByTestId("records-report");
const section = (page: Page, name: string) => report(page).locator(`[data-section="${name}"]`);

async function open(page: Page, path: string) {
  await mockRiskRecords(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("records-table")).toBeVisible({ timeout: 30_000 });
}

/** The cells of each body row in a report table, as trimmed text. */
async function cells(page: Page, name: string): Promise<string[][]> {
  return section(page, name).locator("tbody tr").evaluateAll((rows) =>
    rows.map((row) => Array.from(row.querySelectorAll("td")).map((td) => (td.querySelector("[data-part=value]")?.textContent ?? td.textContent ?? "").trim())));
}

test("risk report sections and per-theme numbers", async ({ page }) => {
  const detailUrl = page.waitForRequest(/\/api\/v1\/risk\/alerts\/5(\?|$)/);
  await open(page, "/alerts/risk/5");
  expect(new URL((await detailUrl).url()).searchParams.get("cards"), "the report asks for every card").toBe("all");
  await expect(section(page, "themes").locator("tbody tr")).toHaveCount(4);

  const order = await report(page).locator("[data-section]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-section")));
  expect(order).toEqual(["header", "chart", "warnings", "themes", "summary", "current", "snapshot", "news"]);

  await expect(section(page, "header")).toContainText("Risk 5");
  await expect(section(page, "header")).toContainText("2025-06-10");
  await expect(section(page, "header")).toContainText("2025-06-30");
  await expect(section(page, "header")).toContainText("v3");

  // Warnings at the start: the name and unit from /latest, the state and value from the alert.
  expect(await cells(page, "warnings")).toEqual([
    ["Credit spread", "Off", "1.10%"],
    ["Volatility", "On", "31.50%"],
    ["Claims", "On", "4.20%"],
  ]);

  // Theme, via, joined, from 20D high at join, 5/10/20D after, max further drop in 10D, left.
  expect(await cells(page, "themes")).toEqual([
    ["Semiconductors", "Theme", "2025-06-11", "-10.4%", "-1.0%", "-2.5%", "+0.8%", "-3.2%", "2025-06-25"],
    ["Philadelphia Semiconductor (SOX)", "SOX", "2025-06-12", "-9.1%", "-3.0%", "-4.0%", "-1.0%", "-5.0%", "—"],
    ["AI infrastructure", "Theme", "2025-06-10", "-12.3%", "-2.1%", "-7.4%", "+1.5%", "-7.4%", "2025-06-30"],
    ["Semiconductors", "Theme", "2025-06-27", "-8.0%", "-6.0%", "—", "—", "-9.0%", "—"],
  ]);

  // The start-day snapshot: names from the full card list, then the 5/10/20D after.
  expect(await cells(page, "snapshot")).toEqual([
    ["Crash", "OLD1", "Old Crash 1", "-4.5%", "-8.2%", "+2.0%"],
    ["At risk", "OLDC", "Old Candidate", "+1.2%", "—", "-0.4%"],
  ]);
  await expect(section(page, "news")).toContainText("Fed holds rates");
  await expect(section(page, "news")).toContainText("AI capex slows");
  await expect(section(page, "news").getByTestId("macro-figure")).toContainText("Fed funds 2025-05 4.33");
});

test("a wide report table scrolls inside itself, not the whole report panel", async ({ page }) => {
  await open(page, "/alerts/risk/5");
  await expect(section(page, "themes").locator("tbody tr")).toHaveCount(4);
  // The theme table is far wider than the panel. Its badges' sr-only text is position:absolute,
  // and without a positioned table wrapper it widened the panel, which then scrolled sideways.
  const widths = await report(page).evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
});

test("current cards list every card of both decks, past the panel's ten", async ({ page }) => {
  // ?cards=all sends every card; the panel shows ten and links here for the rest (final review I1).
  const full = {
    ...REPORT_ALERT,
    crash: { as_of: "2025-06-10", total: 12, cards: Array.from({ length: 12 }, (_, i) => crashCard(i + 1)) },
    candidates: { as_of: "2025-06-10", total: 11, cards: Array.from({ length: 11 }, (_, i) => candidateCard(i + 1)) },
  };
  await mockRiskRecords(page);
  await page.route(/\/api\/v1\/risk\/alerts\/5(\?.*)?$/, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: full, meta: {} }) }));
  await page.goto("/alerts/risk/5", { waitUntil: "domcontentloaded" });
  const current = section(page, "current");
  await expect(current.locator("[data-deck=crash] tbody tr")).toHaveCount(12, { timeout: 60_000 });
  await expect(current.locator("[data-deck=candidates] tbody tr")).toHaveCount(11);
  await expect(current).toContainText("As of 2025-06-10");
  const rows = await cells(page, "current");
  // Deck, ticker, name, theme, from the high, then the high date (crash) or the correlation (at risk).
  expect(rows[0]).toEqual(["Crash", "CR1", "Crash Stock 1", "Semiconductors", "-29.0%", "2026-09-25"]);
  expect(rows[1][3], "^SOX is named from the alert's stint label").toBe("Philadelphia Semiconductor (SOX)");
  expect(rows[11][1]).toBe("CR12");
  expect(rows[12]).toEqual(["At risk", "CA1", "Candidate Stock 1", "AI infrastructure", "-0.7%", "SOX 0.85"]);
  expect(rows[22][1]).toBe("CA11");
});

const okBody = (data: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data, meta: {} }) });

test("a warning /latest does not know shows a dash, not a unitless number", async ({ page }) => {
  await mockRiskRecords(page);
  const detail = { ...REPORT_ALERT, warnings_at_start: [...REPORT_ALERT.warnings_at_start, { id: "W9", state: "on" as const, value: 2.75 }] };
  await page.route(/\/api\/v1\/risk\/alerts\/5(\?.*)?$/, (route) => route.fulfill(okBody(detail)));
  await page.goto("/alerts/risk/5", { waitUntil: "domcontentloaded" });
  await expect(section(page, "warnings").locator("tbody tr")).toHaveCount(4, { timeout: 60_000 });
  expect((await cells(page, "warnings"))[3]).toEqual(["W9", "On", "—"]);
});

test("surge report names the stalled and rules-changed end reasons", async ({ page }) => {
  const ended = (id: number, end_reason: SurgeEventOut["end_reason"]): SurgeEventOut =>
    ({ ...SURGE_HISTORY[2], id, end_reason });
  const extra = [ended(31, "stalled"), ended(32, "rules_changed")];
  await mockRiskRecords(page);
  await page.route(/\/api\/v1\/risk\/surge\/history(\?.*)?$/, (route) => route.fulfill(okBody([...SURGE_HISTORY, ...extra])));
  await page.route(/\/api\/v1\/risk\/surge\/events\/3[12](\?.*)?$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split("/").pop());
    return route.fulfill(okBody({ ...SURGE_DETAILS[30], ...extra.find((event) => event.id === id) }));
  });
  for (const [id, label] of [[31, "Stalled"], [32, "Rules changed"]] as const) {
    await page.goto(`/alerts/surge/${id}?kind=surge`, { waitUntil: "domcontentloaded" });
    await expect(section(page, "end"), `event ${id}`).toHaveText(new RegExp(`${label}$`), { timeout: 60_000 });
  }
});

test("summary sentence uses values, not 적중", async ({ page }) => {
  await open(page, "/alerts/risk/5");
  // Each theme once, by its first stint: -7.41 and exactly -5.00 are beyond -5% (the API's rule is <=); semis'
  // first stint (-3.2) is not, and its later -9 stint is not counted again. The deepest beyond is named.
  await expect(section(page, "summary")).toContainText("2 of 3 fell more than 5% further within 10 days — AI infrastructure");
  await expect(section(page, "summary").locator("[data-part=value]")).toHaveText("-7.4%");

  // An open alert with no 10-day result yet says so instead of counting.
  await page.goto("/alerts/risk/12", { waitUntil: "domcontentloaded" });
  await expect(section(page, "summary")).toHaveText("The 10-day result is not in yet.", { timeout: 30_000 });
});

test.describe("in Korean", () => {
  test.use({ locale: "ko-KR" });
  test("summary sentence uses values, not 적중 (ko)", async ({ page }) => {
    await open(page, "/alerts/risk/5");
    await expect(section(page, "summary")).toContainText("3개 중 2개가 10일 안에 5% 넘게 더 빠짐 — AI 인프라");
    await expect(section(page, "summary").locator("[data-part=value]")).toHaveText("-7.4%");
    await expect(section(page, "news")).toBeVisible();
    expect(await report(page).textContent()).not.toContain("적중");
  });
});

test("surge report components and rule text", async ({ page }) => {
  await open(page, "/alerts/surge/30?kind=surge");
  await expect(section(page, "components").locator("tbody tr")).toHaveCount(4);
  const order = await report(page).locator("[data-section]").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-section")));
  expect(order).toEqual(["header", "chart", "components", "overheated", "after", "leaders", "end"]);

  await expect(section(page, "header")).toContainText("Surge 30");
  await expect(section(page, "header")).toContainText("AI infrastructure");
  await expect(section(page, "header")).toContainText("Computed from past data");
  // Label, value on the start day, and the rule text from components_info.
  expect(await cells(page, "components")).toEqual([
    ["magnitude", "2.40", "magnitude rule"],
    ["accel", "0.97", "accel rule"],
    ["breadth", "80.0%", "breadth rule"],
    ["rsi", "68.0", "rsi rule"],
  ]);
  await expect(section(page, "overheated")).toContainText("Overheated on 2026-05-12");
  expect(await cells(page, "after")).toEqual([["+4.3%", "+8.5%", "-1.8%", "+9.3%"]]);
  expect(await cells(page, "leaders")).toEqual([
    ["NVDA", "NVIDIA", "+12.4%"],
    ["AMD", "Advanced Micro Devices", "+9.1%"],
    ["AVGO", "Broadcom", "+7.7%"],
    ["MU", "Micron Technology", "+6.0%"],
    ["TSM", "TSMC", "—"],
  ]);
  await expect(section(page, "end")).toContainText("Fell below trend");

  // An open event has not ended and was never overheated.
  await page.goto("/alerts/surge/42?kind=surge", { waitUntil: "domcontentloaded" });
  await expect(section(page, "end")).toContainText("Ongoing", { timeout: 30_000 });
  await expect(section(page, "overheated")).toContainText("Not overheated");
});

test("movers day table", async ({ page }) => {
  await open(page, "/alerts/movers/2026-10-16?kind=movers");
  await expect(section(page, "header")).toContainText("Yesterday's gainers 2026-10-16");
  // Rank, ticker, name, theme, 1D, 5D, RSI.
  expect(await cells(page, "movers")).toEqual([
    ["1", "MV1", "Mover Stock 1", "Robotics", "+9.0%", "+11.0%", "69.0"],
    ["2", "MV2", "Mover Stock 2", "Robotics", "+8.0%", "+10.0%", "68.0"],
    ["3", "MV3", "Mover Stock 3", "Robotics", "+7.0%", "+9.0%", "67.0"],
    ["4", "MV4", "Mover Stock 4", "Robotics", "+6.0%", "+8.0%", "66.0"],
    ["5", "MV5", "Mover Stock 5", "Robotics", "+5.0%", "+7.0%", "65.0"],
  ]);
  await expect(section(page, "chart"), "a movers day has no theme to chart").toHaveCount(0);
});

test("chart renders with shaded window", async ({ page }) => {
  const levelUrl = page.waitForRequest(/\/api\/v1\/risk\/themes\/[^/]+\/level/);
  await open(page, "/alerts/risk/5");
  const url = new URL((await levelUrl).url());
  // The primary theme, from 40 days before the start to 20 days after the release.
  expect(decodeURIComponent(url.pathname.split("/").at(-2) ?? "")).toBe("ai_infra");
  expect(url.searchParams.get("from")).toBe("2025-05-01");
  expect(url.searchParams.get("to")).toBe("2025-07-20");

  const chart = page.getByTestId("theme-level-chart");
  await expect(chart.locator(".recharts-line-curve")).toHaveCount(1);
  await expect(chart.locator(".recharts-reference-area-rect")).toHaveCount(1);
  // Sampled after Recharts' 400ms animation, so the boxes are the final ones (see the recharts memory note).
  await page.waitForTimeout(600);
  const box = await chart.evaluate((node) => {
    const line = (node.querySelector(".recharts-line-curve") as SVGGraphicsElement).getBBox();
    const area = (node.querySelector(".recharts-reference-area-rect") as SVGGraphicsElement).getBBox();
    return { lineX: line.x, lineW: line.width, areaX: area.x, areaW: area.width };
  });
  // The data runs 2025-05-01..2025-07-20 (80 days); the window 2025-06-10..2025-06-30 is days 40..60.
  expect((box.areaX - box.lineX) / box.lineW).toBeCloseTo(0.5, 1);
  expect((box.areaX + box.areaW - box.lineX) / box.lineW).toBeCloseTo(0.75, 1);

  // A surge event charts its own theme over its own window.
  const surgeLevel = page.waitForRequest(/\/api\/v1\/risk\/themes\/[^/]+\/level/);
  await page.goto("/alerts/surge/30?kind=surge", { waitUntil: "domcontentloaded" });
  const surgeUrl = new URL((await surgeLevel).url());
  expect(surgeUrl.searchParams.get("from")).toBe("2026-03-25");
  expect(surgeUrl.searchParams.get("to")).toBe("2026-06-09");
  await expect(page.getByTestId("theme-level-chart").locator(".recharts-reference-area-rect")).toHaveCount(1, { timeout: 30_000 });
});

test("unknown id shows not-found", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/alerts/surge/999", "/alerts/risk/999", "/alerts/movers/2030-01-01"]) {
    await open(page, path);
    await expect(report(page), path).toHaveText("Record not found.");
    await expect(page.getByTestId("theme-level-chart"), path).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`no page scroll with a report open at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const path of ["/alerts/risk/5", "/alerts/surge/30?kind=surge", "/alerts/movers/2026-10-16?kind=movers"]) {
      await open(page, path);
      await expect(section(page, "header")).toBeVisible();
      if (!path.includes("movers")) await expect(page.getByTestId("theme-level-chart").locator(".recharts-line-curve")).toHaveCount(1);
      await page.evaluate(() => document.fonts.ready);
      await expectNoPageScroll(page, `${path} at ${viewport.width}x${viewport.height}`);
    }
  });
}
