"use client";

import { useEffect } from "react";
import type { DcfFullReport } from "../../../../../packages/shared-types";
import type { CalculationDetail, CalculationRow, RawDatasetRow } from "./calculationDetailTypes";

interface StockPriceRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface QuarterlyStatementRow {
  ticker: string;
  statement: string;
  period: string;
  metric: string;
  value: number;
}

export function CalculationDetailModal({
  detail,
  ticker,
  rawDatasetRows,
  historicalPrices,
  historicalStatus,
  quarterlyStatementRows,
  quarterlyStatementStatus,
  dcfFullReport,
  dcfFullReportStatus,
  onRequestDcfFullReport,
  onClose,
  onDownloadRawDatasetCsv,
  onDownloadHistoricalPriceCsv,
  onDownloadQuarterlyStatementsCsv,
  onPrint,
  formatNumber,
  formatNumber2,
  formatPct,
}: {
  detail: CalculationDetail;
  ticker: string;
  rawDatasetRows: RawDatasetRow[];
  historicalPrices: StockPriceRow[];
  historicalStatus: string;
  quarterlyStatementRows: QuarterlyStatementRow[];
  quarterlyStatementStatus: string;
  dcfFullReport: DcfFullReport | null;
  dcfFullReportStatus: string | null;
  onRequestDcfFullReport?: (() => void) | null;
  onClose: () => void;
  onDownloadRawDatasetCsv: () => void;
  onDownloadHistoricalPriceCsv: () => void;
  onDownloadQuarterlyStatementsCsv: () => void;
  onPrint: () => void;
  formatNumber: (value: number) => string;
  formatNumber2: (value: number) => string;
  formatPct: (value: number) => string;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const renderRows = (rows: CalculationRow[]) => (
    <tbody>
      {rows.map((row, index) => (
        <tr key={`${row.label}-${row.source}-${index}`} className="border-t border-[var(--border)]">
          <td className="max-w-64 break-words px-3 py-2 font-bold text-black">{row.label}</td>
          <td className="max-w-72 break-words px-3 py-2 font-bold tabular-nums text-black">{row.value}</td>
          <td className="max-w-80 break-words px-3 py-2 font-bold text-black">{row.source}</td>
        </tr>
      ))}
    </tbody>
  );

  const rawDataAccessRows: CalculationRow[] = [
    ...detail.simulation.map((row) => ({
      label: `Step ${row.label}`,
      value: row.value,
      source: `Output: ${row.source}; Data Period: ${detail.timeHorizon}`,
    })),
    ...detail.sourcing.map((row) => ({
      label: row.label,
      value: row.value,
      source: `${row.source}; Data Period: ${detail.timeHorizon}`,
    })),
  ];
  const showDcfFullReport = detail.title.includes("Backend DCF");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-x-hidden bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[calc(100vh-2rem)] w-full max-w-[min(56rem,calc(100vw-2rem))] overflow-y-auto overflow-x-hidden rounded-[var(--radius)] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div id="modal-header" className="sticky top-0 z-0 flex items-start justify-between border-b border-[var(--border)] bg-white p-5">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)]">{detail.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Calculation transparency and data lineage</p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onDownloadRawDatasetCsv}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Download Raw CSV
            </button>
            <button
              type="button"
              onClick={onDownloadHistoricalPriceCsv}
              disabled={historicalPrices.length === 0}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download 5Y Prices
            </button>
            <button
              type="button"
              onClick={onDownloadQuarterlyStatementsCsv}
              disabled={quarterlyStatementRows.length === 0}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              Download Quarterly Statements
            </button>
            <button
              type="button"
              onClick={onPrint}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Data Table</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="z-10 bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Data Point</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                {renderRows(detail.summary)}
              </table>
            </div>
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Time Horizon</h3>
            <p className="mt-2 text-sm text-[var(--text-primary)]">{detail.timeHorizon}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Component Breakdown</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="z-10 bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Component</th>
                    <th className="px-3 py-2">Assigned Value</th>
                    <th className="px-3 py-2">Basis</th>
                  </tr>
                </thead>
                {renderRows(detail.components)}
              </table>
            </div>
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Calculation Formula</h3>
            <p className="mt-2 font-mono text-sm font-bold text-black">{detail.formula}</p>
            <p className="mt-2 text-sm font-bold text-black">Data Period: {detail.timeHorizon}</p>
            <p className="mt-3 text-sm font-bold text-black">Result: {detail.result}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Source Attribution</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="z-10 bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Current Value</th>
                    <th className="px-3 py-2">Origin</th>
                  </tr>
                </thead>
                {renderRows(detail.sourcing)}
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">View Details</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="z-10 bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Step</th>
                    <th className="px-3 py-2">Arithmetic</th>
                    <th className="px-3 py-2">Output</th>
                  </tr>
                </thead>
                {renderRows(detail.simulation)}
              </table>
            </div>
          </section>

          {showDcfFullReport && (
            <section>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text-primary)]">Full DCF Report</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Phase 3 loads only when you explicitly request the detailed projection and WACC breakdown.
                  </p>
                </div>
                {onRequestDcfFullReport ? (
                  <button
                    type="button"
                    onClick={onRequestDcfFullReport}
                    className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    View Full Report
                  </button>
                ) : null}
              </div>
              {dcfFullReportStatus && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">{dcfFullReportStatus}</p>
              )}
              {dcfFullReport ? (
                <>
                  <div className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                    <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                      <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black">
                        <tr>
                          <th className="px-3 py-2">Year</th>
                          <th className="px-3 py-2">Projected FCFF</th>
                          <th className="px-3 py-2">Discount Factor</th>
                          <th className="px-3 py-2">Present Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dcfFullReport.projection_rows.map((row) => (
                          <tr key={`${ticker}-projection-${row.year}`} className="border-t border-[var(--border)]">
                            <td className="px-3 py-2 font-bold text-black">{row.year}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.projected_fcff)}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber2(row.discount_factor)}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.present_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                    <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                      <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black">
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
                          ["Agency Discount", formatNumber2(dcfFullReport.agency_discount), "ESG penalty adjustment"],
                          ["Risk-free Rate", formatPct(dcfFullReport.wacc_breakdown.risk_free_rate * 100), "Full-report WACC breakdown"],
                          ["Equity Risk Premium", formatPct(dcfFullReport.wacc_breakdown.equity_risk_premium * 100), "Full-report WACC breakdown"],
                          ["Country Risk Premium", formatPct(dcfFullReport.wacc_breakdown.country_risk_premium * 100), "Full-report WACC breakdown"],
                        ].map(([label, value, source]) => (
                          <tr key={`${ticker}-dcf-breakdown-${label}`} className="border-t border-[var(--border)]">
                            <td className="px-3 py-2 font-bold text-black">{label}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-black">{value}</td>
                            <td className="px-3 py-2 font-bold text-black">{source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </section>
          )}

          <section>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Raw Historical Data Table</h3>
              <p className="text-xs text-[var(--text-muted)]">{historicalStatus}</p>
            </div>
            <div className="z-10 mt-2 max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[48rem] table-fixed text-left text-sm">
                <thead className="z-10 bg-[var(--surface)] text-xs font-bold uppercase text-black">
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
                  {historicalPrices.length > 0 ? historicalPrices.map((row) => (
                    <tr key={`${ticker}-${row.date}`} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-bold text-black">{row.date}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.open)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.high)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.low)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.close)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{Math.round(row.volume).toLocaleString()}</td>
                    </tr>
                  )) : (
                    <tr className="border-t border-[var(--border)]">
                      <td className="px-3 py-3 text-sm font-bold text-black" colSpan={6}>
                        Historical stock price rows are not available for this ticker yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Quarterly Financial Statements</h3>
              <p className="text-xs text-[var(--text-muted)]">{quarterlyStatementStatus}</p>
            </div>
            <div className="mt-2 max-h-96 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[56rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Statement</th>
                    <th className="px-3 py-2">Quarter</th>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {quarterlyStatementRows.length > 0 ? quarterlyStatementRows.map((row, index) => (
                    <tr key={`${row.statement}-${row.period}-${row.metric}-${index}`} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-bold text-black">{row.statement}</td>
                      <td className="px-3 py-2 font-bold text-black">{row.period}</td>
                      <td className="max-w-80 break-words px-3 py-2 font-bold text-black">{row.metric}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-black">{formatNumber(row.value)}</td>
                    </tr>
                  )) : (
                    <tr className="border-t border-[var(--border)]">
                      <td className="px-3 py-3 text-sm font-bold text-black" colSpan={4}>
                        Quarterly financial statement rows are not available for this ticker yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Raw Data Access</h3>
            <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Calculation Step</th>
                    <th className="px-3 py-2">Raw Input / Arithmetic</th>
                    <th className="px-3 py-2">Source Attribution / Data Period</th>
                  </tr>
                </thead>
                {renderRows(rawDataAccessRows)}
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">All Raw Datasets Used</h3>
            <div className="mt-2 max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-xs font-bold uppercase text-black">
                  <tr>
                    <th className="px-3 py-2">Dataset</th>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {rawDatasetRows.map((row, index) => (
                    <tr key={`${row.dataset}-${row.field}-${index}`} className="border-t border-[var(--border)]">
                      <td className="max-w-64 break-words px-3 py-2 font-bold text-black">{row.dataset}</td>
                      <td className="max-w-48 break-words px-3 py-2 font-bold text-black">{row.field}</td>
                      <td className="max-w-64 break-words px-3 py-2 font-bold tabular-nums text-black">{row.value}</td>
                      <td className="max-w-80 break-words px-3 py-2 font-bold text-black">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
