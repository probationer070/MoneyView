import { expect, test } from "@playwright/test";

// Six sampled paths, all valid: the path chart must draw them as one colour, not one colour per index.
test("the sampled paths are drawn in one colour, so the set reads as one series", async ({ page }) => {
  await page.addInitScript(() => {
    class MockWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;

      postMessage(message: { type: string; requestId: string }) {
        if (message.type !== "run-path") return;

        const times = [0, 1, 2, 3, 4, 5];
        const samplePaths = times.map((time) => {
          const row: Record<string, number> = { time };
          for (let index = 1; index <= 6; index += 1) row[`path_${index}`] = 10000000 + time * 100000 * index;
          return row;
        });
        const pathSummary = times.map((time) => ({
          time,
          mean: 10000000 + time * 150000,
          p05: 9000000 + time * 50000,
          p10: 9300000 + time * 60000,
          p25: 9700000 + time * 90000,
          p50: 10000000 + time * 150000,
          p75: 10300000 + time * 210000,
          p90: 10700000 + time * 240000,
          p95: 11000000 + time * 260000,
        }));
        const result = {
          ticker: "SIM",
          model: "mock",
          execution_mode: "interactive",
          path_summary: pathSummary,
          sample_paths: samplePaths,
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
          histogram: [{ return: -5, frequency: 3, loss_bucket: 1 }, { return: 5, frequency: 4, loss_bucket: 0 }],
          normal_fit: [{ return: -5, density: 0.5 }, { return: 5, density: 0.2 }],
          cdf_comparison: [{ return: -5, simulated_cdf: 0.4, normal_cdf: 0.3 }],
        };

        window.setTimeout(() => {
          this.onmessage?.({ data: { type: "result", requestId: message.requestId, result } } as MessageEvent);
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

  // The sampled paths are the only lines drawn at half opacity.
  const sampled = page.locator('path.recharts-line-curve[stroke-opacity="0.5"]');
  await expect(sampled).toHaveCount(6);
  const strokes = await sampled.evaluateAll((nodes) => [...new Set(nodes.map((node) => node.getAttribute("stroke")))]);
  expect(strokes).toEqual(["var(--chart-1)"]);
});
