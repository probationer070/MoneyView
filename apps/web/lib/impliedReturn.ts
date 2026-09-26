/**
 * Reader wording for `implied_return_refusal` (packages/core_finance/expected_return.py,
 * IMPLIED_RETURN_REFUSAL_CODES). The backend owns the vocabulary: an unrecognised code is
 * shown as sent rather than hidden, so a code added there still reaches the reader.
 */
const REFUSAL_TEXT: Record<string, string> = {
  no_price: "No current price, so there is no market value to solve against.",
  bridge_unresolved: "Net debt or the share count is missing, so the market's enterprise value cannot be built.",
  non_positive_fcff: "Free cash flow is zero or negative over the forecast, so no discount rate prices it.",
  non_positive_market_ev: "Net cash exceeds the market value, so the market's enterprise value is not positive.",
  below_model_range: "The market pays more than this model can reach at any return above terminal growth + 0.5%.",
  above_model_range: "The implied return would exceed 1000% per year.",
};

/** A snapshot from before metric v3 recorded no implied return. Not a refusal. */
export const IMPLIED_RETURN_NOT_RECORDED = "Not recorded before metric v3.";

export function impliedReturnRefusalText(code: string | null): string {
  if (code === null) return IMPLIED_RETURN_NOT_RECORDED;
  return REFUSAL_TEXT[code] ?? code;
}
