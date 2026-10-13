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
 * Keep the first four sectors as given; with more than five entries, sum the rest into one
 * slice named `otherLabel`. Five or fewer entries pass through unchanged.
 */
export function foldAllocation(data: AllocationSlice[], otherLabel: string): AllocationSlice[] {
  if (data.length <= ALLOCATION_MAX_SLICES) return data;
  const kept = data.slice(0, ALLOCATION_NAMED_KEPT);
  const rest = data.slice(ALLOCATION_NAMED_KEPT);
  const value = rest.reduce((sum, slice) => sum + slice.value, 0);
  return [...kept, { name: otherLabel, value, folded: true }];
}
