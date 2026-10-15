import { expect, test } from "@playwright/test";
import { mockValuationApi } from "./helpers/valuationPageMock";

const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

test("ground, ink and Hangul line breaking are the paper base", async ({ page }) => {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#app-topnav")).toBeVisible({ timeout: 60_000 });
  const body = await page.evaluate(() => {
    const s = getComputedStyle(document.body);
    return { bg: s.backgroundColor, color: s.color, wordBreak: s.wordBreak };
  });
  expect(body).toEqual({ bg: rgb("#ffffff"), color: rgb("#282828"), wordBreak: "keep-all" });
});

test("keyboard focus draws the 2px brand ring", async ({ page }) => {
  await mockValuationApi(page);
  await page.goto("/valuation", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    const probe = document.createElement("button");
    probe.id = "focus-probe";
    probe.textContent = "probe";
    document.body.prepend(probe);
  });
  await page.keyboard.press("Tab");
  const ring = await page.locator("#focus-probe").evaluate((el) => {
    const s = getComputedStyle(el);
    return { focused: document.activeElement === el, style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor };
  });
  expect(ring).toEqual({ focused: true, style: "solid", width: "2px", color: rgb("#fa3600") });
});

test.describe("at 1000px wide", () => {
  test.use({ viewport: { width: 1000, height: 800 } });
  test("the desktop layout applies (lg = 992px)", async ({ page }) => {
    await mockValuationApi(page);
    await page.goto("/valuation", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#app-topnav")).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("main")).toHaveCSS("padding-left", "32px");
  });
});
