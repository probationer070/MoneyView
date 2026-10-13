import { expect, test } from "@playwright/test";
import { foldAllocation } from "../../components/charts/allocationFold";

// Pure function, no page: the donut shows at most five slices, and the tail is one "Other".

const sector = (name: string, value: number) => ({ name, value });

test("five or fewer sectors pass through unfolded", () => {
  const five = [1, 2, 3, 4, 5].map((i) => sector(`S${i}`, i));
  expect(foldAllocation(five, "Other")).toEqual(five);
});

test("seven sectors fold to four named slices and one Other that sums the tail", () => {
  const seven = [10, 9, 8, 7, 6, 5, 4].map((v, i) => sector(`S${i + 1}`, v));
  const folded = foldAllocation(seven, "Other");
  expect(folded).toHaveLength(5);
  expect(folded.slice(0, 4).map((s) => s.name)).toEqual(["S1", "S2", "S3", "S4"]);
  expect(folded[4]).toEqual({ name: "Other", value: 6 + 5 + 4, folded: true });
  expect(folded.slice(0, 4).every((s) => !s.folded)).toBe(true);
});
