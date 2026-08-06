import type { DcfSummaryResponse as DCFResult } from "../../../../packages/shared-types";
import type { CalculationDetail, CalculationDetailKey, CalculationRow } from "./components/calculationDetailTypes";
import { bridgedEstimatedValue, bridgedUpsidePct, UNBRIDGED_PLACEHOLDER } from "@/lib/bridgeQuality";
import { betaInterpretation, clamp, moneyText, numberText, numberText2, pct, pct2 } from "./calculationDetailFormatters";

interface AnnualMetricPoint {
  year: number;
  value: number | null;
}

interface CorporateAssumptionsSnapshot {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debtRatio: number;
  unleveredBeta: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  marketShare: number;
  governance: number;
  esgPenalty: number;
}

interface DerivedSnapshot {
  debtToEquity: number;
  leveredBeta: number;
  bottomUpKe: number;
  spread: number;
  sustainableGrowth: number;
}

interface ImpliedErpInputsSnapshot {
  indexLevel: number;
  dividendYield: number;
  buybackYield: number;
  growthRates: number[];
  stableGrowth: number;
}

interface MetricsHistorySnapshot {
  growth_cagr: number | null;
  growth_recent_average: number | null;
}

interface ValueMatrixPoint {
  name: string;
  growth: number;
  spread: number;
  fcff: number;
}

interface RegionalHurdlePoint {
  region: string;
  rf: number;
  erp: number;
  defaultSpread: number;
  riskMultiplier: number;
  crp: number;
  revenue: number;
}

interface BetaTreemapPoint {
  name: string;
  beta: number;
  size: number;
}

interface WaccCurvePoint {
  debt: number;
  wacc: number;
}

interface BuildCalculationDetailsArgs {
  companyName: string;
  assumptions: CorporateAssumptionsSnapshot;
  derived: DerivedSnapshot;
  dcfData?: DCFResult;
  sourceLabel: string;
  storageKey: string;
  taxRate: number;
  riskFreeRate: number;
  koreaCountryRiskPremium: number;
  growthBasisLabel: string;
  roicBasisLabel: string;
  annualGrowthRates: AnnualMetricPoint[];
  annualRoicValues: AnnualMetricPoint[];
  metricsHistoryData?: MetricsHistorySnapshot;
  impliedErpInputs: ImpliedErpInputsSnapshot;
  impliedMarketReturn: number;
  impliedErp: number;
  hasSp500Data: boolean;
  regionalHurdle: RegionalHurdlePoint[];
  betaTreemapProxy: BetaTreemapPoint[];
  waccCurve: WaccCurvePoint[];
  valueMatrix: ValueMatrixPoint[];
}

export function buildCalculationDetails({
  companyName,
  assumptions,
  derived,
  dcfData,
  sourceLabel,
  storageKey,
  taxRate,
  riskFreeRate,
  koreaCountryRiskPremium,
  growthBasisLabel,
  roicBasisLabel,
  annualGrowthRates,
  annualRoicValues,
  metricsHistoryData,
  impliedErpInputs,
  impliedMarketReturn,
  impliedErp,
  hasSp500Data,
  regionalHurdle,
  betaTreemapProxy,
  waccCurve,
  valueMatrix,
}: BuildCalculationDetailsArgs): Record<CalculationDetailKey, CalculationDetail> {
  // Every fair-value and upside string below is one of these two, never the raw field. When
  // the equity bridge does not resolve, estimated_value is an enterprise value and upside_pct
  // is a hardcoded 0.0, and this modal is where a suppressed table cell sends the reader.
  const fairValueText = (pending: string) => {
    if (!dcfData) return pending;
    const value = bridgedEstimatedValue(dcfData);
    return value === null ? UNBRIDGED_PLACEHOLDER : moneyText(value);
  };
  const upsideText = (pending: string) => {
    if (!dcfData) return pending;
    const upside = bridgedUpsidePct(dcfData);
    return upside === null ? UNBRIDGED_PLACEHOLDER : pct(upside);
  };
  // Measured by the backend as PV(terminal) / enterprise value. Unlike fair value it does
  // not depend on the equity bridge -- concentration is a property of the enterprise
  // valuation -- but it does require a valuation to have run.
  //
  // The presence check is a runtime one rather than a null check on a typed number: a result
  // restored from the sessionStorage cache can have been written by a build that predates
  // this field, and the type it is read back as cannot know that.
  const terminalShareText = (pending: string) => {
    if (!dcfData) return pending;
    const share = dcfData.terminal_value_share_pct;
    return share == null ? "N/A" : pct(share);
  };

  const assumptionDetail = ({
    title,
    label,
    value,
    unit,
    rawInputs,
    source,
    timeHorizon,
    formula,
    simulation,
    auditMetric,
  }: {
    title: string;
    label: string;
    value: string;
    unit: string;
    rawInputs: CalculationRow[];
    source: string;
    timeHorizon: string;
    formula: string;
    simulation: CalculationRow[];
    auditMetric?: "growth" | "roic" | "wacc" | "spread";
  }): CalculationDetail => ({
    title: `${companyName} ${title}`,
    timeHorizon,
    summary: [
      { label, value, source: "Final realtime assumption" },
      { label: "Ticker", value: assumptions.ticker, source: "Corporate company registry" },
      { label: "Unit", value: unit, source: "Display convention" },
      ...rawInputs,
    ],
    components: rawInputs,
    formula,
    result: value,
    sourcing: [
      { label: "Primary origin", value: source, source },
      { label: "Local persistence", value: "corporate_metrics", source: "SQLite" },
      { label: "Browser override", value: storageKey, source: "localStorage fallback" },
      { label: "Fallback model", value: "Built-in preset or deterministic sector default", source: "Used only when no ticker-specific row exists" },
    ],
    simulation,
    auditMetric,
  });

  return {
    realtime: {
      title: `${companyName} Realtime Assumptions`,
      timeHorizon: "Yahoo Finance annual statement window from fiscal years 2021+ where available. Growth uses 2021+ CAGR by default, ROIC can use annual or recent-average values, WACC and debt ratio use the latest available statement data, and CRP is fixed to South Korea.",
      summary: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: sourceLabel },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Country Risk Premium", value: pct(koreaCountryRiskPremium), source: "Fixed South Korea country risk premium" },
        { label: "FCFF", value: `$${numberText(assumptions.fcff)}B`, source: sourceLabel },
      ],
      components: [
        { label: "Ticker mapping", value: companyName, source: "Corporate company registry" },
        { label: "Primary storage key", value: assumptions.ticker, source: "Internal market-data identifier" },
        { label: "Persistence layer", value: "corporate_metrics", source: "SQLite" },
        { label: "Frontend cache", value: storageKey, source: "Browser localStorage fallback" },
      ],
      formula: "Active assumptions = Yahoo annual statements from 2021 onward -> saved corporate_metrics fallback -> browser override/current slider state -> generated company/sector default",
      result: `${companyName} loaded with WACC ${pct(assumptions.wacc)}, ROIC ${pct(assumptions.roic)}, beta ${numberText(assumptions.unleveredBeta)}`,
      sourcing: [
        { label: "Company Name", value: companyName, source: "Corporate company registry / Portfolio watchlist" },
        { label: "Financial assumptions", value: "Yahoo annual statements from 2021 onward", source: "Primary source for statement-derived metrics" },
        { label: "Generated defaults", value: "Deterministic company/sector model", source: "Used only when Yahoo statements or saved ticker metrics are unavailable" },
        { label: "Market price for DCF", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `Read ${assumptions.ticker} Yahoo annual statements from 2021 onward`, source: "FastAPI corporate metrics endpoint" },
        { label: "2", value: `Apply browser override from ${storageKey}`, source: "localStorage when present" },
        { label: "3", value: `Render ${pct(assumptions.growth)} growth, ${pct(assumptions.roic)} ROIC, ${pct(assumptions.wacc)} WACC`, source: "Final UI state" },
      ],
    },
    growth: {
      title: `${companyName} Growth Rate`,
      timeHorizon: `Yahoo Finance annual revenue values from fiscal years 2021+. Current display basis: ${growthBasisLabel}. Annual growth rates are shown below as supporting context only.`,
      summary: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: sourceLabel },
        { label: "Selected basis", value: growthBasisLabel, source: "Stable growth policy" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Realtime calculation" },
      ],
      components: [
        { label: "User growth input", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
        { label: "5-year CAGR", value: metricsHistoryData?.growth_cagr == null ? "Unavailable" : pct(metricsHistoryData.growth_cagr), source: "Yahoo annual revenue from 2021 onward" },
        { label: "Recent average", value: metricsHistoryData?.growth_recent_average == null ? "Unavailable" : pct(metricsHistoryData.growth_recent_average), source: "Supporting average of the most recent annual growth rates" },
        ...annualGrowthRates.map((point) => ({ label: `${point.year} annual growth`, value: point.value == null ? "Unavailable" : pct(point.value), source: "Yahoo annual revenue YoY growth" })),
        { label: "Display override", value: "Slider/local browser value may override", source: "Realtime assumptions UI" },
      ],
      formula: "Growth Rate = ((Revenue_last / Revenue_first)^(1 / year_span) - 1) x 100 using valid annual Yahoo revenue values from 2021 onward",
      result: pct(assumptions.growth),
      sourcing: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Stable CAGR from valid Yahoo annual revenue values from 2021 onward" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Yahoo annual capex and D&A reinvestment proxy, averaged across available years from 2021 onward" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values from 2021 onward under the stable ROIC policy" },
      ],
      simulation: [
        { label: "1", value: "Read Yahoo annual revenue from 2021 onward", source: "Corporate metrics history endpoint" },
        { label: "2", value: `Apply stable basis: ${growthBasisLabel}`, source: sourceLabel },
        { label: "3", value: pct(assumptions.growth), source: "Final Growth Rate" },
      ],
      auditMetric: "growth",
    },
    roic: assumptionDetail({
      title: "ROIC",
      label: "ROIC",
      value: pct(assumptions.roic),
      unit: "Percent",
      rawInputs: [
        { label: "NOPAT proxy", value: pct(assumptions.roic), source: "Yahoo operating income x (1 - stable statement tax rate)" },
        { label: "Invested capital proxy", value: "Equity + interest-bearing debt", source: "Yahoo annual balance sheet" },
        { label: "Selected basis", value: roicBasisLabel, source: "ROIC basis control" },
        ...annualRoicValues.map((point) => ({ label: `${point.year} ROIC`, value: point.value == null ? "Unavailable" : pct(point.value), source: "Annual Yahoo NOPAT / invested capital" })),
      ],
      source: "Yahoo annual statements: calculate ROIC for each available fiscal year from 2021 onward, then average annual ROIC values",
      timeHorizon: `Annual values from fiscal years 2021+. Current display basis: ${roicBasisLabel}; ROIC can be set to a single year or a recent/all-year average.`,
      formula: "ROIC = NOPAT / Invested Capital x 100",
      auditMetric: "roic",
      simulation: [
        { label: "1", value: `${pct(assumptions.roic)} / 100.0`, source: numberText(assumptions.roic / 100) },
        { label: "2", value: `${numberText(assumptions.roic / 100)} x 100`, source: pct(assumptions.roic) },
        { label: "3", value: pct(assumptions.roic), source: "Final ROIC assumption" },
      ],
    }),
    wacc: assumptionDetail({
      title: "WACC",
      label: "WACC",
      value: pct(assumptions.wacc),
      unit: "Percent",
      rawInputs: [
        { label: "Cost of equity", value: pct(derived.bottomUpKe), source: "Risk-free rate + implied ERP + beta model" },
        { label: "Debt ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual statement average debt ratio from 2021 onward when available" },
        { label: "Tax rate", value: pct(taxRate * 100), source: "Corporate tax assumption" },
      ],
      source: "Yahoo beta plus the latest available Yahoo annual statement debt/equity/tax/cost-of-debt inputs; South Korea CRP and base market rates are model inputs",
      timeHorizon: "WACC uses the most recent available annual statement capital structure rather than a 5-year average.",
      formula: "WACC = E/V x Ke + D/V x Kd x (1 - tax)",
      auditMetric: "wacc",
      simulation: [
        { label: "1", value: `Selected WACC input ${pct(assumptions.wacc)}`, source: sourceLabel },
        { label: "2", value: `Compare with bottom-up Ke ${pct(derived.bottomUpKe)}`, source: `Spread ${pct(assumptions.roic - assumptions.wacc)}` },
        { label: "3", value: pct(assumptions.wacc), source: "Final WACC assumption" },
      ],
    }),
    debtRatio: assumptionDetail({
      title: "Debt Ratio",
      label: "Debt Ratio",
      value: pct(assumptions.debtRatio),
      unit: "Percent of enterprise capital",
      rawInputs: [
        { label: "Debt weight", value: pct(assumptions.debtRatio), source: "Most recent Yahoo annual debt / (debt + equity)" },
        { label: "Equity weight", value: pct(100 - assumptions.debtRatio), source: "1 - debt weight" },
      ],
      source: "Yahoo annual balance sheet debt and equity values",
      timeHorizon: "Uses the most recent available annual Yahoo balance sheet, not a 5-year average.",
      formula: "Debt Ratio = Debt / (Debt + Equity) x 100",
      simulation: [
        { label: "1", value: `${pct(assumptions.debtRatio)} debt weight`, source: sourceLabel },
        { label: "2", value: `100.0% - ${pct(assumptions.debtRatio)} = ${pct(100 - assumptions.debtRatio)}`, source: "Equity weight" },
        { label: "3", value: pct(assumptions.debtRatio), source: "Final Debt Ratio assumption" },
      ],
    }),
    unleveredBeta: assumptionDetail({
      title: "Unlevered Beta",
      label: "Unlevered Beta",
      value: numberText(assumptions.unleveredBeta),
      unit: "Beta multiple",
      rawInputs: [
        { label: "Raw beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo Finance levered beta de-levered with average Yahoo statement D/E and tax rate" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Equity beta after applying financial leverage" },
        { label: "Beta Difference", value: numberText2(derived.leveredBeta - assumptions.unleveredBeta), source: "Levered beta - unlevered beta" },
        { label: "Beta interpretation", value: betaInterpretation(assumptions.unleveredBeta), source: "Beta convention: 1.0 average market risk; above 1.0 more volatile; below 1.0 less volatile" },
        { label: "Debt-to-equity", value: numberText(derived.debtToEquity), source: "Debt ratio conversion" },
      ],
      source: "Yahoo Finance market beta plus Yahoo annual statement average debt/equity and tax-rate inputs",
      timeHorizon: "Unlevered beta is derived from Yahoo beta and averaged annual statement capital structure from fiscal years 2021+; it is not directly reported in financial statements.",
      formula: "Unlevered Beta = Levered Beta / [1 + (1 - tax) x D/E]",
      simulation: [
        { label: "1", value: `Use betaU ${numberText(assumptions.unleveredBeta)}`, source: sourceLabel },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "3", value: numberText(assumptions.unleveredBeta), source: "Final Unlevered Beta assumption" },
      ],
    }),
    leveredBeta: {
      title: `${companyName} Levered Beta`,
      timeHorizon: "5-year beta convention for business risk, adjusted with the current debt ratio and tax-rate assumption.",
      summary: [
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Interpretation", value: betaInterpretation(derived.leveredBeta), source: "Market-risk convention" },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: `Debt ratio ${pct(assumptions.debtRatio)} / equity ratio ${pct(100 - assumptions.debtRatio)}` },
        { label: "Tax Shield", value: pct((1 - taxRate) * 100), source: `1 - tax rate ${pct(taxRate * 100)}` },
      ],
      components: [
        { label: "Beta = 1.0", value: "Average market risk", source: "Benchmark interpretation" },
        { label: "Beta > 1.0", value: "More volatile than the market", source: "Example: beta 1.5 implies 50.0% higher risk than the market" },
        { label: "Beta < 1.0", value: "Less volatile than the market", source: "Example: beta 0.7 implies 30.0% lower risk than the market" },
        { label: "Business risk", value: numberText(assumptions.unleveredBeta), source: "Unlevered beta" },
        { label: "Financial leverage", value: numberText(derived.debtToEquity), source: "Debt / equity conversion" },
        { label: "Tax shield", value: pct((1 - taxRate) * 100), source: "After-tax leverage adjustment" },
      ],
      formula: "Levered Beta = betaU x [1 + (1 - tax rate) x D/E]",
      result: numberText2(derived.leveredBeta),
      sourcing: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo beta de-levered with averaged annual statement D/E and tax rate from 2021 onward" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt / (debt + equity), averaged from 2021 onward" },
        { label: "Tax Rate", value: pct(taxRate * 100), source: "Corporate tax assumption | Period: current model policy" },
      ],
      simulation: [
        { label: "1", value: `D/E = ${pct(assumptions.debtRatio)} / ${pct(100 - assumptions.debtRatio)}`, source: numberText(derived.debtToEquity) },
        { label: "2", value: `1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}`, source: numberText(1 + (1 - taxRate) * derived.debtToEquity) },
        { label: "3", value: `${numberText(assumptions.unleveredBeta)} x ${numberText(1 + (1 - taxRate) * derived.debtToEquity)}`, source: numberText2(derived.leveredBeta) },
      ],
    },
    crp: assumptionDetail({
      title: "Country Risk Premium",
      label: "Country Risk Premium",
      value: pct(koreaCountryRiskPremium),
      unit: "Percent",
      rawInputs: [
        { label: "South Korea CRP", value: pct(koreaCountryRiskPremium), source: "Fixed country-risk assumption" },
      ],
      source: "Country risk fallback; Yahoo financial statements do not report country risk premium",
      timeHorizon: "Fixed South Korea country-risk assumption. This metric cannot be fetched from Yahoo financial statements.",
      formula: "CRP = fixed South Korea country risk premium",
      simulation: [
        { label: "1", value: `Use South Korea CRP ${pct(koreaCountryRiskPremium)}`, source: "Fixed country-risk assumption" },
        { label: "2", value: `${pct(riskFreeRate)} + beta x implied ERP + ${pct(koreaCountryRiskPremium)}`, source: "Feeds Bottom-up Ke" },
      ],
    }),
    erp: {
      title: `${companyName} Implied Equity Risk Premium`,
      timeHorizon: "Current S&P 500 level from the market API when available; cash-flow yields and 5-year growth path are model assumptions until constituent-level dividends, buybacks, and analyst estimates are connected.",
      summary: [
        { label: "S&P 500 Level", value: numberText(impliedErpInputs.indexLevel), source: hasSp500Data ? "Market API /market/index/^GSPC latest close" : "Fallback normalized index level" },
        { label: "Expected Market Return (IRR)", value: pct(impliedMarketReturn), source: "Reverse-engineered from projected cash flows" },
        { label: "Implied ERP", value: pct(impliedErp), source: "Expected market return - risk-free rate" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Beta x Implied ERP", value: pct(derived.leveredBeta * impliedErp), source: "Equity risk premium contribution" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Hurdle-rate model" },
      ],
      components: [
        { label: "Current Price", value: numberText(impliedErpInputs.indexLevel), source: "S&P 500 index level" },
        { label: "Cash Flows", value: `${pct(impliedErpInputs.dividendYield)} dividends + ${pct(impliedErpInputs.buybackYield)} buybacks`, source: "Aggregate cash-flow yield proxy" },
        { label: "5Y Growth Assumptions", value: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "), source: "Analyst-consensus growth path proxy" },
        { label: "Stable Growth", value: pct(impliedErpInputs.stableGrowth), source: "Converges to risk-free rate after year 5" },
        { label: "Implied ERP", value: pct(impliedErp), source: "IRR - risk-free rate" },
        { label: "Company beta multiplier", value: numberText2(derived.leveredBeta), source: "Levered Beta" },
        { label: "Contribution to Ke", value: pct(derived.leveredBeta * impliedErp), source: "Levered Beta x Implied ERP" },
      ],
      formula: "Implied ERP = Expected Market Return (IRR) - Risk-Free Rate; Equity Risk Premium Contribution = Levered Beta x Implied ERP",
      result: pct(derived.leveredBeta * impliedErp),
      sourcing: [
        { label: "S&P 500 Price", value: numberText(impliedErpInputs.indexLevel), source: "Market API /market/index/^GSPC | Period: current latest close or normalized fallback" },
        { label: "Cash Flow Yield", value: pct(impliedErpInputs.dividendYield + impliedErpInputs.buybackYield), source: "Dividend + share-buyback yield proxy | Replace with constituent aggregation when available" },
        { label: "Growth", value: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "), source: "5-year analyst-consensus growth path proxy" },
        { label: "Stable Growth", value: pct(impliedErpInputs.stableGrowth), source: "Risk-free rate as long-term economic growth proxy" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada beta model | Period: 5-year beta convention plus current leverage" },
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "FRED / macro assumption | Period: current market snapshot" },
      ],
      simulation: [
        { label: "1", value: `Solve IRR where S&P 500 price ${numberText(impliedErpInputs.indexLevel)} equals PV of dividends + buybacks and terminal value`, source: pct(impliedMarketReturn) },
        { label: "2", value: `${pct(impliedMarketReturn)} - ${pct(riskFreeRate)}`, source: pct(impliedErp) },
        { label: "3", value: `${numberText2(derived.leveredBeta)} x ${pct(impliedErp)}`, source: pct(derived.leveredBeta * impliedErp) },
        { label: "4", value: `${pct(riskFreeRate)} + ${pct(derived.leveredBeta * impliedErp)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    reinvestment: assumptionDetail({
      title: "Reinvestment Rate",
      label: "Reinvestment Rate",
      value: pct(assumptions.reinvestment),
      unit: "Percent",
      rawInputs: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Yahoo annual max(capex - D&A, 0) / NOPAT, averaged across available years from 2021 onward" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Return on invested capital input" },
      ],
      source: "Yahoo annual cash-flow and income-statement values",
      timeHorizon: "Annual reinvestment rates from fiscal years 2021+ are averaged; this is not calculated from one pooled 5-year total.",
      formula: "Reinvestment Rate = Reinvestment / NOPAT x 100",
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `${numberText(assumptions.reinvestment)} x ${numberText(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "3", value: pct(assumptions.reinvestment), source: "Final Reinvestment Rate assumption" },
      ],
    }),
    innovation: assumptionDetail({
      title: "Innovation Index",
      label: "Innovation Index",
      value: numberText(assumptions.innovation),
      unit: "0-100 score",
      rawInputs: [
        { label: "Product / R&D score", value: numberText(assumptions.innovation), source: "Yahoo annual R&D / revenue intensity proxy, scaled to a 0-100 score and averaged from 2021 onward" },
      ],
      source: "Yahoo annual income statement R&D intensity proxy when available; saved/preset score is fallback",
      timeHorizon: "Annual R&D intensity values from fiscal years 2021+ are scaled and averaged; Yahoo does not directly report an Innovation Index.",
      formula: "Innovation Index = clamp((R&D / revenue x 100) x 10, 0, 100), averaged across annual statement years",
      simulation: [
        { label: "1", value: `Normalize raw innovation signal to ${numberText(assumptions.innovation)}`, source: "0-100 scale" },
        { label: "2", value: numberText(assumptions.innovation), source: "Final Innovation Index assumption" },
      ],
    }),
    governance: assumptionDetail({
      title: "Governance Quality",
      label: "Governance Quality",
      value: numberText(assumptions.governance),
      unit: "0-100 score",
      rawInputs: [
        { label: "Governance score", value: numberText(assumptions.governance), source: "Annual Report / proxy statement review" },
      ],
      source: "Annual Report, proxy statement, and governance review normalized into SQLite corporate_metrics",
      timeHorizon: "Latest annual report or proxy statement cycle.",
      formula: "Governance Quality = normalized governance score on a 0-100 scale",
      simulation: [
        { label: "1", value: numberText(assumptions.governance), source: "Final Governance Quality assumption" },
      ],
    }),
    esgPenalty: assumptionDetail({
      title: "ESG / Agency Penalty",
      label: "ESG / Agency Penalty",
      value: numberText(assumptions.esgPenalty),
      unit: "0-100 penalty score",
      rawInputs: [
        { label: "Penalty score", value: numberText(assumptions.esgPenalty), source: "ESG / agency risk review" },
      ],
      source: "ESG risk review, governance notes, and sector preset normalized into SQLite corporate_metrics",
      timeHorizon: "Latest annual report, controversy, or governance review cycle.",
      formula: "ESG / Agency Penalty = subjective 0-100 penalty score set on this panel",
      simulation: [
        { label: "1", value: numberText(assumptions.esgPenalty), source: "Final ESG / Agency Penalty assumption" },
      ],
    }),
    spread: {
      title: `${companyName} ROIC - WACC Spread`,
      timeHorizon: "Realtime calculation from current ROIC and WACC assumptions.",
      summary: [
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: "Spread", value: pct(derived.spread), source: "Realtime calculation" },
        { label: "Status", value: derived.spread >= 0 ? "Value creation" : "Value destruction", source: "ROIC > WACC rule" },
      ],
      components: [
        { label: "Return on Invested Capital", value: pct(assumptions.roic), source: "Ticker-specific corporate metric" },
        { label: "Weighted Average Cost of Capital", value: pct(assumptions.wacc), source: "Ticker-specific corporate metric" },
      ],
      formula: `ROIC - WACC = ${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`,
      result: pct(derived.spread),
      sourcing: [
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values averaged from 2021 onward" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement average capital weights plus Yahoo beta and model rate inputs" },
        { label: "Benchmark", value: "Positive spread", source: "Corporate finance value-creation rule" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`, source: pct(derived.spread) },
        { label: "2", value: `${numberText(assumptions.roic)} - ${numberText(assumptions.wacc)}`, source: numberText(derived.spread) },
        { label: "3", value: pct(derived.spread), source: "Final ROIC - WACC spread" },
      ],
      auditMetric: "spread",
    },
    bottomUpKe: {
      title: `${companyName} Bottom-up Ke`,
      timeHorizon: "Current market snapshot for risk-free rate and implied ERP; fixed South Korea CRP; latest Yahoo statement capital structure for leverage.",
      summary: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "Manual macro assumption" },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Implied Equity Risk Premium", value: pct(impliedErp), source: "S&P 500 implied ERP model" },
        { label: "Country Risk Premium", value: pct(koreaCountryRiskPremium), source: "Fixed South Korea country risk premium" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Realtime calculation" },
      ],
      components: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Ticker-specific corporate metric" },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: `Debt Ratio ${pct(assumptions.debtRatio)} / Equity Ratio ${pct(100 - assumptions.debtRatio)}` },
        { label: "Tax Shield", value: pct((1 - taxRate) * 100), source: `1 - tax rate ${pct(taxRate * 100)}` },
        { label: "Levered Beta", value: numberText2(derived.leveredBeta), source: "betaU x [1 + (1 - tax) x D/E]" },
      ],
      formula: `Ke = ${pct(riskFreeRate)} + ${numberText2(derived.leveredBeta)} x ${pct(impliedErp)} + ${pct(koreaCountryRiskPremium)}`,
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "Manual macro assumption" },
        { label: "Implied ERP", value: pct(impliedErp), source: "Expected market return IRR - risk-free rate" },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: "Fixed South Korea country risk premium" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt ratios averaged from 2021 onward" },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Yahoo beta de-levered with averaged annual statement D/E and tax rate" },
      ],
      simulation: [
        { label: "1", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "2", value: `${pct(riskFreeRate)} + ${numberText2(derived.leveredBeta)} x ${pct(impliedErp)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
        { label: "3", value: pct(derived.bottomUpKe), source: "Final Bottom-up Ke" },
      ],
    },
    backendDcf: {
      title: `${companyName} Intrinsic DCF`,
      timeHorizon: "Current realtime assumption set sent to the backend DCF endpoint; market price uses the latest available quote/cache point.",
      summary: [
        { label: "Intrinsic DCF Value", value: fairValueText("Calculating"), source: "Backend DCF engine" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
        { label: "Upside / Downside", value: upsideText("Loading"), source: "Realtime calculation" },
        { label: "Status", value: dcfData?.status ?? "Calculating", source: "DCF value-vs-price rule" },
      ],
      components: [
        { label: "Revenue Growth", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
        { label: "Operating Margin Proxy", value: pct(clamp(assumptions.roic, -100, 100)), source: "ROIC input mapped to backend margin" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Realtime Assumptions control" },
        { label: "Terminal Growth", value: pct(clamp(assumptions.growth, -10, 10)), source: "Growth input clamped to backend boundary" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Realtime Assumptions control" },
      ],
      formula: `Intrinsic DCF request = growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, terminal growth ${pct(clamp(assumptions.growth, -10, 10))}, FCFF ${moneyText(assumptions.fcff)}B`,
      result: dcfData ? `${fairValueText("Calculating")} intrinsic value, ${upsideText("Loading")} versus current price` : "Calculating",
      sourcing: [
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Assumptions", value: "Debounced ticker inputs", source: "Corporate Analysis UI" },
        { label: "Market price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `Send growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, FCFF ${moneyText(assumptions.fcff)}B`, source: "DCF request payload" },
        { label: "2", value: dcfData ? `${fairValueText("Calculating")} / ${moneyText(dcfData.current_price)} - 1` : "Waiting for backend result", source: upsideText("Loading") },
        { label: "3", value: dcfData ? `${fairValueText("Calculating")} intrinsic value` : "Calculating", source: "Final Backend DCF result" },
      ],
    },
    sustainableGrowth: {
      title: `${companyName} Sustainable Growth`,
      timeHorizon: "Realtime calculation from current reinvestment rate and ROIC assumptions; source inputs typically use 5-year normalized history or LTM fallback.",
      summary: [
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Realtime calculation" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "User Growth Rate", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
      ],
      components: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Share of after-tax operating income reinvested" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Return generated on invested capital" },
        { label: "Growth Gap", value: pct(assumptions.growth - derived.sustainableGrowth), source: "User growth minus sustainable growth" },
      ],
      formula: `Sustainable Growth = Reinvestment Rate x ROIC = ${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`,
      result: pct(derived.sustainableGrowth),
      sourcing: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Yahoo annual reinvestment / NOPAT values averaged from 2021 onward" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values averaged from 2021 onward" },
        { label: "Comparison Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: `${numberText(assumptions.reinvestment)} x ${numberText(assumptions.roic)} / 100`, source: numberText(derived.sustainableGrowth) },
        { label: "3", value: pct(derived.sustainableGrowth), source: "Final Sustainable Growth" },
      ],
    },
    hurdleDecomposition: {
      title: `${companyName} Hurdle Rate Decomposition`,
      timeHorizon: "Current market snapshot for risk-free rate and market-implied ERP, shown across US, EU, Korea, and emerging-market hurdle-rate indicators. Korea uses the fixed Korea CRP assumption.",
      summary: [
        { label: "Risk-free Rate", value: pct(riskFreeRate), source: "FRED / macro assumption" },
        { label: "Expected Market Return (IRR)", value: pct(impliedMarketReturn), source: "S&P 500 implied return from price and projected cash flows" },
        { label: "Implied ERP", value: pct2(impliedErp), source: "Expected market return - risk-free rate" },
        { label: "Beta x Implied ERP", value: pct(derived.leveredBeta * impliedErp), source: "Levered beta multiplied by implied ERP" },
        { label: "CRP", value: pct(koreaCountryRiskPremium), source: "Fixed South Korea country risk premium" },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Realtime hurdle-rate model" },
      ],
      components: regionalHurdle.map((region) => ({
        label: region.region,
        value: `RF ${pct(region.rf)}, implied ERP ${pct2(region.erp)}, spread ${pct(region.defaultSpread)}, multiplier ${numberText(region.riskMultiplier)}, CRP ${pct(region.crp)}, revenue weight ${numberText(region.revenue)}`,
        source: region.region === "US"
          ? "US indicator uses mature-market CRP of 0.0%; market risk is carried through implied ERP."
          : region.region === "Korea"
            ? "Korea indicator applies the fixed Korea country risk premium."
            : `${region.region} indicator applies the regional default spread and risk multiplier proxy.`,
      })),
      formula: "Bottom-up Ke = risk-free rate + levered beta x implied ERP + selected-region CRP; Implied ERP = market IRR - risk-free rate",
      result: pct(derived.bottomUpKe),
      sourcing: regionalHurdle.map((region) => ({
        label: region.region,
        value: `RF ${pct(region.rf)}, implied ERP ${pct2(region.erp)}, CRP ${pct(region.crp)}`,
        source: region.region === "Korea" ? "Fixed Korea CRP assumption" : "Regional hurdle-rate indicator",
      })),
      simulation: [
        { label: "1", value: "Show US, EU, Korea, and emerging-market indicators", source: "Regional hurdle-rate indicator set" },
        { label: "2", value: `Implied ERP = market IRR ${pct(impliedMarketReturn)} - risk-free rate ${pct(riskFreeRate)}`, source: pct2(impliedErp) },
        { label: "3", value: `Levered beta premium = ${numberText2(derived.leveredBeta)} x ${pct2(impliedErp)}`, source: pct(derived.leveredBeta * impliedErp) },
        { label: "4", value: `${pct(riskFreeRate)} + ${pct(derived.leveredBeta * impliedErp)} + ${pct(koreaCountryRiskPremium)}`, source: pct(derived.bottomUpKe) },
      ],
    },
    betaWaccCurve: {
      title: `${companyName} Bottom-up Beta + WACC U-Curve`,
      timeHorizon: "5-year beta convention for business risk; WACC curve is a current scenario sweep from 0% to 90% debt.",
      summary: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: "Debt ratio conversion" },
        { label: "Financial Beta", value: numberText2(derived.leveredBeta), source: "Hamada formula" },
        { label: "Current Debt Ratio", value: pct(assumptions.debtRatio), source: "Reference line on WACC curve" },
      ],
      components: [
        ...betaTreemapProxy.map((item) => ({
          label: `${item.name} beta`,
          value: item.name === "Financial" ? numberText2(item.beta) : numberText(item.beta),
          source: item.name === "Industry"
            ? `Segment size ${numberText(item.size)}. Industry Beta is the pure business risk of the sector before company-specific capital structure. ${betaInterpretation(item.beta)}`
            : item.name === "Operating"
              ? `Segment size ${numberText(item.size)}. Operating Beta (Unlevered) is asset risk from the operating business excluding financial structure. ${betaInterpretation(item.beta)}`
              : `Segment size ${numberText(item.size)}. Financial Beta is the additional equity risk incurred from financial leverage and debt. ${betaInterpretation(item.beta)}`,
        })),
        ...waccCurve.map((point) => ({ label: `${numberText(point.debt)}% debt`, value: pct(point.wacc), source: "WACC U-curve scenario point" })),
      ],
      formula: "Levered Beta = betaU x [1 + (1 - tax) x D/E]; WACC curve = WACC - 2.4 x debt/45 + 3.2 x (debt/70)^2",
      result: `${numberText2(derived.leveredBeta)} beta; current WACC ${pct(assumptions.wacc)}`,
      sourcing: [
        { label: "Industry Beta", value: numberText(assumptions.unleveredBeta), source: "Pure sector business risk before company capital structure adjustments" },
        { label: "Operating Beta (Unlevered)", value: numberText(assumptions.unleveredBeta), source: "Asset risk excluding financial structure; Yahoo beta de-levered with averaged annual statement D/E and tax rate" },
        { label: "Financial Beta", value: numberText2(derived.leveredBeta), source: "Additional leverage risk from Hamada formula after applying D/E and tax shield" },
        { label: "Beta convention", value: betaInterpretation(derived.leveredBeta), source: "Beta 1.0 = average market risk; beta above/below 1.0 means proportionally higher/lower volatility" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Yahoo annual balance sheet debt / (debt + equity), averaged from 2021 onward" },
        { label: "Tax Rate", value: pct(taxRate * 100), source: "Corporate tax assumption" },
      ],
      simulation: [
        { label: "1", value: `D/E = ${pct(assumptions.debtRatio)} / ${pct(100 - assumptions.debtRatio)}`, source: numberText(derived.debtToEquity) },
        { label: "2", value: `${numberText(assumptions.unleveredBeta)} x [1 + ${pct((1 - taxRate) * 100)} x ${numberText(derived.debtToEquity)}]`, source: numberText2(derived.leveredBeta) },
        { label: "3", value: `Current curve marker at ${pct(assumptions.debtRatio)}`, source: pct(assumptions.wacc) },
      ],
    },
    valueDriverMatrix: {
      title: `${companyName} 4-Quadrant Value Driver Matrix`,
      timeHorizon: "Current realtime company assumptions plus static peer scenario points used for quadrant context.",
      summary: [
        { label: "Growth", value: pct(assumptions.growth), source: "X-axis" },
        { label: "ROIC - WACC", value: pct(derived.spread), source: "Y-axis" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Bubble size" },
        { label: "Quadrant", value: derived.spread >= 0 && assumptions.growth >= 0 ? "Growth + value creation" : "Review required", source: "Quadrant rule" },
      ],
      components: valueMatrix.map((item) => ({
        label: item.name,
        value: `growth ${pct(item.growth)}, spread ${pct(item.spread)}, FCFF ${numberText(item.fcff)}`,
        source: item.name === companyName ? "Current company segment" : "Static peer scenario segment",
      })),
      formula: "Matrix point = (growth, ROIC - WACC); bubble size = FCFF magnitude",
      result: `${pct(assumptions.growth)} growth, ${pct(derived.spread)} spread`,
      sourcing: [
        { label: "Growth", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Yahoo annual NOPAT / invested capital values averaged from 2021 onward when available" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement averages plus Yahoo beta and model rate inputs" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
      ],
      simulation: [
        { label: "1", value: `X = growth = ${pct(assumptions.growth)}`, source: "Matrix X-axis" },
        { label: "2", value: `Y = ${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`, source: pct(derived.spread) },
        { label: "3", value: `Bubble = clamp(${numberText(assumptions.fcff)} / 1.6, 10.0, 100.0)`, source: numberText(clamp(assumptions.fcff / 1.6, 10, 100)) },
      ],
    },
    dcfCoreModules: {
      title: `${companyName} DCF Core Modules`,
      timeHorizon: "Current realtime assumption set; FCFF uses LTM or normalized annual-report input; current price is comparison context only.",
      summary: [
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Reinvestment x ROIC" },
        { label: "Terminal Value Share", value: terminalShareText("Calculating"), source: "Backend DCF engine" },
        { label: "FCFF Magnitude", value: `${moneyText(assumptions.fcff)}B`, source: sourceLabel },
        { label: "Intrinsic DCF Value", value: fairValueText("N/A"), source: "Backend DCF engine" },
      ],
      components: [
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Sustainable growth component" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Sustainable growth component" },
        { label: "Growth", value: pct(assumptions.growth), source: "Projected FCFF component" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Discount rate and terminal denominator" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
      ],
      formula: "Sustainable Growth = reinvestment x ROIC / 100; Terminal Value Share = PV(terminal value) / enterprise value",
      result: `${pct(derived.sustainableGrowth)} sustainable growth; ${terminalShareText("terminal value share calculating")} terminal value share`,
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
      simulation: [
        { label: "1", value: `${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`, source: pct(derived.sustainableGrowth) },
        { label: "2", value: "PV(terminal value) / enterprise value", source: terminalShareText("Waiting for backend result") },
        { label: "3", value: dcfData ? `${fairValueText("N/A")} vs ${moneyText(dcfData.current_price)}` : "Waiting for backend result", source: upsideText("Loading") },
      ],
    },
    terminalValueShare: {
      title: `${companyName} Terminal Value Share`,
      timeHorizon: "Measured from the backend DCF that ran against the current assumption set. Not bounded: a share near 100% is a real reading about this valuation, and clamping it would hide the concentration it is reporting.",
      summary: [
        { label: "Terminal Value Share", value: terminalShareText("Calculating"), source: "Backend DCF engine | Period: current realtime scenario" },
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates averaged from 2021 onward when available | Period: current override can replace backend value" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo statement averages plus Yahoo beta and model rate inputs | Period: current model snapshot" },
        { label: "What it measures", value: "Share of enterprise value from the perpetuity", source: "Terminal-value concentration | Period: model definition" },
      ],
      components: [
        { label: "PV of terminal value", value: "Terminal value discounted over the 5-year forecast", source: "Numerator | Period: current realtime scenario" },
        { label: "Enterprise value", value: "PV of explicit FCFF + PV of terminal value", source: "Denominator | Period: current realtime scenario" },
        { label: "Terminal denominator", value: `WACC - terminal growth, from ${pct(assumptions.wacc)} WACC`, source: "What the share is most sensitive to | Period: current assumption state" },
      ],
      formula: "Terminal Value Share = PV(terminal value) / enterprise value",
      result: terminalShareText("Calculating"),
      sourcing: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Yahoo annual revenue growth rates from 2021 onward / saved fallback / browser override" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Yahoo-derived WACC / saved fallback / browser override" },
        { label: "Terminal model", value: "Gordon growth perpetuity", source: "packages/core_finance/dcf.py" },
      ],
      simulation: [
        { label: "1", value: "Discount the 5 explicit FCFF years at WACC", source: "PV of explicit forecast" },
        { label: "2", value: "Discount the Gordon terminal value over the same 5 years", source: "PV of terminal value" },
        { label: "3", value: "PV(terminal) / (PV(explicit) + PV(terminal))", source: terminalShareText("Waiting for backend result") },
      ],
    },
    fcffMagnitude: {
      title: `${companyName} FCFF Magnitude`,
      timeHorizon: "LTM or normalized annual-report FCFF input from the current ticker row; browser slider overrides are current-session realtime values.",
      summary: [
        { label: "FCFF Magnitude", value: `${moneyText(assumptions.fcff)}B`, source: `${sourceLabel} | Period: LTM or normalized annual report` },
        { label: "ROIC", value: pct(assumptions.roic), source: "Operating return context | Period: LTM or 5-year normalized" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Cash-flow reinvestment context | Period: LTM or 5-year normalized" },
        { label: "Bubble Size Proxy", value: numberText(clamp(assumptions.fcff / 1.6, 10, 100)), source: "Value Driver Matrix visualization scale | Period: current chart scenario" },
      ],
      components: [
        { label: "FCFF raw input", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward when available" },
        { label: "Value matrix scale", value: numberText(clamp(assumptions.fcff / 1.6, 10, 100)), source: "clamp(FCFF / 1.6, 10, 100) | Period: current chart scenario" },
        { label: "DCF payload", value: `${moneyText(assumptions.fcff)}B`, source: "Submitted to backend DCF endpoint | Period: current debounced request" },
      ],
      formula: "FCFF Magnitude = normalized annual-report FCFF input; visualization size = clamp(FCFF / 1.6, 10, 100)",
      result: `${moneyText(assumptions.fcff)}B`,
      sourcing: [
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "Yahoo annual free cash flow values averaged from 2021 onward / saved fallback / browser override" },
        { label: "Ticker", value: assumptions.ticker, source: "Corporate company registry" },
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend payload field" },
      ],
      simulation: [
        { label: "1", value: `Read FCFF input ${moneyText(assumptions.fcff)}B`, source: sourceLabel },
        { label: "2", value: `clamp(${numberText(assumptions.fcff)} / 1.6, 10.0, 100.0)`, source: numberText(clamp(assumptions.fcff / 1.6, 10, 100)) },
        { label: "3", value: `Send ${moneyText(assumptions.fcff)}B to backend DCF`, source: "DCF payload" },
      ],
    },
    backendFairValue: {
      title: `${companyName} Intrinsic DCF Value`,
      timeHorizon: "Current backend DCF response using debounced realtime assumptions and the latest available market price/cache point.",
      summary: [
        { label: "Intrinsic DCF Value", value: fairValueText("N/A"), source: "Backend DCF engine | Period: current debounced request" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache | Period: latest available quote/cache point" },
        { label: "Upside / Downside", value: upsideText("Loading"), source: "Fair value vs current price | Period: current backend response" },
        { label: "Status", value: dcfData?.status ?? "Calculating", source: "Backend valuation classification | Period: current backend response" },
      ],
      components: [
        { label: "Revenue Growth", value: pct(assumptions.growth), source: "DCF payload | Period: 5-year normalized or current override" },
        { label: "Operating Margin Proxy", value: pct(clamp(assumptions.roic, -100, 100)), source: "ROIC mapped to backend margin | Period: LTM or 5-year normalized" },
        { label: "WACC", value: pct(assumptions.wacc), source: "DCF payload | Period: current market snapshot" },
        { label: "Terminal Growth", value: pct(clamp(assumptions.growth, -10, 10)), source: "Growth clamped to backend terminal-growth boundary | Period: current DCF request" },
        { label: "FCFF", value: `${moneyText(assumptions.fcff)}B`, source: "DCF payload | Period: LTM or normalized annual report" },
      ],
      formula: "Intrinsic DCF Value = backend DCF endpoint output from FCFF, terminal value, and the equity bridge; Upside = intrinsic value / current price - 1",
      result: fairValueText("N/A"),
      sourcing: [
        { label: "DCF endpoint", value: `/corporate/dcf/${assumptions.ticker}`, source: "FastAPI backend" },
        { label: "Current Price", value: dcfData ? moneyText(dcfData.current_price) : "Loading", source: "Yahoo Finance / local OHLCV cache | Period: latest available quote/cache point" },
        { label: "Assumptions", value: "Debounced realtime UI state", source: "Corporate Analysis controls | Period: current session" },
      ],
      simulation: [
        { label: "1", value: `POST growth ${pct(assumptions.growth)}, WACC ${pct(assumptions.wacc)}, terminal growth ${pct(clamp(assumptions.growth, -10, 10))}`, source: "Backend DCF request" },
        { label: "2", value: dcfData ? `${fairValueText("N/A")} / ${moneyText(dcfData.current_price)} - 1` : "Waiting for backend result", source: upsideText("Loading") },
        { label: "3", value: fairValueText("N/A"), source: "Final Intrinsic DCF Value" },
      ],
    },
  };
}
