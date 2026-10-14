/**
 * Always-bilingual small labels (eyebrows, table headers): Korean first, English second, both
 * shown in every locale (the redesign's "시장 MARKET"). Korean terms follow
 * docs/design/MoneyView_Glossary.md; English is stored in plain case and uppercased by CSS.
 */
export const LABELS = {
  market: ["시장", "Market"],
  name: ["종목", "Name"],
  price: ["현재가", "Price"],
  change: ["등락률", "Change"],
  undervalued: ["저평가", "Undervalued"],
  overvalued: ["고평가", "Overvalued"],
  bridgeIncomplete: ["주당가치 산출 불가", "Per-share value unavailable"],
  case: ["케이스", "Case"],
  devRuntime: ["개발 런타임", "Developer runtime"],
  monteCarlo: ["몬테카를로 시뮬레이션", "Monte Carlo"],
  input: ["입력", "Input"],
  value: ["값", "Value"],
  scenario: ["시나리오", "Scenario"],
  intrinsicValue: ["내재가치", "Intrinsic value"],
  upside: ["상승여력", "Upside"],
  year: ["연도", "Year"],
  source: ["출처", "Source"],
  dataPoint: ["데이터", "Data point"],
  asOf: ["기준일", "As of"],
  supportingRow: ["근거 행", "Supporting row"],
  basis: ["근거", "Basis"],
  step: ["단계", "Step"],
  ticker: ["종목 코드", "Ticker"],
  sector: ["섹터", "Sector"],
  currentPrice: ["현재가", "Current Price"],
  trend: ["추세", "Trend"],
  volatility: ["변동성", "Volatility"],
  weight: ["비중", "Weight"],
  action: ["관리", "Action"],
  roicWacc: ["투하자본이익률 - WACC", "ROIC - WACC"],
  allocation: ["배분", "Allocation"],
  adjust: ["조정", "Adjust"],
  investedAmount: ["투자 금액", "Invested Amount"],
  projectedNetValue: ["예상 순자산가치", "Projected Net Value"],
  finalProfit: ["최종 손익", "Final Profit"],
  verdict: ["판정", "Verdict"],
  assumptions: ["가정", "Assumptions"],
  item: ["항목", "Item"],
  status: ["상태", "Status"],
  corporate: ["기업 분석", "Corporate"],
} as const satisfies Record<string, readonly [string, string]>;

export type LabelKey = keyof typeof LABELS;
