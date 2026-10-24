import { expect, test } from "@playwright/test";
import { levelRange } from "../../components/risk/ThemeLevelChart";

// The theme level chart's request window (risk UI plan Task 6): start−40d to end+20d, never past today, never
// longer than the API's 400-day cap.

test("an ended signal asks for 40 days before to 20 days after", () => {
  expect(levelRange("2025-06-10", "2025-06-30", "2026-10-24")).toEqual({ from: "2025-05-01", to: "2025-07-20" });
});

test("the window never runs past today", () => {
  // Ended 5 days ago: end+20d is still ahead, so it stops at today.
  expect(levelRange("2026-10-01", "2026-10-19", "2026-10-24")).toEqual({ from: "2026-08-22", to: "2026-10-24" });
  // Open: up to today.
  expect(levelRange("2026-10-14", null, "2026-10-24")).toEqual({ from: "2026-09-04", to: "2026-10-24" });
});

test("a long signal is clamped to 400 days before its end", () => {
  // 2024-01-01 −40d would be 2023-11-22; the window instead starts 400 days before 2025-03-21 (end+20d).
  expect(levelRange("2024-01-01", "2025-03-01", "2026-10-24")).toEqual({ from: "2024-02-15", to: "2025-03-21" });
  // Open and long: 400 days before today.
  expect(levelRange("2024-01-01", null, "2026-10-24")).toEqual({ from: "2025-09-19", to: "2026-10-24" });
});
