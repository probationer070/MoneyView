import { expect, test, type Page } from "@playwright/test";
import { mockDecisionsApi } from "./helpers/decisionsPageMock";
import { mockValuationApi } from "./helpers/valuationPageMock";
import { mockMarketPageApi } from "./helpers/marketPageMock";
import { mockEventsApi, UNCATEGORIZED } from "./helpers/eventsApiMock";

type Status = {
  enabled: boolean; pc_id: string | null;
  peers: Array<{ pc_id: string; written_at: string }>;
  skipped_files: Array<{ name: string; reason: string }>;
  last_sync_at: string | null; last_error: string | null;
  renamed: string[];
};

const OFF: Status = { enabled: false, pc_id: null, peers: [], skipped_files: [], last_sync_at: null, last_error: null, renamed: [] };
const on = (overrides: Partial<Status>): Status => ({ ...OFF, enabled: true, pc_id: "PC-ME-00ff", last_sync_at: "2026-09-18T02:03:00.000Z", ...overrides });

async function mockSyncStatus(page: Page, records: Status) {
  // Registered after each page's own mock helper, so it wins (Playwright tries the
  // last-registered route first).
  await page.route("**/api/v1/sync/status", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: { watchlist: {}, records } }) }),
  );
}

const line = (page: Page) => page.getByTestId("records-sync-status");

async function openDecisions(page: Page, records: Status) {
  await mockDecisionsApi(page);
  await mockSyncStatus(page, records);
  await page.goto("/decisions", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Decision Log", exact: true })).toBeVisible({ timeout: 60_000 });
}

test.describe("records sync status on the decision log page", () => {
  test("sync off shows nothing", async ({ page }) => {
    await openDecisions(page, OFF);
    await expect(line(page)).toHaveCount(0);
  });

  test("one peer shows the peer count and its last write time", async ({ page }) => {
    await openDecisions(page, on({ peers: [{ pc_id: "PC-B-0002", written_at: "2026-09-18T02:02:00.000Z" }] }));
    await expect(line(page)).toContainText("Synced with 1 other PC");
  });

  test("two peers show the most recent write time", async ({ page }) => {
    const olderIso = "2026-09-18T01:00:00.000Z";
    const newerIso = "2026-09-18T02:02:00.000Z";
    await openDecisions(page, on({ peers: [
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
    await openDecisions(page, on({}));
    await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");
  });

  test("a skipped peer file is reported", async ({ page }) => {
    await openDecisions(page, on({ peers: [{ pc_id: "PC-B-0002", written_at: "2026-09-18T02:02:00.000Z" }],
      skipped_files: [{ name: "records.PC-C-0003.json", reason: "unreadable" }] }));
    await expect(line(page)).toContainText("1 file skipped, will retry");
  });

  test("a skipped file is reported even when no other PC has synced yet", async ({ page }) => {
    await openDecisions(page, on({ skipped_files: [{ name: "records.PC-C-0003.json", reason: "unreadable" }] }));
    await expect(line(page)).toHaveText("Sync on · no other PC has synced yet · 1 file skipped, will retry");
  });

  test("a name clash is reported", async ({ page }) => {
    await openDecisions(page, on({ renamed: ["AAPL case (2026-09-18)", "MSFT case (2026-09-18)"] }));
    await expect(line(page)).toHaveText("Sync on · no other PC has synced yet · 2 name clash repaired");
  });

  test("an unavailable folder says changes are kept on this PC", async ({ page }) => {
    await openDecisions(page, on({ last_error: "sync folder does not exist" }));
    await expect(line(page)).toHaveText("Sync unavailable · changes are kept on this PC");
    await expect(line(page)).toHaveClass(/state-warning/);
  });

  test("a decisions refetch keeps the status line during the hold", async ({ page }) => {
    // The status query is keyed on the decisions fetch time, so every decisions refetch starts
    // a new status query. Every status response after the first is held for 3 s, a window in
    // which the page must keep showing the previous status rather than nothing.
    await mockDecisionsApi(page);
    let slow = false;
    let heldResolve: () => void = () => {};
    const held = new Promise<void>((resolve) => { heldResolve = resolve; });
    await page.route("**/api/v1/sync/status", async (route) => {
      if (slow) {
        heldResolve();
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "ok", data: { watchlist: {}, records: on({}) } }) }).catch(() => {});
    });
    await page.goto("/decisions", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Decision Log", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");

    slow = true;
    // A real UI action that refetches the decisions query: recording a decision invalidates it.
    await page.getByLabel(/ticker/i).fill("AAPL");
    await page.getByLabel(/memo/i).fill("services margin inflecting");
    await page.getByLabel(/memo/i).press("Enter");
    await held;
    // Sampled without retrying, inside the 3 s hold: a retrying assertion would wait the hold out.
    for (let sample = 0; sample < 4; sample += 1) {
      expect.soft(await line(page).isVisible(), `status line visible at sample ${sample}`).toBe(true);
      await page.waitForTimeout(400);
    }
  });
});

test.describe("records sync status on the valuation page", () => {
  async function openValuation(page: Page, records: Status) {
    await mockValuationApi(page);
    await mockSyncStatus(page, records);
    await page.goto("/valuation", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Valuation/i })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel(/ticker/i).fill("AEP");
    await page.getByLabel(/ticker/i).press("Enter");
    await expect(page.getByTestId("verdict-panel")).toBeVisible();
  }

  test("sync off shows nothing", async ({ page }) => {
    await openValuation(page, OFF);
    await expect(line(page)).toHaveCount(0);
  });

  test("sync on shows the status line", async ({ page }) => {
    await openValuation(page, on({}));
    await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");
  });
});

test.describe("records sync status on the events page", () => {
  async function openEvents(page: Page, records: Status) {
    await mockMarketPageApi(page);
    await page.route("**/api/v1/market/spreads**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) }),
    );
    await mockEventsApi(page, { events: [], categories: [UNCATEGORIZED] });
    await mockSyncStatus(page, records);
    await page.goto("/events", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("events-table")).toBeVisible({ timeout: 60_000 });
  }

  test("sync on shows the status line", async ({ page }) => {
    await openEvents(page, on({}));
    await expect(line(page)).toHaveText("Sync on · no other PC has synced yet");
  });
});
