import { expect, test, type Locator, type Page } from "@playwright/test";
import { API_PREFIX, json } from "./helpers/mockUtils";
import { mockPortfolioPageApi } from "./helpers/portfolioPageMock";
import { openPortfolioPanel, portfolioModal } from "./helpers/portfolioPanels";

// Wording fixed by the design spec. Asserting it literally means a drift in the component
// text fails here rather than shipping a differently-worded warning.
const BOUNDARY_NOTICE = /Metric definition changed\. Values before and after this point are not directly comparable\./;

type HistoryPointSeed = {
  as_of_date: string;
  generated_at: string;
  metric_schema_version: number;
  average_dcf_value: number;
};

// Newest first, which is the order the real endpoint returns: the history query in
// apps/api/services/corporate_comparison.py ends `ORDER BY lv.snapshot_date DESC`.
//
// Two version changes, deliberately placed on either side of the trap:
//
//  - v1 -> v2 falls between the two 2026-08-03 snapshots, INSIDE one date group. Comparing
//    within the group finds this one, and so does comparing along the flat array -- but
//    they disagree about WHICH of the pair carries it, so the assertions pin placement and
//    not only the count.
//  - v0 -> v1 falls between 2026-07-20 and 2026-07-28, ACROSS a date-group edge. A
//    within-group comparison has no neighbour to compare against there and misses it
//    entirely, which the count then catches.
//
// Version 0 is a real stored value meaning "predates the column", not a placeholder.
const NEW_DEFINITION: HistoryPointSeed = {
  as_of_date: "2026-08-03",
  generated_at: "2026-08-03T12:30:00Z",
  metric_schema_version: 2,
  average_dcf_value: 158.5,
};
const SAME_DAY_OLD_DEFINITION: HistoryPointSeed = {
  as_of_date: "2026-08-03",
  generated_at: "2026-08-03T09:00:00Z",
  metric_schema_version: 1,
  average_dcf_value: 2438.0,
};
const EARLIER_OLD_DEFINITION: HistoryPointSeed = {
  as_of_date: "2026-07-28",
  generated_at: "2026-07-28T09:00:00Z",
  metric_schema_version: 1,
  average_dcf_value: 2431.0,
};
const UNVERSIONED: HistoryPointSeed = {
  as_of_date: "2026-07-20",
  generated_at: "2026-07-20T09:00:00Z",
  metric_schema_version: 0,
  average_dcf_value: 2402.0,
};

function snapshotVersionOf(seed: HistoryPointSeed) {
  return `${seed.as_of_date}|portfolio_plus_benchmark|^GSPC||${seed.generated_at}`;
}

/**
 * Serves GET /corporate/comparison/history with exactly `seeds`, in the order given.
 * Registered after mockPortfolioPageApi's catch-all so it wins: Playwright matches routes
 * in reverse registration order.
 */
async function mockPortfolioHistory(page: Page, seeds: HistoryPointSeed[]) {
  await mockPortfolioPageApi(page);
  await page.route(
    (url) => url.pathname === `${API_PREFIX}/corporate/comparison/history`,
    (route) => {
      const url = new URL(route.request().url());
      return json(route, {
        status: "ok",
        data: {
          comparison_universe: url.searchParams.get("comparison_universe") ?? "portfolio_plus_benchmark",
          benchmark_ticker: (url.searchParams.get("benchmark_ticker") ?? "^GSPC").toUpperCase(),
          custom_tickers: [],
          points: seeds.map((seed) => ({
            as_of_date: seed.as_of_date,
            generated_at: seed.generated_at,
            snapshot_version: snapshotVersionOf(seed),
            snapshot_source: "scheduled_kst_daily",
            comparison_universe: "portfolio_plus_benchmark",
            benchmark_ticker: "^GSPC",
            stock_count: 2,
            average_expected_return_spread: 2.86,
            average_roic_minus_wacc: 10.5,
            average_dcf_value: seed.average_dcf_value,
            metric_schema_version: seed.metric_schema_version,
            market_expected_return: 9.7,
          })),
        },
      });
    },
  );
}

async function openSnapshotHistory(page: Page): Promise<Locator> {
  await page.goto("/portfolio", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Portfolio", exact: true })).toBeVisible({ timeout: 60_000 });
  await openPortfolioPanel(page, "snapshot");
  // The history query stays disabled until an explicit refresh sets
  // portfolioAnalysisRefreshToken (the `enabled` guard in app/portfolio/page.tsx), so
  // without this the modal opens on an empty history.
  await page.getByRole("button", { name: "Refresh Analysis" }).click();
  await page.getByRole("button", { name: "Open Snapshot History" }).click();
  const dialog = portfolioModal(page);
  // Rendered only once the history has points, so this waits for the fetched data.
  await expect(dialog.getByRole("heading", { name: "Grouped By Date" })).toBeVisible();
  return dialog;
}

// One TimelineList entry, found by the snapshot version its existing chip prints, so the
// lookup does not depend on the order the groups happen to render in.
function historyItem(dialog: Locator, seed: HistoryPointSeed): Locator {
  return dialog.locator("article").filter({ hasText: snapshotVersionOf(seed) });
}

test("the point where the metric definition changed says so", async ({ page }) => {
  // Snapshots before version 2 averaged enterprise values; from version 2 they average
  // intrinsic per-share values. The step between them is a definition change, not a
  // market move, and nothing said so.
  await mockPortfolioHistory(page, [NEW_DEFINITION, SAME_DAY_OLD_DEFINITION, EARLIER_OLD_DEFINITION, UNVERSIONED]);
  const dialog = await openSnapshotHistory(page);

  // One boundary per version change, each on the FIRST point of the new definition rather
  // than the last point of the old one.
  await expect(dialog.getByText(BOUNDARY_NOTICE)).toHaveCount(2);
  await expect(historyItem(dialog, NEW_DEFINITION)).toContainText(BOUNDARY_NOTICE);
  await expect(historyItem(dialog, EARLIER_OLD_DEFINITION)).toContainText(BOUNDARY_NOTICE);
  await expect(historyItem(dialog, SAME_DAY_OLD_DEFINITION)).not.toContainText(BOUNDARY_NOTICE);
  await expect(historyItem(dialog, UNVERSIONED)).not.toContainText(BOUNDARY_NOTICE);

  // Every point carries its own metric version, not just the ones at a boundary.
  await expect(historyItem(dialog, NEW_DEFINITION)).toContainText("Metric schema v2");
  await expect(historyItem(dialog, SAME_DAY_OLD_DEFINITION)).toContainText("Metric schema v1");
  await expect(historyItem(dialog, EARLIER_OLD_DEFINITION)).toContainText("Metric schema v1");
  await expect(historyItem(dialog, UNVERSIONED)).toContainText("Metric schema v0");
});

test("a history at one metric version shows no boundary", async ({ page }) => {
  await mockPortfolioHistory(page, [
    { as_of_date: "2026-08-03", generated_at: "2026-08-03T12:30:00Z", metric_schema_version: 2, average_dcf_value: 158.5 },
    { as_of_date: "2026-08-01", generated_at: "2026-08-01T12:30:00Z", metric_schema_version: 2, average_dcf_value: 150.0 },
  ]);
  const dialog = await openSnapshotHistory(page);

  // Both points really did render, so "no notice" is the rule at work rather than an
  // empty timeline.
  await expect(dialog.getByText("Metric schema v2")).toHaveCount(2);
  await expect(dialog.getByText(BOUNDARY_NOTICE)).toHaveCount(0);
});
