import type { CorporateMetricAuditEntry } from "../../../../packages/shared-types";
import type { CalculationDetailKey } from "./components/calculationDetailTypes";

/** Values the page already computed (page.tsx `derived`, constants, the WACC audit, the DCF). */
export interface FormulaContext {
  roic: number;
  wacc: number;
  reinvestment: number;
  unleveredBeta: number;
  spread: number;
  bottomUpKe: number;
  leveredBeta: number;
  sustainableGrowth: number;
  debtToEquity: number;
  riskFreeRate: number;
  impliedErp: number;
  impliedMarketReturn: number;
  countryRiskPremium: number;
  /** A fraction: 0.25. */
  taxRate: number;
  waccAudit: CorporateMetricAuditEntry | null;
  /** Bridged values only (bridgedEstimatedValue / bridgedUpsidePct); null where suppressed. */
  dcf: { intrinsic: number | null; price: number; upside: number | null } | null;
}

const p = (value: number) => `${value.toFixed(1)}%`;
const n2 = (value: number) => value.toFixed(2);
const money = (value: number) => `$${value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
const signed = (value: number) => {
  const text = value.toFixed(1);
  // A tiny negative upside rounds to "-0.0"; print it as the zero it is.
  if (Number(text) === 0) return "0.0%";
  return `${value > 0 ? "+" : ""}${text}%`;
};

function auditInput(entry: CorporateMetricAuditEntry | null, field: string): number | null {
  const value = entry?.inputs_used.find((input) => input.field === field)?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The formula with the page's own numbers substituted (spec §4 summary tab, plan N2). It formats
 * operands and the result the page already holds and computes nothing; null when an operand is
 * not on the page, and the summary then shows only the symbolic formula.
 */
export function substitutedFormula(key: CalculationDetailKey, c: FormulaContext): string | null {
  switch (key) {
    case "spread":
      return `ROIC − WACC = ${p(c.roic)} − ${p(c.wacc)} = ${p(c.spread)}`;
    case "bottomUpKe":
      return `Ke = rf + βL × ERP + CRP = ${p(c.riskFreeRate)} + ${n2(c.leveredBeta)} × ${p(c.impliedErp)} + ${p(c.countryRiskPremium)} = ${p(c.bottomUpKe)}`;
    case "leveredBeta":
      return `βL = βU × [1 + (1 − t) × D/E] = ${n2(c.unleveredBeta)} × [1 + (1 − ${p(c.taxRate * 100)}) × ${n2(c.debtToEquity)}] = ${n2(c.leveredBeta)}`;
    case "sustainableGrowth":
      return `g = reinvestment × ROIC = ${p(c.reinvestment)} × ${p(c.roic)} = ${p(c.sustainableGrowth)}`;
    case "erp":
      // impliedErp is max(IRR − rf, 0) (page.tsx): the identity holds only when the floor did not bite.
      return c.impliedMarketReturn - c.riskFreeRate < 0
        ? null
        : `ERP = IRR − rf = ${p(c.impliedMarketReturn)} − ${p(c.riskFreeRate)} = ${p(c.impliedErp)}`;
    case "wacc": {
      const equityWeight = auditInput(c.waccAudit, "equity_weight");
      const costOfEquity = auditInput(c.waccAudit, "cost_of_equity");
      const debtWeight = auditInput(c.waccAudit, "debt_weight");
      const costOfDebt = auditInput(c.waccAudit, "cost_of_debt");
      const tax = auditInput(c.waccAudit, "tax_rate");
      const result = auditInput(c.waccAudit, "final_wacc_value");
      if (equityWeight === null || costOfEquity === null || debtWeight === null || costOfDebt === null || tax === null || result === null) {
        return null;
      }
      return `WACC = E/V × Ke + D/V × Kd × (1 − t) = ${p(equityWeight * 100)} × ${p(costOfEquity * 100)} + ${p(debtWeight * 100)} × ${p(costOfDebt * 100)} × (1 − ${p(tax * 100)}) = ${p(result)}`;
    }
    case "backendDcf":
    case "backendFairValue":
      if (!c.dcf || c.dcf.intrinsic === null || c.dcf.upside === null) return null;
      return `Upside = intrinsic ÷ price − 1 = ${money(c.dcf.intrinsic)} ÷ ${money(c.dcf.price)} − 1 = ${signed(c.dcf.upside)}`;
    default:
      return null;
  }
}
