import { expect, test, type Page } from "@playwright/test";
import { formatNumber } from "../../lib/format";

// Bench values (app/dev/design/page.tsx): price 71,200.50 -> 72,350.75 -> 69,980.25 -> 105,000.00.
const PRICE = ["71,200.50", "72,350.75", "69,980.25", "105,000.00"];
// Bench percent steps for the DeltaBadge animate (motion-delta): 1.24 -> -0.87 -> 12.5 -> -3.4.
const BENCH_PCT = [1.24, -0.87, 12.5, -3.4];

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

// Sparkline draw (motion-spark-draw): recharts 3 draws the line in JS, setting stroke-dasharray on
// the curve every frame, so record every distinct dash value the curve gets from the first node on.
async function recordDraw(page: Page) {
  await page.addInitScript(() => {
    const dashes: string[] = [];
    (window as unknown as { __dash: string[] }).__dash = dashes;
    const read = () => {
      const v = document.querySelector('[data-testid="motion-spark-draw"] .recharts-line-curve')?.getAttribute("stroke-dasharray");
      if (v && dashes[dashes.length - 1] !== v) dashes.push(v);
    };
    new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true });
  });
}

const drawn = (page: Page) => page.evaluate(() => (window as unknown as { __dash: string[] }).__dash);

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
    await page.waitForTimeout(700);
    await page.getByTestId("motion-next").click();
    // The first roll (600ms + 7 digit staggers of 45ms) ends ~915ms after the first click and the second ~1615ms:
    // at 1150ms a stale timer from the first roll would already have ended the second one.
    await page.waitForTimeout(450);
    await expect(price).toHaveAttribute("data-rolling", "true");
    await page.waitForTimeout(950);
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

  test("before/after marks the old value as a deletion and the new one as an insertion", async ({ page }) => {
    await open(page);
    const ba = page.getByTestId("motion-before-after");
    await page.getByTestId("motion-next").click();
    await expect(ba.locator("del")).toHaveText(PRICE[0]);
    await expect(ba.locator("ins")).toContainText(PRICE[1]);
    const snapshot = await ba.ariaSnapshot();
    expect(snapshot).toMatch(/deletion/);
    expect(snapshot).toMatch(/insertion/);
  });

  test("the bench DeltaBadge rolls on Next value and ends at the formatted percent", async ({ page }) => {
    await open(page);
    const value = page.getByTestId("motion-delta").locator('[data-part="value"]');
    await page.getByTestId("motion-next").click();
    await expect(value.locator(".mv-dg").first()).toBeVisible({ timeout: 200 });
    await page.waitForTimeout(1500);
    await expect(value.locator(".mv-dg")).toHaveCount(0);
    await expect(value).toHaveText(formatNumber(BENCH_PCT[1] / 100, "percent", { signed: true }));
  });

  test("a changed value washes its background up-soft or down-soft, then fades it out", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.waitForTimeout(1000);
    const bg = () => price.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg()).toBe("rgba(0, 0, 0, 0)");
    await page.getByTestId("motion-next").click();
    await page.waitForTimeout(100);
    expect(await bg()).not.toBe("rgba(0, 0, 0, 0)");
    await page.waitForTimeout(1100);
    expect(await bg()).toBe("rgba(0, 0, 0, 0)");
  });

  test("an enter figure's first painted text is the zeros form, never the final text", async ({ page }) => {
    await page.addInitScript(() => {
      const seen = { texts: [] as string[], rolling: [] as string[] };
      (window as unknown as { __mv: typeof seen }).__mv = seen;
      const read = () => {
        const el = document.querySelector('[data-testid="motion-roll-enter"]');
        if (!el) return;
        const t = el.textContent ?? "";
        if (seen.texts[seen.texts.length - 1] !== t) seen.texts.push(t);
        const r = el.getAttribute("data-rolling") ?? "";
        if (seen.rolling[seen.rolling.length - 1] !== r) seen.rolling.push(r);
      };
      new MutationObserver(read).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await open(page);
    await page.waitForTimeout(1200);
    const { texts, rolling } = await seen(page);
    expect(rolling[0]).toBe("true");
    expect(texts[0]).not.toBe(PRICE[0]);
    expect(texts[texts.length - 1]).toBe(PRICE[0]);
  });

  test("the Sparkline draw line runs its draw on mount", async ({ page }) => {
    await recordDraw(page);
    await page.goto("/dev/design");
    await expect(page.getByTestId("motion-spark-draw").locator(".recharts-line-curve")).toBeAttached();
    await page.waitForTimeout(900);
    const dashes = await drawn(page);
    // A draw passes through intermediate lengths: more than a start and an end value.
    expect(dashes.length).toBeGreaterThanOrEqual(3);
    expect(dashes[0]).not.toEqual(dashes[dashes.length - 1]);
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

  test("a changed value never washes its background", async ({ page }) => {
    await open(page);
    const price = page.getByTestId("motion-roll-price");
    await page.getByTestId("motion-next").click();
    for (let i = 0; i < 5; i++) {
      expect(await price.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
      await page.waitForTimeout(30);
    }
  });

  test("the Sparkline draw line never draws and the bench DeltaBadge never rolls", async ({ page }) => {
    await recordDraw(page);
    await open(page);
    await page.getByTestId("motion-next").click();
    await page.waitForTimeout(900);
    expect(await drawn(page)).toEqual([]);
    await expect(page.getByTestId("motion-delta").locator(".mv-dg")).toHaveCount(0);
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

// Tabs indicator and ScanReveal, on the market page tabs ("/").
const TAB_IDS = ["market-tab-instruments", "market-tab-spreads"];

async function expectIndicatorUnderSelected(page: Page) {
  const selected = await page.locator('[role="tab"][aria-selected="true"]').first().boundingBox();
  const indicator = await page.getByTestId("tabs-indicator").first().boundingBox();
  expect(selected).not.toBeNull();
  expect(indicator).not.toBeNull();
  expect(Math.abs(indicator!.x - selected!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(indicator!.width - selected!.width)).toBeLessThanOrEqual(1);
}

const runningScan = (page: Page) =>
  page.evaluate(
    () => document.querySelector('[data-testid="scan-line"]')?.getAnimations().some((a) => a.playState === "running") ?? false
  );

test.describe("tabs indicator and scan reveal, motion on", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  test("the indicator sits under each tab after it is clicked", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("market-page-tabs")).toBeVisible();
    for (const id of [...TAB_IDS, TAB_IDS[0]]) {
      await page.locator(`#${id}`).click();
      await page.waitForTimeout(600);
      await expectIndicatorUnderSelected(page);
    }
  });

  test("at 390px the indicator follows the selected tab after a resize from 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    // Real tab geometry does not depend on the viewport, so make it depend on it: only a recompute on resize can follow.
    await page.addStyleTag({ content: '[role="tab"]{ width: 20vw; justify-content: center; }' });
    await page.locator(`#${TAB_IDS[1]}`).click();
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await expectIndicatorUnderSelected(page);
  });

  test("a tab switch runs the scan line", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("market-page-tabs")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await runningScan(page)).toBe(false);
    await page.locator(`#${TAB_IDS[1]}`).click();
    await expect.poll(() => runningScan(page), { timeout: 100, intervals: [10] }).toBe(true);
  });
});

test.describe("scan line overflow", () => {
  test.use({ contextOptions: { reducedMotion: "no-preference" } });

  // scrollHeight does not register the 1px overshoot in Chromium (it stayed equal to clientHeight even
  // with the line 1px past the panel), so the test measures the line against the panel's box, which is
  // what would add scrollable overflow.
  test("while the scan runs the line never extends below the panel", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(page.getByTestId("market-page-tabs")).toBeVisible();
    // A panel that just fits: the scan host fills it, so the line's end is the panel's end.
    await page.addStyleTag({ content: '[data-testid="market-page-tabs"] [role="tabpanel"] > div { height: 100%; }' });
    await page.waitForTimeout(300);
    // Precondition: the injected rule took effect, so the host's end is the panel's end (else the test is vacuous).
    const gap = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="market-page-tabs"] [role="tabpanel"]')!;
      const host = panel.firstElementChild!;
      return Math.abs(host.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom);
    });
    expect(gap).toBeLessThanOrEqual(0.5);
    await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="market-page-tabs"] [role="tabpanel"]')!;
      const w = window as unknown as { __below: number[] };
      w.__below = [];
      const start = performance.now();
      const tick = () => {
        const line = document.querySelector('[data-testid="scan-line"]')!.getBoundingClientRect();
        w.__below.push(line.bottom - panel.getBoundingClientRect().bottom);
        if (performance.now() - start < 1500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.locator(`#${TAB_IDS[1]}`).click();
    await page.waitForTimeout(1600);
    const below = await page.evaluate(() => (window as unknown as { __below: number[] }).__below);
    expect(below.length).toBeGreaterThan(20);
    expect(Math.max(...below)).toBeLessThanOrEqual(0.5);
  });
});

test.describe("tabs indicator and scan reveal, reduced motion", () => {
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  test("the indicator still sits under the tab and the scan line never animates", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("market-page-tabs")).toBeVisible();
    await page.locator(`#${TAB_IDS[1]}`).click();
    for (let i = 0; i < 8; i++) {
      expect(await runningScan(page)).toBe(false);
      await page.waitForTimeout(50);
    }
    await expectIndicatorUnderSelected(page);
  });
});
