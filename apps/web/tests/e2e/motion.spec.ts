import { expect, test, type Page } from "@playwright/test";

// Bench values (app/dev/design/page.tsx): price 71,200.50 -> 72,350.75 -> 69,980.25 -> 105,000.00.
const PRICE = ["71,200.50", "72,350.75", "69,980.25", "105,000.00"];

// The page mounts on the client (the shell gates it on port discovery), so the server HTML holds no
// bench. What matters is what the first client paint shows: record every text and every rolling flag
// the price figure ever has, from the first node on.
async function record(page: Page) {
  await page.addInitScript(() => {
    const seen = { texts: [] as string[], rolling: [] as string[] };
    (window as unknown as { __mv: typeof seen }).__mv = seen;
    const read = () => {
      const el = document.querySelector('[data-testid="motion-roll-price"]');
      if (!el) return;
      const t = el.textContent ?? "";
      if (seen.texts[seen.texts.length - 1] !== t) seen.texts.push(t);
      const r = el.getAttribute("data-rolling") ?? "";
      if (seen.rolling[seen.rolling.length - 1] !== r) seen.rolling.push(r);
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

const seen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __mv: { texts: string[]; rolling: string[] } }).__mv);

async function open(page: Page) {
  await page.goto("/dev/design");
  await expect(page.getByTestId("motion-roll-price")).toHaveText(PRICE[0]);
}

test.describe("motion on", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("rolls then settles to plain text equal to the label", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.getByTestId("motion-next").click();
    await expect(price.locator(".mv-dg").first()).toBeVisible({ timeout: 200 });
    await page.waitForTimeout(1500);
    await expect(price.locator(".mv-dg")).toHaveCount(0);
    await expect(price).toHaveText(PRICE[1]);
    await expect(price).toHaveAttribute("aria-label", PRICE[1]);
    await expect(price).toHaveAttribute("data-rolling", "false");
  });

  test("the label is final while digits are rolling", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.getByTestId("motion-next").click();
    await expect(price.locator(".mv-dg").first()).toBeVisible({ timeout: 200 });
    await expect(price).toHaveAttribute("aria-label", PRICE[1]);
    await expect(price).toHaveAttribute("data-rolling", "true");
  });

  test("nothing rolls on load: the first paint is the final text and the flag never turns on", async ({ page }) => {
    await record(page);
    await open(page);
    await page.waitForTimeout(900);
    const { texts, rolling } = await seen(page);
    expect(texts).toEqual([PRICE[0]]);
    expect(rolling).toEqual(["false"]);
  });

  test("an equal value re-renders the bench but does not roll", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    // Wait out any load-time roll so only the click is under test.
    await page.waitForTimeout(1000);
    await expect(price).toHaveAttribute("data-rolling", "false");
    const bench = page.getByTestId("gallery-motion");
    await expect(bench).toHaveAttribute("data-tick", "0");
    await page.getByTestId("motion-same").click();
    // The click really re-rendered the bench with the same value.
    await expect(bench).toHaveAttribute("data-tick", "1");
    await page.waitForTimeout(300);
    await expect(price.locator(".mv-dg")).toHaveCount(0);
    await expect(price).toHaveAttribute("data-rolling", "false");
    await expect(price).toHaveText(PRICE[0]);
  });

  test("a change mid-roll restarts from the last target and lands on the newest value", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.getByTestId("motion-next").click();
    await page.waitForTimeout(100);
    await page.getByTestId("motion-next").click();
    await page.waitForTimeout(1500);
    await expect(price.locator(".mv-dg")).toHaveCount(0);
    await expect(price).toHaveText(PRICE[2]);
    await expect(price).toHaveAttribute("aria-label", PRICE[2]);
  });

  test("a missing value shows a dash and never rolls, the next value rolls in", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.getByTestId("motion-missing").click();
    await expect(price).toHaveText("—");
    await page.waitForTimeout(300);
    await expect(price.locator(".mv-dg")).toHaveCount(0);
    await page.getByTestId("motion-next").click();
    await expect(price.locator(".mv-dg").first()).toBeVisible({ timeout: 200 });
    await page.waitForTimeout(1500);
    await expect(price).toHaveText(PRICE[1]);
  });

  test("before/after shows the previous string struck, an arrow and the current one", async ({ page }) => {
    await open(page);
    const ba = page.getByTestId("motion-before-after");
    await page.getByTestId("motion-next").click();
    await expect(ba).toContainText(PRICE[0]);
    await expect(ba).toContainText("→");
    await expect(ba).toContainText(PRICE[1]);
    await expect(ba.locator('[data-part="strike"]')).toHaveCount(1);
  });
});

test.describe("reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("values update at once and no digit window ever appears", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.getByTestId("motion-next").click();
    await expect(price).toHaveText(PRICE[1], { timeout: 100 });
    for (let i = 0; i < 5; i++) {
      await expect(page.locator(".mv-dg")).toHaveCount(0);
      await page.waitForTimeout(50);
    }
    await expect(price).toHaveAttribute("data-rolling", "false");
  });
});

test("loading the gallery logs no console hydration error (the shell renders page content client-only, so this cannot detect SSR zeros; the first-paint test above does)", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/dev/design");
  await expect(page.getByTestId("motion-roll-price")).toBeVisible();
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});
