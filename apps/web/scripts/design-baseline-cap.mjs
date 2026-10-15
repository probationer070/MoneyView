// The market exception's warning cap. Market stays `warn` until the market one-screen plan moves
// components/market/** and app/page.tsx to paper (DS plan Task 14b, docs/superpowers/plans/
// 2026-10-12-design-system-formalization.md; not yet written). Lower the cap as hits go; it never rises.
export const MARKET_WARN_CAP = 295;

/** True when the warning count is above the cap. Exactly at the cap passes. */
export function warnCapExceeded(warn, cap = MARKET_WARN_CAP) {
  return warn > cap;
}
