import { expect, test, type Page } from "@playwright/test";

// The token build resets Tailwind's --color-*, --text-*, --shadow-* and --radius-* (moneyview.themeReset).
// These utilities are used in app/ and components/ and must keep working without a theme entry. Each
// test mounts one probe element with the utility on /dev/design and reads the computed style.
// Source of the list: git grep -nE "\b(bg|text|border)-(transparent|current|inherit)\b|rounded-full" -- app components

const TRANSPARENT = "rgba(0, 0, 0, 0)";

async function probe(page: Page, className: string, prop: string, inlineStyle = ""): Promise<string> {
  return page.evaluate(
    ([cls, p, style]) => {
      const el = document.createElement("div");
      el.className = cls;
      el.setAttribute("style", `width:10px;height:10px;border-style:solid;border-width:2px;${style}`);
      document.body.appendChild(el);
      const value = getComputedStyle(el).getPropertyValue(p);
      el.remove();
      return value;
    },
    [className, prop, inlineStyle] as const,
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto("/dev/design", { waitUntil: "networkidle" });
  await expect(page.locator("main")).toBeVisible({ timeout: 60_000 });
});

test("rounded-full gives a radius of at least 999px", async ({ page }) => {
  expect(parseFloat(await probe(page, "rounded-full", "border-top-left-radius"))).toBeGreaterThanOrEqual(999);
});

test("bg-transparent gives a transparent background", async ({ page }) => {
  expect(await probe(page, "bg-transparent", "background-color")).toBe(TRANSPARENT);
});

test("border-transparent gives a transparent border", async ({ page }) => {
  expect(await probe(page, "border-transparent", "border-top-color")).toBe(TRANSPARENT);
});

test("border-t-transparent gives a transparent top border only", async ({ page }) => {
  expect(await probe(page, "border-t-transparent", "border-top-color")).toBe(TRANSPARENT);
  expect(await probe(page, "border-t-transparent", "border-bottom-color")).not.toBe(TRANSPARENT);
});

test("bg-current takes the text colour", async ({ page }) => {
  expect(await probe(page, "bg-current", "background-color", "color:rgb(9, 8, 7);")).toBe("rgb(9, 8, 7)");
});

test("border-current takes the text colour", async ({ page }) => {
  expect(await probe(page, "border-current", "border-top-color", "color:rgb(9, 8, 7);")).toBe("rgb(9, 8, 7)");
});
