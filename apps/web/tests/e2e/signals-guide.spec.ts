import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { en } from "../../lib/i18n/messages/en";
import { ko } from "../../lib/i18n/messages/ko";
import { mockSignalsApi } from "./helpers/signalsApiMock";

// Spec 2026-11-01 signals guide: A/B/C carry their names wherever a probability shows, and a closed
// "How to read this screen" panel explains the page.

test("the guide starts closed and opens to the A, B and C definitions", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  const guide = page.getByTestId("page-guide");
  await expect(guide).toBeVisible({ timeout: 60_000 });
  await expect(guide).not.toHaveAttribute("open", "");
  await expect(guide.getByText("C Bear market:")).toBeHidden();

  await guide.getByText("How to read this screen").click();
  await expect(guide).toHaveAttribute("open", "");
  await expect(guide.getByRole("heading", { name: "Scenarios A, B and C" })).toBeVisible();
  await expect(guide.getByText("C Bear market:")).toBeVisible();
});

test("every probability in the summary carries its scenario name, and the letter stays alone in most-likely", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("prob-a")).toContainText("A Upside", { timeout: 60_000 });
  await expect(page.getByTestId("prob-b")).toContainText("B Correction");
  await expect(page.getByTestId("prob-c")).toContainText("C Bear market");
  await expect(page.getByTestId("most-likely")).toHaveText("B");
  await expect(page.getByTestId("most-likely-name")).toHaveText("Correction");
});

test("the trend chart legend names each scenario", async ({ page }) => {
  await mockSignalsApi(page);
  await page.goto("/signals", { waitUntil: "domcontentloaded" });
  const legend = page.getByTestId("trend-chart").locator(".recharts-legend-wrapper");
  await expect(legend).toContainText("A Upside", { timeout: 60_000 });
  await expect(legend).toContainText("C Bear market");
});

test.describe("ko", () => {
  test.use({ locale: "ko-KR" });

  test("the names and the guide read in Korean", async ({ page }) => {
    await mockSignalsApi(page);
    await page.goto("/signals", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("prob-c")).toContainText("C 급락·약세장", { timeout: 60_000 });
    await page.getByTestId("page-guide").getByText("이 화면 읽는 법").click();
    await expect(page.getByTestId("page-guide").getByRole("heading", { name: "시나리오 A·B·C" })).toBeVisible();
  });
});

test("every rule in rules.yaml has a guide line in both catalogs", () => {
  const yaml = fs.readFileSync(path.join(__dirname, "../../../api/services/signals/rules.yaml"), "utf-8");
  const ids = [...yaml.matchAll(/^\s+- id: (\S+)/gm)].map((match) => match[1]);
  expect(ids.length).toBe(11);
  for (const catalog of [en, ko]) {
    const rules = catalog.signals.guide.rules as Record<string, string>;
    expect(Object.keys(rules).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(rules[id].trim().length, id).toBeGreaterThan(0);
  }
});
