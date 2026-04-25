import { expect, test } from "@playwright/test";

test("simulation lab surfaces invalid-data states and preserved warnings for degraded worker output", async ({ page }) => {
  await page.addInitScript(() => {
    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;

      postMessage(message: { type: string; requestId: string }) {
        if (message.type !== "run-path") return;

        const result = {
          ticker: "SIM",
          model: "mock",
          execution_mode: "interactive",
          path_summary: [
            {
              time: "bad-row",
              mean: 10000000,
              p05: 8000000,
              p10: 8500000,
              p25: 9000000,
              p50: 10000000,
              p75: 11000000,
              p90: 11500000,
              p95: 12000000,
            },
          ],
          sample_paths: [
            { time: 0, path_1: 10000000 },
            { time: "bad-time", path_1: Number.NaN },
          ],
          risk_metrics: {
            loss_probability: 12,
            sharpe_ratio: 1.1,
            sortino_ratio: 1.0,
            skewness: 0.2,
            kurtosis: 3.4,
            max_return: 25,
            min_return: -12,
            var95: 6,
            var99: 9,
            cvar95: 11,
            mean_return: 10,
            median_return: 9,
            volatility: 18,
            excess_kurtosis: 0.4,
          },
          histogram: [
            { return: -5, frequency: 3, loss_bucket: 1 },
            { return: "broken", frequency: 4 },
          ],
          normal_fit: [
            { return: -5, density: 0.5 },
            { return: "broken", density: 0.2 },
          ],
          cdf_comparison: [
            { return: "broken", simulated_cdf: 0.4, normal_cdf: 0.3 },
          ],
        };

        window.setTimeout(() => {
          this.onmessage?.({
            data: { type: "progress", requestId: message.requestId, progress: 50 },
          } as MessageEvent);
        }, 0);

        window.setTimeout(() => {
          this.onmessage?.({
            data: { type: "result", requestId: message.requestId, result },
          } as MessageEvent);
        }, 20);
      }

      terminate() {}
    }

    // @ts-expect-error test override
    window.Worker = MockWorker;
  });

  await page.goto("/monte-carlo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Simulation Lab/i })).toBeVisible({ timeout: 60_000 });

  await page.getByRole("button", { name: "Run Path Simulation" }).click();

  await expect(page.getByText("Path output normalization warnings")).toBeVisible();
  await expect(page.getByText(/Dropped invalid percentile-cone row 1\./)).toBeVisible();
  await expect(page.getByText(/Dropped invalid histogram row 2\./)).toBeVisible();
  await expect(page.getByText("Path chart data is invalid")).toBeVisible();
  await expect(page.getByText("Percentile-cone data is invalid")).toBeVisible();

  await page.getByRole("tab", { name: /Risk Analysis/i }).click();
  await expect(page.getByRole("heading", { name: "VaR / CVaR Risk Distribution" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Terminal Value Percentiles" })).toBeVisible();

  await page.getByRole("tab", { name: /Return Distribution/i }).click();
  await expect(page.getByRole("heading", { name: "Return Histogram with Fitted Normal Curve" })).toBeVisible();
  await expect(page.getByText("CDF comparison data is invalid")).toBeVisible();
});
