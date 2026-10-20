import { expect, test, type Page } from "@playwright/test";
import { tokens } from "../../lib/tokens.generated";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { expectNoPageScroll } from "./helpers/noPageScroll";
import { mockRisk, type RiskScenario } from "./helpers/riskApiMock";

// Risk UI spec §2 and plan Task 2: the always-on signal strip at the top of "/".
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const strip = (page: Page) => page.getByTestId("signal-strip");

async function gotoWith(page: Page, scenario: RiskScenario) {
  await mockMarketPageApi(page);
  await mockRisk(page, scenario);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(strip(page)).toBeVisible({ timeout: 60_000 });
  // The strip is client-fetched: leaving "loading" means the page has hydrated and the mock answered.
  await expect(strip(page)).not.toHaveAttribute("data-state", "loading", { timeout: 30_000 });
}

const PLAIN = { ground: tokens.surface.raised, edge: tokens.line._ };
const CASES: { scenario: RiskScenario; state: string; ground: string; edge: string; texts: string[]; absent: string[] }[] = [
  {
    scenario: "neutral", state: "neutral", ...PLAIN,
    texts: ["Warnings on 2/6", "Top gainer yesterday: Micron Technology", "+6.4%", "Surge themes 1"],
    absent: ["Risk signal detected", "Strong rise confirmed"],
  },
  {
    scenario: "risk", state: "risk", ground: tokens.down.soft, edge: tokens.down._,
    texts: ["Risk signal detected", "3 themes: Semiconductor equipment and materials", "since 2026-10-14", "Warnings on 4/6"],
    absent: ["Surge 2", "Strong rise confirmed"],
  },
  {
    scenario: "surge", state: "surge", ground: tokens.up.soft, edge: tokens.up._,
    texts: ["Strong rise confirmed", "Semiconductors, Philadelphia Semiconductor (SOX)", "since 2026-10-16"],
    absent: ["Robotics", "Risk signal detected"],
  },
  {
    scenario: "both", state: "risk", ground: tokens.down.soft, edge: tokens.down._,
    texts: ["Risk signal detected", "Warnings on 4/6", "Surge 2"],
    absent: ["Strong rise confirmed"],
  },
  { scenario: "pending", state: "pending", ...PLAIN, texts: ["Computing signals"], absent: ["Warnings on"] },
  { scenario: "error", state: "error", ...PLAIN, texts: ["Signals could not be loaded."], absent: [] },
];

test.describe("strip shows each state", () => {
  for (const c of CASES) {
    test(`${c.scenario}: copy, data-state and colour family`, async ({ page }) => {
      await gotoWith(page, c.scenario);
      await expect(strip(page)).toHaveAttribute("data-state", c.state);
      for (const text of c.texts) await expect(strip(page)).toContainText(text);
      for (const text of c.absent) await expect(strip(page)).not.toContainText(text);
      await expect(strip(page)).toHaveCSS("background-color", rgb(c.ground));
      await expect(strip(page)).toHaveCSS("border-top-color", rgb(c.edge));
      if (c.texts.some((text) => text.startsWith("Warnings on"))) {
        await expect(strip(page).locator('[data-part="warnings"] .type-mono')).toHaveText(/^\d\/6$/);
      }
    });
  }

  test("the surge chip sits at the end only when risk and surge are both on", async ({ page }) => {
    await gotoWith(page, "both");
    const chip = strip(page).locator('[data-part="surge-chip"]');
    await expect(chip).toHaveText("Surge 2");
    await expect(chip).toHaveCSS("color", rgb(tokens.up._));
    const chipBox = (await chip.boundingBox())!;
    const textBox = (await strip(page).locator('[data-part="text"]').boundingBox())!;
    expect(chipBox.x, "the chip follows the text").toBeGreaterThanOrEqual(textBox.x + textBox.width);
  });
});

test.describe("strip truncates at 390", () => {
  test.use({ viewport: { width: 390, height: 844 }, locale: "ko-KR" });

  test("a long Korean risk line ends in an ellipsis and stays one row high", async ({ page }) => {
    await gotoWith(page, "pending");
    const oneRow = (await strip(page).boundingBox())!.height;

    await page.unrouteAll({ behavior: "ignoreErrors" });
    await gotoWith(page, "both");
    await expect(strip(page)).toContainText("위험 신호가 잡혔습니다");
    const text = strip(page).locator('[data-part="text"]');
    await expect(text).toHaveCSS("text-overflow", "ellipsis");
    await expect(text).toHaveCSS("white-space", "nowrap");
    const overflow = await text.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(overflow.scroll, "the line is longer than the strip, so it is cut").toBeGreaterThan(overflow.client);
    expect((await strip(page).boundingBox())!.height, "same height as a one-row strip").toBe(oneRow);
    await expect(strip(page).locator('[data-part="surge-chip"]')).toBeInViewport({ ratio: 1 });
    await expectNoPageScroll(page, "risk strip at 390");
  });
});

test("strip is a button and opens on Enter and Space", async ({ page }) => {
  await gotoWith(page, "risk");
  const button = page.getByRole("button", { name: /Risk signal detected/ });
  await expect(button).toHaveAttribute("data-testid", "signal-strip");
  await expect(button).toHaveAttribute("aria-haspopup", "dialog");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(strip(page)).toHaveAttribute("data-state", "risk", { timeout: 60_000 });
  await expect(strip(page)).toHaveAttribute("aria-expanded", "false");
  await strip(page).focus();
  await page.keyboard.press("Space");
  await expect(strip(page)).toHaveAttribute("aria-expanded", "true");
});
