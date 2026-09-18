import { expect, test, type Page } from "@playwright/test";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel } from "./helpers/portfolioPanels";

type Status = {
  enabled: boolean; pc_id: string | null;
  peers: Array<{ pc_id: string; written_at: string }>;
  skipped_files: Array<{ name: string; reason: string }>;
  last_sync_at: string | null; last_error: string | null;
};

const OFF: Status = { enabled: false, pc_id: null, peers: [], skipped_files: [], last_sync_at: null, last_error: null };

async function openWith(page: Page, status: Status) {
  await mockPortfolioPageApi(page);
  await page.route("**/api/v1/portfolio/watchlist/peer-sync", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: status }) }),
  );
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("grid-count")).toBeVisible();
}

const line = (page: Page) => page.getByTestId("watchlist-peer-sync");
const on = (overrides: Partial<Status>): Status => ({ ...OFF, enabled: true, pc_id: "PC-ME-00ff", last_sync_at: "2026-09-18T02:03:00.000Z", ...overrides });

test("sync off shows nothing", async ({ page }) => {
  await openWith(page, OFF);
  await expect(line(page)).toHaveCount(0);
});

test("one peer shows the peer count and its last write time", async ({ page }) => {
  await openWith(page, on({ peers: [{ pc_id: "PC-B-0002", written_at: "2026-09-18T02:02:00.000Z" }] }));
  await expect(line(page)).toContainText("Synced with 1 other PC");
});

test("two peers show the most recent write time", async ({ page }) => {
  const olderIso = "2026-09-18T01:00:00.000Z";
  const newerIso = "2026-09-18T02:02:00.000Z";
  await openWith(page, on({ peers: [
    { pc_id: "PC-B-0002", written_at: olderIso },
    { pc_id: "PC-C-0003", written_at: newerIso },
  ] }));
  const formatTime = (iso: string) => page.evaluate(
    (value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    iso,
  );
  const expectedNewer = await formatTime(newerIso);
  const expectedOlder = await formatTime(olderIso);
  await expect(line(page)).toContainText(`Synced with 2 other PCs · latest ${expectedNewer}`);
  await expect(line(page)).not.toContainText(expectedOlder);
});

test("no peers yet says so", async ({ page }) => {
  await openWith(page, on({}));
  await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");
});

test("a skipped peer file is reported", async ({ page }) => {
  await openWith(page, on({ peers: [{ pc_id: "PC-B-0002", written_at: "2026-09-18T02:02:00.000Z" }],
    skipped_files: [{ name: "watchlist.PC-C-0003.json", reason: "unreadable" }] }));
  await expect(line(page)).toContainText("1 file skipped, will retry");
});

test("a skipped file is reported even when no other PC has synced yet", async ({ page }) => {
  await openWith(page, on({ skipped_files: [{ name: "watchlist.PC-C-0003.json", reason: "unreadable" }] }));
  await expect(line(page)).toHaveText("Sync on · no other PC has synced yet · 1 file skipped, will retry");
});

test("an unavailable folder says changes are kept on this PC", async ({ page }) => {
  await openWith(page, on({ last_error: "sync folder does not exist" }));
  await expect(line(page)).toHaveText("Sync unavailable · changes are kept on this PC");
});

test("a watchlist refetch keeps the status line and keeps Import hidden until the new status arrives", async ({ page }) => {
  // The peer-sync query is keyed on the watchlist fetch time, so every watchlist refetch starts a
  // new status query. Every status response after the first is held for 3 s, a window in which the
  // page must keep showing the previous status rather than nothing.
  await mockPortfolioPageApi(page);
  let slow = false;
  let heldResolve: () => void = () => {};
  const held = new Promise<void>((resolve) => { heldResolve = resolve; });
  await page.route("**/api/v1/portfolio/watchlist/peer-sync", async (route) => {
    if (slow) {
      heldResolve();
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: on({}) }) }).catch(() => {});
  });
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await openPortfolioPanel(page, "allocation");
  const importButton = page.getByRole("button", { name: "Import JSON Into DB" });
  await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");
  await expect(importButton).toHaveCount(0);

  slow = true;
  // A real UI action that refetches the watchlist: Export refreshes the portfolio queries.
  await page.getByRole("button", { name: "Export Watchlist To JSON" }).click();
  await held;
  // Sampled without retrying, inside the 3 s hold: a retrying assertion would wait the hold out.
  for (let sample = 0; sample < 4; sample += 1) {
    expect.soft(await line(page).isVisible(), `status line visible at sample ${sample}`).toBe(true);
    expect.soft(await importButton.count(), `Import hidden at sample ${sample}`).toBe(0);
    await page.waitForTimeout(400);
  }
});

test("Import is hidden while sync is on, and Export names the personal file", async ({ page }) => {
  await openWith(page, on({}));
  // Export and Import live in the allocation panel (see portfolio-watchlist.spec.ts).
  await openPortfolioPanel(page, "allocation");
  await expect(page.getByRole("button", { name: "Export Watchlist To JSON" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Import JSON Into DB" })).toHaveCount(0);
  await expect(page.getByText("Import is unavailable while watchlist sync is on")).toBeVisible();
  await page.getByRole("button", { name: "Export Watchlist To JSON" }).click();
  await expect(page.getByText(/Exported \d+ holdings to data\/exports\/watchlist-export\.json\./)).toBeVisible();
});
