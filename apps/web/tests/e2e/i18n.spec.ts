import { expect, test } from "@playwright/test";
import { mockMarketPageApi } from "./helpers/marketPageMock";

test("switching to Korean relabels the nav, sets <html lang> and survives reload", async ({ page }) => {
  await mockMarketPageApi(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Valuation" })).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.getByRole("link", { name: "가치평가" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await page.reload();
  await expect(page.getByRole("link", { name: "가치평가" })).toBeVisible();
});

test.describe("ko browser", () => {
  test.use({ locale: "ko-KR" });
  test("defaults to Korean without a stored choice", async ({ page }) => {
    await mockMarketPageApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "시장 개요" })).toBeVisible();
  });
});

test("bilingual headers show both languages and expose only the active one", async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
  const table = page.getByTestId("gallery-table");
  const header = table.locator("th").first();
  await expect(header.locator('[lang="ko"]')).toHaveText("종목");
  await expect(header.locator('[lang="en"]')).toHaveText("Name");
  await expect(header.locator('[lang="ko"]')).toBeVisible();
  await expect(header.locator('[lang="en"]')).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Name", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(table.getByRole("columnheader", { name: "종목", exact: true })).toBeVisible();
  await expect(header.locator('[lang="en"]')).toBeVisible();
});

test("caption text is 12px in Hangul and 11px in Latin, in either locale", async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
  const sizes = () => page.getByTestId("gallery-eyebrow").evaluate((el) => ({
    ko: getComputedStyle(el.querySelector('[lang="ko"]')!).fontSize,
    en: getComputedStyle(el.querySelector('[lang="en"]')!).fontSize,
  }));
  expect(await sizes()).toEqual({ ko: "12px", en: "11px" });
  await page.getByRole("button", { name: "한국어" }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  expect(await sizes()).toEqual({ ko: "12px", en: "11px" });
});

test.describe("ko browser hydration", () => {
  test.use({ locale: "ko-KR" });
  test("a Korean first visit hydrates without a mismatch and keeps the choice on reload", async ({ page }) => {
    const hydrationProblems: string[] = [];
    page.on("console", (message) => {
      if (/hydrat|did not match|server rendered/i.test(message.text())) hydrationProblems.push(message.text());
    });
    page.on("pageerror", (error) => {
      if (/hydrat|did not match|server rendered/i.test(error.message)) hydrationProblems.push(error.message);
    });
    await mockMarketPageApi(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "시장 개요" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ko");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: "시장 개요" })).toBeVisible();
    expect(hydrationProblems).toEqual([]);
  });
});

// This probe is the only guard for the `.type-caption:lang(ko)` selector: the caption test above
// does not catch its removal (the gallery never puts lang="ko" on the .type-caption element itself).
// Do not delete it as redundant.
test("Latin inside a Korean caption is still 11px, and the Hangul caption is 12px", async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "domcontentloaded" });
  const sizes = await page.evaluate(() => {
    const wrap = document.createElement("div");
    wrap.id = "caption-probe";
    wrap.className = "type-caption";
    wrap.setAttribute("lang", "ko");
    wrap.innerHTML = '<span lang="en">NAME</span>';
    document.body.append(wrap);
    return {
      ko: getComputedStyle(wrap).fontSize,
      en: getComputedStyle(wrap.querySelector("span")!).fontSize,
    };
  });
  expect(sizes).toEqual({ ko: "12px", en: "11px" });
});

test("html lang follows the stored locale while the backend is still starting", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("moneyview.locale", "ko"));
  await page.route("**/api/v1/health", (route) => route.abort());
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Starting Core Analytics..." })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});

test.describe("ko shared error state", () => {
  test.use({ locale: "ko-KR" });
  test("the shared ErrorState title and retry label are Korean on a failed dev performance load", async ({ page }) => {
    await page.route("**/performance/requests*", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.goto("/dev/performance", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("문제가 발생했습니다", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  });
});
