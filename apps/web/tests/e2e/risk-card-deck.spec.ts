import { expect, test, type Locator, type Page } from "@playwright/test";
import type { RiskLatest } from "../../../../packages/shared-types";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import {
  ALERT, LATEST, MOVERS, SURGE_BANNER, candidateCard, crashCard, deck, markSignalsSeen, mockRisk,
} from "./helpers/riskApiMock";

// Risk UI spec §3.2 and plan Task 3: the card deck and the four card renderers, tested through the
// real signal panel (Ruling U2: the repo has no test-harness page).
const strip = (page: Page) => page.getByTestId("signal-strip");
const panel = (page: Page) => page.getByRole("dialog");
const cardDeck = (page: Page) => panel(page).getByTestId("card-deck");
const front = (page: Page) => cardDeck(page).getByTestId("deck-card");
const position = (page: Page) => cardDeck(page).getByTestId("deck-position");

const withAlert = (alert: Partial<typeof ALERT>, rest: Partial<RiskLatest> = {}): RiskLatest =>
  ({ ...LATEST.risk, ...rest, alert: { ...ALERT, ...alert } });

async function openPanel(page: Page, latest: RiskLatest) {
  await mockMarketPageApi(page);
  await mockRisk(page, latest);
  await markSignalsSeen(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(strip(page)).not.toHaveAttribute("data-state", "loading", { timeout: 60_000 });
  await strip(page).click();
  await expect(panel(page)).toBeVisible();
}

async function drag(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 4 });
  await page.mouse.move(x + dx, y, { steps: 4 });
  await page.mouse.up();
}

test("deck keys and buttons move", async ({ page }) => {
  await openPanel(page, withAlert({ crash: deck(3, crashCard) }));
  const next = cardDeck(page).getByRole("button", { name: "Next card" });
  const prev = cardDeck(page).getByRole("button", { name: "Previous card" });
  await expect(front(page)).toContainText("CR1");
  await expect(prev).toBeDisabled();

  await cardDeck(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(front(page)).toContainText("CR2");
  await next.click();
  await expect(front(page)).toContainText("CR3");
  await expect(next).toBeDisabled();
  await prev.click();
  await expect(front(page)).toContainText("CR2");
  await cardDeck(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(front(page)).toContainText("CR1");

  // Pointer drag: 80px past the 48px threshold moves one card; the drag is not a click on the card.
  await drag(page, front(page), -80);
  await expect(front(page)).toContainText("CR2");
  await drag(page, front(page), 80);
  await expect(front(page)).toContainText("CR1");
  // At the first card a further drag moves nothing; it is still a drag, not a click that opens the stock.
  const detailRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/detail/")) detailRequests.push(request.url());
  });
  await drag(page, front(page), 80);
  await page.waitForTimeout(1_000);
  expect(detailRequests, "an edge drag does not navigate").toEqual([]);
  await expect(front(page)).toContainText("CR1");
  await drag(page, front(page), -30);
  await expect(page).toHaveURL(/\/detail\/CR1$/);
});

test("the next card peeks behind the front card", async ({ page }) => {
  await openPanel(page, withAlert({ crash: deck(2, crashCard) }));
  const peek = cardDeck(page).getByTestId("deck-peek");
  await expect(peek).toHaveAttribute("aria-hidden", "true");
  await expect(peek).toContainText("CR2");
  const frontBox = (await front(page).boundingBox())!;
  const peekBox = (await peek.boundingBox())!;
  expect(peekBox.x + peekBox.width, "the peek shows past the front card's right edge").toBeGreaterThan(frontBox.x + frontBox.width);
  await cardDeck(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(peek).toHaveCount(0);
});

test("position text", async ({ page }) => {
  await openPanel(page, withAlert({ crash: deck(3, crashCard) }));
  await expect(cardDeck(page)).toHaveAttribute("aria-roledescription", "carousel");
  await expect(position(page)).toHaveText("1 / 3");
  await expect(position(page)).toHaveAttribute("aria-live", "polite");
  await expect(position(page)).toHaveClass(/type-mono/);
  await cardDeck(page).getByRole("button", { name: "Next card" }).click();
  await expect(position(page)).toHaveText("2 / 3");
});

test.describe("more card only above 10", () => {
  for (const total of [0, 1, 10, 11]) {
    test(`${total} cards`, async ({ page }) => {
      await openPanel(page, withAlert({ crash: deck(total, crashCard) }));
      if (total === 0) {
        await expect(panel(page).getByText("No stocks here right now.")).toBeVisible();
        await expect(cardDeck(page)).toHaveCount(0);
        return;
      }
      const slots = total > 10 ? 11 : total;
      await expect(position(page)).toHaveText(`1 / ${slots}`);
      await cardDeck(page).focus();
      for (let i = 1; i < slots; i += 1) await page.keyboard.press("ArrowRight");
      await expect(position(page)).toHaveText(`${slots} / ${slots}`);
      await expect(cardDeck(page).getByRole("button", { name: "Next card" })).toBeDisabled();
      const more = cardDeck(page).getByTestId("deck-more");
      if (total <= 10) {
        await expect(more).toHaveCount(0);
        await expect(front(page)).toContainText(`CR${total}`);
        return;
      }
      await expect(more).toHaveText("View all 11");
      await expect(more).toHaveAttribute("href", `/alerts/risk/${ALERT.id}`);
      await more.click();
      await expect(page).toHaveURL(new RegExp(`/alerts/risk/${ALERT.id}$`));
    });
  }
});

test("stock card goes to detail", async ({ page }) => {
  await openPanel(page, withAlert({ crash: deck(3, crashCard), candidates: deck(1, candidateCard) }));
  await front(page).click();
  await expect(page).toHaveURL(/\/detail\/CR1$/);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await strip(page).click();
  await cardDeck(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/detail\/CR2$/);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await strip(page).click();
  await panel(page).getByRole("tab", { name: "At risk 1" }).click();
  await front(page).click();
  await expect(page).toHaveURL(/\/detail\/CA1$/);
});

test("surge card goes to its event record", async ({ page }) => {
  await openPanel(page, { ...LATEST.neutral, surge: SURGE_BANNER });
  await panel(page).getByRole("tab", { name: "Surge 3" }).click();
  await expect(front(page)).toContainText("Semiconductors");
  await front(page).click();
  await expect(page).toHaveURL(new RegExp(`/alerts/surge/${SURGE_BANNER.themes[0].event_id}$`));
});

test("mover deck: the footnote shows once and a card goes to detail", async ({ page }) => {
  await openPanel(page, { ...LATEST.neutral, movers: { as_of: "2026-10-19", items: MOVERS } });
  await panel(page).getByRole("tab", { name: "Yesterday's gainers 5" }).click();
  await expect(panel(page).getByText("Yesterday's result, not a forecast.")).toHaveCount(1);
  await expect(front(page)).not.toContainText("Yesterday's result, not a forecast.");
  await cardDeck(page).getByRole("button", { name: "Next card" }).click();
  await expect(front(page)).toContainText("MV2");
  await front(page).click();
  await expect(page).toHaveURL(/\/detail\/MV2$/);
});

test("card contents follow spec §3.2", async ({ page }) => {
  await openPanel(page, withAlert(
    { crash: deck(2, crashCard), candidates: deck(1, candidateCard) },
    { surge: SURGE_BANNER, movers: { as_of: "2026-10-19", items: MOVERS } },
  ));
  // Crash: ticker, name, theme named from the watchlist list, 20-day drawdown with ▼ and -, high date, 30-day line, headlines.
  await expect(front(page)).toContainText("CR1");
  await expect(front(page)).toContainText("Crash Stock 1");
  await expect(front(page)).toContainText("Semiconductors");
  await expect(front(page)).toContainText("From 20-day high");
  await expect(front(page).getByTestId("delta-badge")).toHaveText(/▼\s*-29\.0%/);
  await expect(front(page)).toContainText("High 2026-09-25");
  await expect(front(page).locator(".recharts-line-curve")).toHaveCount(1);
  await expect(front(page)).toContainText("Chip stocks slide on export curbs");
  // ^SOX is not in the watchlist list: its name comes from the alert's own label.
  await cardDeck(page).getByRole("button", { name: "Next card" }).click();
  await expect(front(page)).toContainText("Philadelphia Semiconductor (SOX)");

  await panel(page).getByRole("tab", { name: "At risk 1" }).click();
  await expect(front(page)).toContainText("Candidate Stock 1");
  await expect(front(page)).toContainText("AI infrastructure");
  await expect(front(page)).toContainText("From 63-day high");
  await expect(front(page).getByTestId("delta-badge")).toHaveText(/▼\s*-0\.7%/);
  await expect(front(page)).toContainText("Correlation with SOX 0.85");

  await panel(page).getByRole("tab", { name: "Surge 3" }).click();
  await expect(front(page)).toContainText("Semiconductors");
  await expect(front(page)).toContainText("Started 2026-10-16");
  for (const label of ["magnitude", "accel", "breadth", "rsi"]) await expect(front(page)).toContainText(label);
  await expect(front(page).locator('[data-part="components"] .type-mono')).toHaveText(["2.40", "0.97", "80.0%", "68.0"]);
  await expect(front(page).locator('[data-part="leader"]')).toHaveCount(5);
  await expect(front(page)).toContainText("Leaders on the start day");

  await panel(page).getByRole("tab", { name: "Yesterday's gainers 5" }).click();
  await expect(front(page)).toContainText("1");
  await expect(front(page)).toContainText("Mover Stock 1");
  await expect(front(page)).toContainText("Robotics");
  await expect(front(page).getByTestId("delta-badge")).toHaveText([/▲\s*\+9\.0%/, /▲\s*\+11\.0%/]);
  await expect(front(page)).toContainText("RSI 69.0");
});
