import { expect, test } from "@playwright/test";
import { odometerPlan } from "../../lib/motion";

const changed = (cells: ReturnType<typeof odometerPlan>) =>
  cells.map((cell, index) => ({ index, ...cell })).filter((cell) => cell.from !== cell.to);

test.describe("odometerPlan", () => {
  test("changed cells keep their index and delay counts from the right", () => {
    const cells = odometerPlan("7,744.1", "7,760.0");
    expect(cells).toHaveLength(7);
    expect(changed(cells)).toEqual([
      { index: 3, from: "4", to: "6", delayIndex: 3 },
      { index: 4, from: "4", to: "0", delayIndex: 2 },
      { index: 6, from: "1", to: "0", delayIndex: 0 },
    ]);
    cells.forEach((cell, index) => {
      if (![3, 4, 6].includes(index)) expect(cell.from).toBe(cell.to);
    });
  });

  test("a shorter from pads on the left and a growing number shifts digits right", () => {
    const cells = odometerPlan("999.9", "1,000.1");
    expect(cells.map((cell) => cell.from)).toEqual(["", "", "9", "9", "9", ".", "9"]);
    expect(cells.map((cell) => cell.to)).toEqual(["1", ",", "0", "0", "0", ".", "1"]);
    expect(cells.map((cell) => cell.delayIndex)).toEqual([6, 5, 4, 3, 2, 1, 0]);
  });

  test("a null from shows the to text with every digit at zero", () => {
    const cells = odometerPlan(null, "▲ +12.4%");
    expect(cells.map((cell) => cell.from)).toEqual(["▲", " ", "+", "0", "0", ".", "0", "%"]);
    expect(cells.map((cell) => cell.to)).toEqual(["▲", " ", "+", "1", "2", ".", "4", "%"]);
  });

  test("identical text leaves every cell unchanged", () => {
    const cells = odometerPlan("5.11%", "5.11%");
    expect(cells).toHaveLength(5);
    expect(changed(cells)).toEqual([]);
  });
});
