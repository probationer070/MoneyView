import { expect, test } from "@playwright/test";
import { transformToTVVolume, type RawOHLCV } from "../../lib/transformers";

// Pure function, no page. A volume bar takes the paper token for its direction (up = red,
// down = blue), at the bar alpha. The old literal rgba(239, 83, 80) and rgba(69, 137, 229)
// are gone: the market, portfolio and detail charts all draw their volume through this function.

const UP_DAY: RawOHLCV = { date: "2026-04-01", open: 100, high: 110, low: 95, close: 105, volume: 10 };
const DOWN_DAY: RawOHLCV = { date: "2026-04-02", open: 105, high: 106, low: 90, close: 100, volume: 20 };

test("an up day's volume bar takes the up token (#d21f3c) at 40% alpha", () => {
  const [bar] = transformToTVVolume([UP_DAY]);
  expect(bar.color).toBe("rgba(210, 31, 60, 0.4)");
});

test("a down day's volume bar takes the down token (#1e5bd8) at 40% alpha", () => {
  const [bar] = transformToTVVolume([DOWN_DAY]);
  expect(bar.color).toBe("rgba(30, 91, 216, 0.4)");
});
