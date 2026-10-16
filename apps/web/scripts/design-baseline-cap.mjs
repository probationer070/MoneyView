// The market exception's warning cap. The market one-screen plan (docs/superpowers/plans/2026-10-16-market-one-screen.md)
// moved components/market/** and app/page.tsx to paper, so the cap is 0: any market warning fails the baseline.
// DS Task 14b removes the exception itself (docs/superpowers/plans/2026-10-12-design-system-formalization.md). It never rises.
export const MARKET_WARN_CAP = 0;

/** True when the warning count is above the cap. Exactly at the cap passes. */
export function warnCapExceeded(warn, cap = MARKET_WARN_CAP) {
  return warn > cap;
}
