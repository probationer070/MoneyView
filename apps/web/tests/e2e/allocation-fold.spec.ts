import { expect, test } from "@playwright/test";
import { foldAllocation } from "../../components/charts/allocationFold";

// Pure function, no page: the donut shows at most five slices, and the tail is one "Other".

const sector = (name: string, value: number) => ({ name, value });

test("five or fewer sectors are not folded, and come back largest first", () => {
  const five = [1, 2, 3, 4, 5].map((i) => sector(`S${i}`, i));
  expect(foldAllocation(five, "Other")).toEqual([...five].reverse());
});

test("seven sectors fold to four named slices and one Other that sums the tail", () => {
  const seven = [10, 9, 8, 7, 6, 5, 4].map((v, i) => sector(`S${i + 1}`, v));
  const folded = foldAllocation(seven, "Other");
  expect(folded).toHaveLength(5);
  expect(folded.slice(0, 4).map((s) => s.name)).toEqual(["S1", "S2", "S3", "S4"]);
  expect(folded[4]).toEqual({ name: "Other", value: 6 + 5 + 4, folded: true });
  expect(folded.slice(0, 4).every((s) => !s.folded)).toBe(true);
});

test("the largest sector survives the fold even when the backend lists it last", () => {
  // Backend order, not weight order: smallest first, largest last.
  const backend = [1, 2, 3, 4, 5, 6, 40].map((v, i) => sector(`S${i + 1}`, v));
  const folded = foldAllocation(backend, "Other");
  expect(folded.slice(0, 4).map((s) => s.name)).toContain("S7");
  expect(folded[0].name).toBe("S7");
  expect(folded.map((s) => s.name)).not.toContain("S1");
  expect(folded[4]).toEqual({ name: "Other", value: 1 + 2 + 3, folded: true });
});

test("the input array is not mutated by the sort or the fold", () => {
  const backend = [1, 2, 3, 4, 5, 6, 40].map((v, i) => sector(`S${i + 1}`, v));
  const snapshot = JSON.parse(JSON.stringify(backend));
  foldAllocation(backend, "Other");
  expect(backend).toEqual(snapshot);
  expect(backend[0].name).toBe("S1");
});
