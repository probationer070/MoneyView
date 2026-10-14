"use client";

import type { DcfFullReport } from "../../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { useT } from "@/lib/i18n/locale";
import type { CalculationDetail, RawDatasetRow } from "../calculationDetailTypes";
import { DcfSensitivityTable } from "../DcfSensitivityTable";
import { RawDatasetSection, statusFromText, TABLE, TD, TD_FIGURE, THEAD, TR } from "./detailParts";

export interface StockPriceRow { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface QuarterlyStatementRow { ticker: string; statement: string; period: string; metric: string; value: number }

export interface RawDataTabProps {
  detail: CalculationDetail;
  ticker: string;
  rawDatasetRows: RawDatasetRow[];
  historicalPrices: StockPriceRow[];
  historicalStatus: string;
  historicalIsLoading: boolean;
  historicalIsError: boolean;
  quarterlyStatementRows: QuarterlyStatementRow[];
  quarterlyStatementStatus: string;
  quarterlyStatementsIsLoading: boolean;
  quarterlyStatementsIsError: boolean;
  dcfFullReport: DcfFullReport | null;
  dcfFullReportStatus: string | null;
  dcfFullReportIsLoading: boolean;
  dcfFullReportIsError: boolean;
  onRequestDcfFullReport?: (() => void) | null;
  onDownloadRawDatasetCsv: () => void;
  onDownloadHistoricalPriceCsv: () => void;
  onDownloadQuarterlyStatementsCsv: () => void;
  onPrint: () => void;
  formatNumber: (value: number) => string;
  formatNumber2: (value: number) => string;
  formatPct: (value: number) => string;
}

// Spec §4 "Raw data": OHLCV, quarterly statements, the full DCF report (5x5 grid included), CSV.
export function RawDataTab(props: RawDataTabProps) {
  const {
    detail, ticker, rawDatasetRows, historicalPrices, historicalStatus, historicalIsLoading, historicalIsError,
    quarterlyStatementRows, quarterlyStatementStatus, quarterlyStatementsIsLoading, quarterlyStatementsIsError,
    dcfFullReport, dcfFullReportStatus, dcfFullReportIsLoading, dcfFullReportIsError, onRequestDcfFullReport,
    onDownloadRawDatasetCsv, onDownloadHistoricalPriceCsv, onDownloadQuarterlyStatementsCsv, onPrint,
    formatNumber, formatNumber2, formatPct,
  } = props;
  const t = useT();
  const showDcfFullReport = detail.title.includes("Backend DCF") || detail.title.includes("Backend Fair Value") || detail.title.includes("Intrinsic DCF");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton label={t("corporate.detail.exportAnalysis")} onClick={onDownloadRawDatasetCsv} variant="secondary" size="sm" />
        <ActionButton label={t("corporate.detail.exportOhlcv")} onClick={onDownloadHistoricalPriceCsv} disabled={historicalPrices.length === 0} variant="secondary" size="sm" />
        <ActionButton label={t("corporate.detail.exportStatements")} onClick={onDownloadQuarterlyStatementsCsv} disabled={quarterlyStatementRows.length === 0} variant="secondary" size="sm" />
        <ActionButton label={t("corporate.detail.print")} onClick={onPrint} variant="secondary" size="sm" />
      </div>

      {showDcfFullReport ? (
        <RawDatasetSection
          title="Full DCF Report"
          description="Expanded DCF projection, terminal-value, and WACC breakdown. This stays behind an explicit open action to preserve progressive disclosure."
          status={dcfFullReportStatus ?? "Full report not loaded yet."}
          statusVariant={dcfFullReportIsError ? "error" : statusFromText(dcfFullReportStatus)}
          defaultOpen={Boolean(dcfFullReport)}
        >
          <div className="flex flex-col gap-4">
            {onRequestDcfFullReport ? (
              <ActionButton label={dcfFullReport ? "Refresh Full Report" : "Load Full Report"} onClick={onRequestDcfFullReport} variant="secondary" size="sm" className="self-start" />
            ) : null}
            {dcfFullReportIsLoading && !dcfFullReport ? (
              <EmptyState title="Loading full DCF report..." description="Fetching the expanded projection rows and WACC breakdown for this ticker." />
            ) : dcfFullReportIsError && !dcfFullReport ? (
              <ErrorState title="Full DCF Report Unavailable" message={dcfFullReportStatus ?? "Could not load the expanded DCF report for this ticker."} />
            ) : dcfFullReport ? (
              <>
                <div className="overflow-x-auto border border-[var(--line)]">
                  <table className={TABLE}>
                    <thead className={THEAD}>
                      <tr>
                        <th className="px-3 py-2">Year</th>
                        <th className="px-3 py-2">Projected FCFF</th>
                        <th className="px-3 py-2">Discount Factor</th>
                        <th className="px-3 py-2">Present Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dcfFullReport.projection_rows.map((row) => (
                        <tr key={`${ticker}-projection-${row.year}`} className={TR}>
                          <td className={TD}>{row.year}</td>
                          <td className={TD_FIGURE}>{formatNumber(row.projected_fcff)}</td>
                          <td className={TD_FIGURE}>{formatNumber2(row.discount_factor)}</td>
                          <td className={TD_FIGURE}>{formatNumber(row.present_value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="overflow-x-auto border border-[var(--line)]">
                  <table className={TABLE}>
                    <thead className={THEAD}>
                      <tr>
                        <th className="px-3 py-2">Breakdown</th>
                        <th className="px-3 py-2">Value</th>
                        <th className="px-3 py-2">Context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ["Terminal Cash Flow", formatNumber(dcfFullReport.terminal_cash_flow), "Year 5 FCFF grown by terminal growth"],
                        ["Terminal Value", formatNumber(dcfFullReport.terminal_value), "Gordon growth terminal value"],
                        ["PV of Terminal", formatNumber(dcfFullReport.present_value_of_terminal), "Discounted terminal value"],
                        ["PV of FCFF", formatNumber(dcfFullReport.present_value_of_fcff), "Discounted phase-one FCFF rows"],
                        ["Enterprise Value", formatNumber(dcfFullReport.enterprise_value), "PV of FCFF plus PV of terminal value"],
                        ["Equity Value", dcfFullReport.equity_value == null ? "Unavailable" : formatNumber(dcfFullReport.equity_value), "Enterprise value minus net debt plus non-operating assets"],
                        ["Intrinsic Value / Share", dcfFullReport.intrinsic_value_per_share == null ? "Unavailable" : formatNumber(dcfFullReport.intrinsic_value_per_share), "Equity value divided by diluted shares"],
                        ["Bridge Quality", dcfFullReport.bridge_quality, dcfFullReport.valuation_method],
                        ["Net Debt", dcfFullReport.net_debt == null ? "Unavailable" : formatNumber(dcfFullReport.net_debt), "Enterprise-to-equity bridge input"],
                        ["Non-operating Assets", dcfFullReport.non_operating_assets == null ? "Unavailable" : formatNumber(dcfFullReport.non_operating_assets), "Enterprise-to-equity bridge input"],
                        ["Diluted Shares", dcfFullReport.diluted_shares_outstanding == null ? "Unavailable" : formatNumber(dcfFullReport.diluted_shares_outstanding), "Per-share bridge input"],
                        ["Agency Discount", formatNumber2(dcfFullReport.agency_discount), "Diagnostic only; not applied to intrinsic value"],
                        ["Risk-free Rate", formatPct(dcfFullReport.wacc_breakdown.risk_free_rate * 100), "Full-report WACC breakdown"],
                        ["Equity Risk Premium", formatPct(dcfFullReport.wacc_breakdown.equity_risk_premium * 100), "Full-report WACC breakdown"],
                        ["Country Risk Premium", formatPct(dcfFullReport.wacc_breakdown.country_risk_premium * 100), "Full-report WACC breakdown"],
                      ].map(([label, value, source]) => (
                        <tr key={`${ticker}-dcf-breakdown-${label}`} className={TR}>
                          <td className={TD}>{label}</td>
                          <td className={TD_FIGURE}>{value}</td>
                          <td className={TD}>{source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <DcfSensitivityTable sensitivity={dcfFullReport.sensitivity} formatNumber={formatNumber} formatPct={formatPct} />
              </>
            ) : (
              <EmptyState title="Full DCF report not loaded yet" description="Use the load action above to fetch the projection rows and WACC breakdown for this ticker." />
            )}
          </div>
        </RawDatasetSection>
      ) : null}

      <RawDatasetSection
        title="Raw Datasets"
        description="Collapsed by default so the modal stays readable while keeping full source evidence available on demand."
        status={`${rawDatasetRows.length} analysis rows`}
        statusVariant={rawDatasetRows.length > 0 ? "saved" : "idle"}
      >
        {rawDatasetRows.length > 0 ? (
          <div className="max-h-80 overflow-auto border border-[var(--line)]">
            <table className="w-full min-w-[52rem] table-fixed text-left">
              <thead className={`sticky top-0 ${THEAD}`}>
                <tr>
                  <th className="px-3 py-2">Dataset</th>
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">Value</th>
                  <th className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {rawDatasetRows.map((row, index) => (
                  <tr key={`${row.dataset}-${row.field}-${index}`} className={TR}>
                    <td className="break-words max-w-64 px-3 py-2 type-small text-[var(--ink)]">{row.dataset}</td>
                    <td className="break-words max-w-48 px-3 py-2 type-small text-[var(--ink)]">{row.field}</td>
                    <td className="break-words max-w-64 px-3 py-2 type-mono text-[var(--ink)]">{row.value}</td>
                    <td className={TD}>{row.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No raw dataset rows available" description="Analysis dataset exports will appear here once the selected audit surface exposes them." />
        )}
      </RawDatasetSection>

      <RawDatasetSection
        title="Historical OHLCV Dataset"
        description="Underlying five-year price history used for price-linked context and export."
        status={historicalStatus}
        statusVariant={historicalIsError ? "error" : statusFromText(historicalStatus)}
      >
        {historicalIsLoading && historicalPrices.length === 0 ? (
          <EmptyState title="Loading historical OHLCV dataset..." description="Fetching the five-year price history used for this audit layer." />
        ) : historicalIsError && historicalPrices.length === 0 ? (
          <ErrorState title="Historical OHLCV Unavailable" message={historicalStatus} />
        ) : historicalPrices.length > 0 ? (
          <div className="max-h-80 overflow-auto border border-[var(--line)]">
            <table className="w-full min-w-[48rem] table-fixed text-left">
              <thead className={`sticky top-0 ${THEAD}`}>
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Open</th>
                  <th className="px-3 py-2">High</th>
                  <th className="px-3 py-2">Low</th>
                  <th className="px-3 py-2">Close</th>
                  <th className="px-3 py-2">Volume</th>
                </tr>
              </thead>
              <tbody>
                {historicalPrices.map((row) => (
                  <tr key={`${ticker}-${row.date}`} className={TR}>
                    <td className={TD}>{row.date}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.open)}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.high)}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.low)}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.close)}</td>
                    <td className={TD_FIGURE}>{Math.round(row.volume).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Historical stock price rows are not available" description="Refresh source data from the Corporate page to populate the OHLCV export surface." />
        )}
      </RawDatasetSection>

      <RawDatasetSection
        title="Quarterly Financial Statements"
        description="Quarterly balance sheet, income statement, and cash-flow rows used to support the current audit view."
        status={quarterlyStatementStatus}
        statusVariant={quarterlyStatementsIsError ? "error" : statusFromText(quarterlyStatementStatus)}
      >
        {quarterlyStatementsIsLoading && quarterlyStatementRows.length === 0 ? (
          <EmptyState title="Loading quarterly financial statements..." description="Fetching the supporting quarterly balance-sheet, income, and cash-flow rows." />
        ) : quarterlyStatementsIsError && quarterlyStatementRows.length === 0 ? (
          <ErrorState title="Quarterly Financial Statements Unavailable" message={quarterlyStatementStatus} />
        ) : quarterlyStatementRows.length > 0 ? (
          <div className="max-h-96 overflow-auto border border-[var(--line)]">
            <table className="w-full min-w-[56rem] table-fixed text-left">
              <thead className={`sticky top-0 ${THEAD}`}>
                <tr>
                  <th className="px-3 py-2">Statement</th>
                  <th className="px-3 py-2">Quarter</th>
                  <th className="px-3 py-2">Metric</th>
                  <th className="px-3 py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                {quarterlyStatementRows.map((row, index) => (
                  <tr key={`${row.statement}-${row.period}-${row.metric}-${index}`} className={TR}>
                    <td className={TD}>{row.statement}</td>
                    <td className={TD}>{row.period}</td>
                    <td className={TD}>{row.metric}</td>
                    <td className={TD_FIGURE}>{formatNumber(row.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="Quarterly statement rows are not available" description="Refresh source data from the Corporate page to populate this supporting dataset." />
        )}
      </RawDatasetSection>
    </div>
  );
}
