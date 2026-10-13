/** A donut holds at most five slices: four named sectors and one folded "Other" (M4). */
export const ALLOCATION_MAX_SLICES = 5;
export const ALLOCATION_NAMED_KEPT = 4;

export interface AllocationSlice {
  name: string;
  value: number;
  /** True for the single slice that sums the tail. */
  folded?: boolean;
}

/**
 * Slices are ordered largest first (a copy; the input is not mutated). Ties keep their input
 * order. With more than five entries, the four largest stay named and the rest sum into one
 * slice named `otherLabel`. Five or fewer entries are returned sorted and unfolded.
 *
 * The sort is required: backend `sector_breakdowns` arrive in backend order, not by weight, so
 * a slice-by-position fold could fold the largest sector into "Other".
 */
export function foldAllocation(data: AllocationSlice[], otherLabel: string): AllocationSlice[] {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  if (sorted.length <= ALLOCATION_MAX_SLICES) return sorted;
  const kept = sorted.slice(0, ALLOCATION_NAMED_KEPT);
  const rest = sorted.slice(ALLOCATION_NAMED_KEPT);
  const value = rest.reduce((sum, slice) => sum + slice.value, 0);
  return [...kept, { name: otherLabel, value, folded: true }];
}
