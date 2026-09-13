import { expect, test, type Page } from "@playwright/test";
import { stableInkProfile } from "./helpers/chartInk";

/**
 * The section's contract is that a reader can never see a theme figure without seeing what
 * produced it, and that a refused pair is visibly refused rather than absent or flat.
 */

// Market Overview renders from `apps/web/app/page.tsx`, so its route is `/` and not
// `/market`. Every existing spec for this page (market-overview.spec.ts) uses `/` too.
async function mockSpreads(page: Page, rows: unknown[]) {
  await page.route("**/api/v1/market/spreads**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
}

function computed(overrides: Record<string, unknown> = {}) {
  return {
    id: "ai", label: "AI", numerator: "BOTZ", denominator: "^GSPC",
    requested_window_days: 90,
    actual_window_start: "2026-06-15", actual_window_end: "2026-09-11",
    actual_window_days: 88, observations: 62,
    basis: "(BOTZ_t / BOTZ_0) / (^GSPC_t / ^GSPC_0) x 100, indexed to 100 at 2026-06-15",
    series: [{ date: "2026-06-15", value: 100 }, { date: "2026-09-11", value: 103.4 }],
    latest: 103.4, refused_reason: null,
    ...overrides,
  };
}

function refused(overrides: Record<string, unknown> = {}) {
  return {
    ...computed(),
    id: "defence", label: "Defence", numerator: "ITA", denominator: "^GSPC",
    actual_window_start: null, actual_window_end: null, actual_window_days: null,
    observations: 0, series: [], latest: null,
    refused_reason: "insufficient overlapping history",
    ...overrides,
  };
}

test("every spread card names the tickers and window that produced it", async ({ page }) => {
  // A figure labelled "AI +3.4%" asserts a fact about AI. "BOTZ vs ^GSPC" lets a reader
  // reject the proxy instead.
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("BOTZ");
  await expect(card).toContainText("^GSPC");
  await expect(card).toContainText("90d");
});

test("a refused pair keeps its card and shows the reason", async ({ page }) => {
  // Not an empty chart, not a line flat at 100 -- which is indistinguishable from a real
  // result showing no relative movement -- and never hidden.
  await mockSpreads(page, [computed(), refused()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-defence");
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText("Unavailable");
  await expect(card).toContainText("insufficient overlapping history");
  await expect(card).toContainText("ITA");
  await expect(card.getByTestId("spread-chart-defence")).toHaveCount(0);
  await expect(card).not.toContainText("100.0");
});

test("a computed pair renders its latest value and its chart", async ({ page }) => {
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("spread-card-ai");
  await expect(card).toContainText("103.4");
  await expect(card.getByTestId("spread-chart-ai")).toBeVisible();
});

const IRAN_EVENT = [{
  id: "us-iran-strikes-begin-2026-02-28",
  label: "U.S. strikes on Iran begin",
  category: "geopolitical",
  start_date: "2026-02-28",
  end_date: null,
  source: "https://example.com/timeline",
  note: "",
}];

async function mockEvents(page: Page, events: unknown[] = IRAN_EVENT) {
  await page.route("**/api/v1/market/events**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events) });
  });
}

test("the spreads section has its own event toggle that changes what is painted", async ({ page }) => {
  // The assertion is the ink diff, not aria-pressed: a button whose state flips while the chart
  // ignores it would satisfy an attribute-only check.
  //
  // IRAN_EVENT's date (2026-02-28) predates computed()'s window (2026-06-15 to 2026-09-11)
  // entirely, so eventCoordinate (EventLinesPrimitive.ts) never finds a bracketing bar and no
  // line is drawn regardless of whether the toggle is wired correctly -- confirmed by
  // temporarily widening the window, which made the assertion pass. Use the window's own
  // first bar date instead, so the event always resolves to a coordinate.
  await mockEvents(page, [{ ...IRAN_EVENT[0], start_date: "2026-06-15" }]);
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const toggle = page.getByTestId("spreads-events-toggle");
  await expect(toggle).toBeVisible({ timeout: 60_000 });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const selector = '[data-testid="spread-chart-ai"]';
  const withLine = await stableInkProfile(page, selector);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const withoutLine = await stableInkProfile(page, selector);

  const changed = withLine.ink.filter((value, index) => value !== (withoutLine.ink[index] ?? 0));
  expect(changed.length, "toggling must change what is painted, not just the button").toBeGreaterThan(0);
});

test("the index detail chart has its own event toggle that changes what is painted", async ({ page }) => {
  // This toggle lives inside MarketDetailModal, so the modal must be open for it to exist at all.
  await mockEvents(page);
  await mockSpreads(page, [computed()]);
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await page.getByText("Oil (WTI)").first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 60_000 });

  const toggle = dialog.getByTestId("market-events-toggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const selector = '[role="dialog"] [data-testid="tv-chart"]';
  const withLine = await stableInkProfile(page, selector);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  const withoutLine = await stableInkProfile(page, selector);

  const changed = withLine.ink.filter((value, index) => value !== (withoutLine.ink[index] ?? 0));
  expect(changed.length, "toggling must change what is painted, not just the button").toBeGreaterThan(0);
});
