/**
 * The 4-quadrant value matrix (spec 2026-11-02-corporate-explainers-plan §4, P2).
 *
 * Up/down is ROIC - WACC against 0: value created or destroyed per unit of capital.
 * Right/left is growth against the long-run growth reference, the risk-free rate: Damodaran caps a
 * stable growth rate at the risk-free rate, so growing faster than it is "high growth".
 */
export type ValueQuadrant = "growthCreates" | "returnCash" | "fixReturns" | "restructure";

export function valueQuadrant(growth: number, spread: number, growthReference: number): ValueQuadrant {
  const creates = spread >= 0;
  const fast = growth >= growthReference;
  if (creates) return fast ? "growthCreates" : "returnCash";
  return fast ? "fixReturns" : "restructure";
}
