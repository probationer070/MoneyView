import type { DcfSummaryResponse as DCFResult } from "../../../../packages/shared-types";
import type {
  ComparisonSortKey,
  CorporateAssumptions,
  CorporateCompany,
  CorporateComparisonRowApi,
  ImpliedErpInputs,
  RawDatasetRow,
  WatchlistHolding,
} from "./corporateTypes";
import { isBridgeUnresolved } from "@/lib/bridgeQuality";
import { numberText, numberText2, pct } from "./corporateUtils";

interface CorporateDerivedSnapshot {
  debtToEquity: number;
  leveredBeta: number;
  bottomUpKe: number;
  spread: number;
  sustainableGrowth: number;
}

type ChartRecord = Record<string, string | number | boolean | null | undefined>;

/**
 * The row's DCF value when it is an intrinsic value per share, and null when it is not.
 *
 * When the equity bridge does not resolve, dcf_value falls back to enterprise value -- a
 * different financial quantity, not a smaller one. It cannot go in a $/share cell, be ranked
 * against per-share values, or share an axis with current_price, however close the numbers
 * happen to fall. `estimated` is a real per-share value and is returned as one.
 *
 * This is the only place that decides whether a comparison row's DCF value may be presented.
 * Do not branch on bridge_quality elsewhere: a fourth quality tier must be one edit, not a
 * search. The test itself lives in lib/bridgeQuality, shared with the estimated_value
 * surfaces, which carry the same quantity under a different field name.
 */
export function bridgedDcfValue(
  row: { dcf_value: number; bridge_quality?: string },
): number | null {
  return isBridgeUnresolved(row.bridge_quality) ? null : row.dcf_value;
}

export function sortComparisonRows(
  rows: CorporateComparisonRowApi[] = [],
  sortKey: ComparisonSortKey,
  sortDirection: "desc" | "asc",
) {
  return [...rows].sort((left, right) => {
    if (sortKey === "dcf_value") {
      // A row with no per-share value has no position in a per-share ranking, so it goes
      // last whichever way the user sorts. This check must precede the numeric comparison
      // and must NOT be reversed by sortDirection: Number(null) is 0, which would bury
      // these rows among genuinely small values in one direction.
      const leftValue = bridgedDcfValue(left);
      const rightValue = bridgedDcfValue(right);
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const dcfDelta = leftValue - rightValue;
      return sortDirection === "asc" ? dcfDelta : -dcfDelta;
    }
    const delta = Number(left[sortKey]) - Number(right[sortKey]);
    return sortDirection === "asc" ? delta : -delta;
  });
}

export function buildSimilarComparisonRows({
  rows,
  selectedTicker,
  selectedSector,
}: {
  rows: CorporateComparisonRowApi[];
  selectedTicker: string;
  selectedSector: string;
}) {
  if (rows.length === 0) return [];

  const selectedRow = rows.find((row) => row.ticker === selectedTicker) ?? rows[0] ?? null;
  const normalizedSector = selectedSector.trim().toLowerCase();
  const sameSectorRows = normalizedSector
    ? rows.filter((row) => row.sector.trim().toLowerCase() === normalizedSector)
    : [];
  const baseRows = sameSectorRows.length >= 2 ? sameSectorRows : rows;
  const prioritizedRows = selectedRow
    ? [selectedRow, ...baseRows.filter((row) => row.ticker !== selectedRow.ticker)]
    : baseRows;

  return prioritizedRows
    .filter((row, index, allRows) => allRows.findIndex((entry) => entry.ticker === row.ticker) === index)
    .slice(0, 6);
}

export function buildSimilarComparisonBarData(rows: CorporateComparisonRowApi[], selectedTicker: string) {
  return rows.map((row) => ({
    ticker: row.ticker,
    sector: row.sector,
    roic_minus_wacc: Number(row.roic_minus_wacc.toFixed(2)),
    expected_return_spread: Number(row.expected_return_spread.toFixed(2)),
    isSelected: row.ticker === selectedTicker,
  }));
}

export function buildSimilarComparisonScatterPeers(rows: CorporateComparisonRowApi[], selectedTicker: string) {
  return rows
    .filter((row) => row.ticker !== selectedTicker)
    // An enterprise value on an axis paired with current_price is not an outlier point,
    // it is a different quantity sharing an axis.
    .filter((row) => bridgedDcfValue(row) !== null)
    .map((row) => ({
      ticker: row.ticker,
      current_price: Number(row.current_price.toFixed(2)),
      dcf_value: Number(row.dcf_value.toFixed(2)),
      expected_return_spread: Number(row.expected_return_spread.toFixed(2)),
      bubble_size: Math.max(Math.abs(row.expected_return_spread) * 5, 80),
    }));
}

export function buildSimilarComparisonScatterSelected(row: CorporateComparisonRowApi | null) {
  return row && bridgedDcfValue(row) !== null
    ? [{
      ticker: row.ticker,
      current_price: Number(row.current_price.toFixed(2)),
      dcf_value: Number(row.dcf_value.toFixed(2)),
      expected_return_spread: Number(row.expected_return_spread.toFixed(2)),
      bubble_size: Math.max(Math.abs(row.expected_return_spread) * 5, 120),
    }]
    : [];
}

export function buildWatchlistCoverage(watchlistHoldings: WatchlistHolding[], companies: CorporateCompany[]) {
  const liveWatchlistTickers = watchlistHoldings.map((row) => row.ticker.toUpperCase());
  const registryTickers = new Set(companies.map((company) => company.ticker.toUpperCase()));
  const missingTickers = liveWatchlistTickers.filter((ticker) => !registryTickers.has(ticker));
  return {
    liveWatchlistCount: liveWatchlistTickers.length,
    registryCount: companies.length,
    missingTickers,
    isSynchronized: missingTickers.length === 0,
  };
}

export function buildRawDatasetRows({
  assumptions,
  derived,
  impliedMarketReturn,
  impliedErp,
  impliedErpInputs,
  dcfData,
  regionalHurdle,
  hurdleBars,
  betaTreemapProxy,
  waccCurve,
  valueMatrix,
}: {
  assumptions: CorporateAssumptions;
  derived: CorporateDerivedSnapshot;
  impliedMarketReturn: number;
  impliedErp: number;
  impliedErpInputs: ImpliedErpInputs;
  dcfData: DCFResult | null;
  regionalHurdle: ChartRecord[];
  hurdleBars: ChartRecord[];
  betaTreemapProxy: ChartRecord[];
  waccCurve: ChartRecord[];
  valueMatrix: ChartRecord[];
}) {
  const rows: RawDatasetRow[] = [];
  const pushRecord = (dataset: string, record: object, source: string) => {
    Object.entries(record).forEach(([field, value]) => {
      rows.push({ dataset, field, value: value == null ? "" : String(value), source });
    });
  };
  const pushSeries = (dataset: string, series: object[], source: string) => {
    series.forEach((record, index) => pushRecord(`${dataset}[${index + 1}]`, record, source));
  };

  pushRecord("active_assumptions", assumptions, "Realtime controls, SQLite corporate_metrics, and browser localStorage fallback");
  pushRecord("derived_metrics", {
    debtToEquity: numberText(derived.debtToEquity),
    leveredBeta: numberText2(derived.leveredBeta),
    impliedMarketReturn: pct(impliedMarketReturn),
    impliedErp: pct(impliedErp),
    bottomUpKe: pct(derived.bottomUpKe),
    spread: pct(derived.spread),
    sustainableGrowth: pct(derived.sustainableGrowth),
  }, "Frontend formulas shown in View Details");
  pushRecord("implied_erp_inputs", {
    sp500IndexLevel: numberText(impliedErpInputs.indexLevel),
    dividendYield: pct(impliedErpInputs.dividendYield),
    buybackYield: pct(impliedErpInputs.buybackYield),
    fiveYearGrowthPath: impliedErpInputs.growthRates.map((growth) => pct(growth)).join(" -> "),
    stableGrowth: pct(impliedErpInputs.stableGrowth),
    expectedMarketReturnIrr: pct(impliedMarketReturn),
    impliedErp: pct(impliedErp),
  }, "S&P 500 implied ERP model: price from market API; cash-flow yields and consensus growth path are model assumptions until constituent-level estimates are wired");
  if (dcfData) pushRecord("backend_dcf", dcfData, "FastAPI /corporate/dcf response");
  pushSeries("hurdle_rate_decomposition", regionalHurdle, "Hurdle Rate Decomposition chart dataset");
  pushSeries("hurdle_bar_components", hurdleBars, "Bottom-up Ke component dataset");
  pushSeries("beta_wacc_curve_beta_components", betaTreemapProxy, "Bottom-up Beta chart dataset");
  pushSeries("wacc_curve", waccCurve, "WACC U-Curve chart dataset");
  pushSeries("value_driver_matrix", valueMatrix, "4-Quadrant Value Driver Matrix dataset");
  return rows;
}
