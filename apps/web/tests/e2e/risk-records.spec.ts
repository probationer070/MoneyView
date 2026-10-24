import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import { mockRiskRecords } from "./helpers/riskApiMock";

// Risk UI spec §4 and plan Task 5: the /alerts records page (filters, table, selection, CSV).
const rowsOf = (page: Page) => page.getByTestId("records-row");
const row = (page: Page, kind: string, id: string) => page.locator(`[data-testid="records-row"][data-kind="${kind}"][data-id="${id}"]`);
const kindButton = (page: Page, name: string) => page.getByRole("group", { name: "Kind" }).getByRole("button", { name, exact: true });
const shownOnly = (page: Page) => page.getByLabel("Shown on the banner only");
const report = (page: Page) => page.getByTestId("records-report");

async function open(page: Page, path: string) {
  await mockRiskRecords(page);
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("records-table")).toBeVisible({ timeout: 30_000 });
}

test("filters narrow rows", async ({ page }) => {
  await open(page, "/alerts");
  await expect(rowsOf(page)).toHaveCount(9);
  await expect(row(page, "risk", "9")).toContainText("Computed from past data");
  await expect(row(page, "risk", "12")).not.toContainText("Computed from past data");
  await expect(shownOnly(page), "the banner toggle is for surge only").toHaveCount(0);

  await kindButton(page, "Risk").click();
  await expect(page).toHaveURL(/[?&]kind=risk/);
  await expect(rowsOf(page)).toHaveCount(3);

  await page.getByLabel("From", { exact: true }).fill("2026-01-01");
  await expect(page).toHaveURL(/[?&]from=2026-01-01/);
  await expect(rowsOf(page)).toHaveCount(2);
  await page.getByLabel("To", { exact: true }).fill("2026-06-30");
  await expect(rowsOf(page)).toHaveCount(1);
  await expect(row(page, "risk", "9")).toBeVisible();
  await page.getByLabel("To", { exact: true }).fill("");

  await kindButton(page, "Surge").click();
  await expect(rowsOf(page)).toHaveCount(3);
  await shownOnly(page).check();
  await expect(page).toHaveURL(/[?&]shown=1/);
  await expect(rowsOf(page)).toHaveCount(2);
  await expect(row(page, "surge", "41"), "never on the banner").toHaveCount(0);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(rowsOf(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(kindButton(page, "Surge")).toHaveAttribute("aria-pressed", "true");
  await expect(shownOnly(page)).toBeChecked();
  await expect(page.getByLabel("From", { exact: true })).toHaveValue("2026-01-01");

  await kindButton(page, "Yesterday's gainers").click();
  await expect(shownOnly(page)).toHaveCount(0);
  await expect(rowsOf(page)).toHaveCount(3);
  await expect(page).not.toHaveURL(/[?&]shown=/);
});

test("row click sets URL and selects", async ({ page }) => {
  await open(page, "/alerts?kind=surge");
  await expect(report(page)).toContainText("Pick a record in the table");
  await row(page, "surge", "42").click();
  await expect(page).toHaveURL(/\/alerts\/surge\/42\?kind=surge$/);
  await expect(row(page, "surge", "42")).toHaveAttribute("data-selected", "true");
  await expect(row(page, "surge", "41")).toHaveAttribute("data-selected", "false");
  await expect(report(page)).toContainText("Surge 42");

  await row(page, "surge", "30").click();
  await expect(page).toHaveURL(/\/alerts\/surge\/30\?kind=surge$/);
  await expect(row(page, "surge", "30")).toHaveAttribute("data-selected", "true");
  await expect(row(page, "surge", "42")).toHaveAttribute("data-selected", "false");
});

test("direct URL opens record", async ({ page }) => {
  await open(page, "/alerts/risk/9");
  await expect(row(page, "risk", "9")).toHaveAttribute("data-selected", "true");
  await expect(page.locator("[data-selected=\"true\"]")).toHaveCount(1);
  await expect(report(page)).toContainText("Risk 9");

  await page.goto("/alerts/movers/2026-10-16?kind=movers", { waitUntil: "domcontentloaded" });
  await expect(row(page, "movers", "2026-10-16")).toHaveAttribute("data-selected", "true", { timeout: 30_000 });
  await expect(report(page)).toContainText("Yesterday's gainers 2026-10-16");

  for (const path of ["/alerts/risk/999", "/alerts/weather/1", "/alerts/risk", "/alerts/risk/9/extra"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(report(page), path).toContainText("Record not found.", { timeout: 30_000 });
    await expect(page.locator("[data-selected=\"true\"]"), path).toHaveCount(0);
  }
});

test("CSV download content", async ({ page }) => {
  await open(page, "/alerts?kind=risk&from=2025-01-01&to=2026-12-31");
  await expect(rowsOf(page)).toHaveCount(3);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("moneyview-signals-risk-2025-01-01_2026-12-31.csv");
  const text = fs.readFileSync((await download.path())!, "utf8");
  expect(text.startsWith("﻿"), "a BOM so a spreadsheet reads the file as UTF-8").toBe(true);
  expect(text.slice(1).split("\r\n")).toEqual([
    "ID,Origin,Start date,Release date,Days,Theme count,Themes,Warnings on,Primary theme,5D after,10D after,20D after,Max further drop in 10D,vs −5%",
    "12,Live,2026-10-14,,4,3,\"Semiconductors, Philadelphia Semiconductor (SOX), AI infrastructure\",W1 W2 W3 W4,Semiconductors,,,,,Pending",
    "9,Computed from past data,2026-03-02,2026-03-20,14,1,Semiconductors,W1,Semiconductors,-3.1,-4.4,-2,-6.2,Beyond",
    "5,Live,2025-06-10,2025-06-30,14,2,\"AI infrastructure, Semiconductors\",W2 W5,AI infrastructure,-2.123456789,-7.4123456,1.5,-7.4123456,Beyond",
    "",
  ]);

  // With no dates set, the name carries the first and last day of the rows shown.
  await kindButton(page, "Surge").click();
  await page.getByLabel("From", { exact: true }).fill("");
  await page.getByLabel("To", { exact: true }).fill("");
  await expect(rowsOf(page)).toHaveCount(3);
  const [second] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(second.suggestedFilename()).toBe("moneyview-signals-surge-2026-05-04_2026-10-16.csv");
  expect(fs.readFileSync((await second.path())!, "utf8").split("\r\n")).toHaveLength(5);
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`no page scroll at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    for (const path of ["/alerts", "/alerts/movers/2026-10-16?kind=movers", "/alerts/surge/42?kind=surge&shown=1"]) {
      await open(page, path);
      await page.evaluate(() => document.fonts.ready);
      await expectNoPageScroll(page, `${path} at ${viewport.width}x${viewport.height}`);
    }
  });
}
