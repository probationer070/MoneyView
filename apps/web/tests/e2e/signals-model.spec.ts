import { expect, test } from "@playwright/test";
import { deltaPp, formatDelta, formatProb, mostLikely, rulesVersionBreaks } from "../../lib/signals";

test("delta is in percentage points, rounded to 0.1", () => {
  expect(deltaPp(0.4512, 0.4)).toBe(5.1);
  expect(deltaPp(0.4, null)).toBeNull();
  expect(formatDelta(5.1)).toBe("▲ 5.1%p");
  expect(formatDelta(-0.4)).toBe("▼ 0.4%p");
  expect(formatDelta(0)).toBe("0.0%p");
  expect(formatDelta(null)).toBe("—");
});

test("most likely scenario and probability format", () => {
  expect(mostLikely({ a: 0.3, b: 0.5, c: 0.2 })).toBe("b");
  expect(formatProb(0.4512)).toBe("45.1%");
});

test("a rules_version break is marked on the first week of the new version only", () => {
  const point = (iso_week: string, rules_version: string) => ({ iso_week, rules_version, run_at: "", a: 0, b: 0, c: 0 });
  expect(rulesVersionBreaks([point("2026-W39", "v1"), point("2026-W40", "v1"), point("2026-W41", "v2"), point("2026-W42", "v2")]))
    .toEqual(["2026-W41"]);
  expect(rulesVersionBreaks([])).toEqual([]);
});
