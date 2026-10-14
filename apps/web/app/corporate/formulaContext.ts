import type { CorporateMetricAuditEntry, DcfSummary } from "../../../../packages/shared-types";
import { bridgedEstimatedValue, bridgedUpsidePct } from "@/lib/bridgeQuality";
import type { CorporateAssumptions } from "./corporateTypes";
import { KOREA_COUNTRY_RISK_PREMIUM, RISK_FREE_RATE, TAX_RATE } from "./corporateConstants";
import type { FormulaContext } from "./substitutedFormula";

/** The page's values that the summary formulas print (plan N2). Every field is read from the page's own state. */
export interface FormulaInputs {
  assumptions: Pick<CorporateAssumptions, "roic" | "wacc" | "reinvestment" | "unleveredBeta">;
  derived: Pick<FormulaContext, "spread" | "bottomUpKe" | "leveredBeta" | "sustainableGrowth" | "debtToEquity">;
  impliedErp: number;
  impliedMarketReturn: number;
  waccAudit: CorporateMetricAuditEntry | null;
  dcfData: DcfSummary | null;
}

export function buildFormulaContext({ assumptions, derived, impliedErp, impliedMarketReturn, waccAudit, dcfData }: FormulaInputs): FormulaContext {
  return {
    roic: assumptions.roic,
    wacc: assumptions.wacc,
    reinvestment: assumptions.reinvestment,
    unleveredBeta: assumptions.unleveredBeta,
    spread: derived.spread,
    bottomUpKe: derived.bottomUpKe,
    leveredBeta: derived.leveredBeta,
    sustainableGrowth: derived.sustainableGrowth,
    debtToEquity: derived.debtToEquity,
    riskFreeRate: RISK_FREE_RATE,
    impliedErp,
    impliedMarketReturn,
    countryRiskPremium: KOREA_COUNTRY_RISK_PREMIUM,
    taxRate: TAX_RATE,
    waccAudit,
    // Bridged values only: a suppressed intrinsic value or upside is null, so no formula prints it.
    dcf: dcfData ? { intrinsic: bridgedEstimatedValue(dcfData), price: dcfData.current_price, upside: bridgedUpsidePct(dcfData) } : null,
  };
}

/** The audit's WACC differs from the input by more than this many percentage points (spec §4 caption). */
export const WACC_CAPTION_THRESHOLD_PP = 0.05;

/**
 * The input WACC when the audit's final WACC differs from it by more than the threshold, else null.
 * The summary then notes that the substituted formula uses the audit's own inputs.
 */
export function waccInputIfDivergent(waccAudit: CorporateMetricAuditEntry | null, sliderWacc: number): number | null {
  const result = waccAudit?.inputs_used.find((input) => input.field === "final_wacc_value")?.value;
  if (typeof result !== "number" || !Number.isFinite(result)) return null;
  return Math.abs(result - sliderWacc) > WACC_CAPTION_THRESHOLD_PP ? sliderWacc : null;
}
