/**
 * The single test for whether a DCF payload's headline numbers may be presented.
 *
 * The backend's enterprise-to-equity bridge needs net debt and diluted share count. When
 * either is absent the bridge does not resolve, and the DCF summary reports a different
 * financial quantity under the same field names. `bridge_quality` is the only discriminator.
 *
 * Every consumer of `estimated_value` or `upside_pct` goes through the helpers below. A
 * fourth quality tier must be one edit here, not a search across render sites -- this is the
 * same rule `bridgedDcfValue` in app/corporate/corporateDerivedViews.ts follows, and that
 * helper delegates to this predicate so the two cannot drift apart.
 *
 * Note the test is `=== "missing"`, not `!== "ok"`: `estimated` is a real intrinsic value per
 * share and must still be shown.
 */
export function isBridgeUnresolved(bridgeQuality?: string): boolean {
  return bridgeQuality === "missing";
}

/**
 * The summary's estimated_value when it is an intrinsic value per share, and null when it is
 * an enterprise value.
 *
 * `estimated_value` falls back to enterprise value when the bridge does not resolve
 * (apps/api/services/corporate_dcf.py:222). That is a different quantity, not a larger one,
 * so it cannot appear under a "Fair Value" or "Intrinsic DCF Value" label however close to a
 * plausible share price it happens to land.
 */
export function bridgedEstimatedValue(
  summary: { estimated_value: number; bridge_quality?: string },
): number | null {
  return isBridgeUnresolved(summary.bridge_quality) ? null : summary.estimated_value;
}

/**
 * The summary's upside_pct when it was computed against a per-share value, and null when it
 * was not.
 *
 * upside_pct is set to 0.0 rather than left absent when the bridge does not resolve
 * (apps/api/services/corporate_dcf.py:224), so it renders as a real "0.0%" -- a fair-valued
 * reading, in the positive colour, for a comparison that never happened.
 */
export function bridgedUpsidePct(
  summary: { upside_pct: number; bridge_quality?: string },
): number | null {
  return isBridgeUnresolved(summary.bridge_quality) ? null : summary.upside_pct;
}

/** What a suppressed DCF number renders as, wherever one is suppressed. */
export const UNBRIDGED_PLACEHOLDER = "—";

/** The reason, for the title attribute of a suppressed cell. */
export const UNBRIDGED_REASON =
  "The equity bridge did not resolve for this ticker, so no intrinsic value per share is available.";
