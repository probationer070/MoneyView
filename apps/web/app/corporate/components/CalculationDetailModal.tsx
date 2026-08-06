"use client";

import type { ReactNode } from "react";
import type { CorporateMetricAudit, DcfFullReport } from "../../../../../packages/shared-types";
import type { CalculationDetail, CalculationRow, RawDatasetRow } from "./calculationDetailTypes";
import { DcfSensitivityTable } from "./DcfSensitivityTable";
import { ModalShell } from "@/components/ui/ModalShell";
import { ActionButton } from "@/components/ui/ActionButton";
import { StatusBadge, type StatusVariant } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { MetricAuditPanel } from "@/components/ui/MetricAuditPanel";

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

interface CalculationDetailModalProps {
  detail: CalculationDetail;
  ticker: string;
  metricAudit: CorporateMetricAudit | null;
  metricAuditIsLoading: boolean;
  metricAuditIsError: boolean;
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
  onClose: () => void;
  onDownloadRawDatasetCsv: () => void;
  onDownloadHistoricalPriceCsv: () => void;
  onDownloadQuarterlyStatementsCsv: () => void;
  onPrint: () => void;
  formatNumber: (value: number) => string;
  formatNumber2: (value: number) => string;
  formatPct: (value: number) => string;
}

interface MetricCardProps {
  label: string;
  value: string;
  helper?: string;
}

interface SectionCardProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

interface DataTableSectionProps {
  title: string;
  description?: string;
  columns: string[];
  rows: CalculationRow[];
  emptyTitle: string;
  emptyDescription: string;
}

interface RawDatasetSectionProps {
  title: string;
  description: string;
  status: string;
  statusVariant: StatusVariant;
  defaultOpen?: boolean;
  children: ReactNode;
}

function MetricCard({ label, value, helper }: MetricCardProps) {
  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
      <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-2 text-lg font-black text-[var(--text-primary)]">{value}</div>
      {helper ? <p className="mt-2 text-xs text-[var(--text-muted)]">{helper}</p> : null}
    </div>
  );
}

function SectionCard({ title, description, actions, children }: SectionCardProps) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
          {description ? <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function DenseRowsTable({ columns, rows, emptyTitle, emptyDescription }: Omit<DataTableSectionProps, "title" | "description">) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
      <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
        <thead className="bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
          <tr>
            {columns.map((column) => (
              <th key={column} className="px-3 py-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.label}-${row.source}-${index}`} className="border-t border-[var(--border)]">
              <td className="max-w-64 break-words px-3 py-2 font-bold text-[var(--text-primary)]">{row.label}</td>
              <td className="max-w-72 break-words px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{row.value}</td>
              <td className="max-w-80 break-words px-3 py-2 font-bold text-[var(--text-primary)]">{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataTableSection({
  title,
  description,
  columns,
  rows,
  emptyTitle,
  emptyDescription,
}: DataTableSectionProps) {
  return (
    <SectionCard title={title} description={description}>
      <DenseRowsTable
        columns={columns}
        rows={rows}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </SectionCard>
  );
}

function RawDatasetSection({
  title,
  description,
  status,
  statusVariant,
  defaultOpen = false,
  children,
}: RawDatasetSectionProps) {
  return (
    <details
      open={defaultOpen}
      className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)]"
    >
      <summary className="flex cursor-pointer list-none items-start justify-between gap-3 px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--text-primary)]">{title}</h3>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
        </div>
        <StatusBadge status={statusVariant} label={status} className="shrink-0" />
      </summary>
      <div className="border-t border-[var(--border)] p-4">{children}</div>
    </details>
  );
}

function statusFromText(status: string | null | undefined): StatusVariant {
  const normalized = status?.toLowerCase() ?? "";
  if (normalized.includes("loading")) return "loading";
  if (normalized.includes("unavailable")) return "error";
  if (normalized.includes("not loaded")) return "idle";
  if (normalized.includes("refresh")) return "idle";
  return "saved";
}

function firstValue(rows: CalculationRow[], fallback = "N/A") {
  return rows[0]?.value ?? fallback;
}

function firstSource(rows: CalculationRow[], fallback = "Unavailable") {
  return rows[0]?.source ?? fallback;
}

function supportingRows(detail: CalculationDetail) {
  return [...detail.components, ...detail.simulation];
}

export function CalculationDetailModal({
  detail,
  ticker,
  metricAudit,
  metricAuditIsLoading,
  metricAuditIsError,
  rawDatasetRows,
  historicalPrices,
  historicalStatus,
  historicalIsLoading,
  historicalIsError,
  quarterlyStatementRows,
  quarterlyStatementStatus,
  quarterlyStatementsIsLoading,
  quarterlyStatementsIsError,
  dcfFullReport,
  dcfFullReportStatus,
  dcfFullReportIsLoading,
  dcfFullReportIsError,
  onRequestDcfFullReport,
  onClose,
  onDownloadRawDatasetCsv,
  onDownloadHistoricalPriceCsv,
  onDownloadQuarterlyStatementsCsv,
  onPrint,
  formatNumber,
  formatNumber2,
  formatPct,
}: CalculationDetailModalProps) {
  const showDcfFullReport = detail.title.includes("Backend DCF") || detail.title.includes("Backend Fair Value") || detail.title.includes("Intrinsic DCF");
  const dataLineageRows = [...detail.sourcing, ...detail.summary.slice(0, 3)];
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
  const resultSummaryMetrics = [
    {
      label: "Result",
      value: detail.result,
      helper: "Final output currently rendered in the selected KPI or chart surface.",
    },
    {
      label: "Primary Input",
      value: firstValue(detail.summary.slice(0, 1)),
      helper: firstSource(detail.summary.slice(0, 1)),
    },
    {
      label: "Inputs Used",
      value: `${detail.summary.length} rows`,
      helper: "Summary inputs included in this audit view.",
    },
    {
      label: "Time Horizon",
      value: detail.timeHorizon,
      helper: "Reference period used for the displayed sourcing and arithmetic.",
    },
  ];

  return (
    <ModalShell
      open={true}
      onClose={onClose}
      title={detail.title}
      subtitle="Calculation transparency and data lineage"
      size="xl"
    >
      <div className="space-y-5">
        {detail.auditMetric ? (
          metricAuditIsLoading ? (
            <SectionCard title="Calculation Audit" description="Loading auditable inputs for the selected metric.">
              <EmptyState title="Loading calculation audit..." />
            </SectionCard>
          ) : metricAuditIsError ? (
            <SectionCard title="Calculation Audit" description="The auditable input payload could not be loaded for this metric.">
              <ErrorState title="Calculation Audit Unavailable" message={`Could not load the metric audit for ${ticker}.`} />
            </SectionCard>
          ) : (
            <MetricAuditPanel
              audit={metricAudit}
              metric={detail.auditMetric}
              title={detail.auditMetric === "spread" ? "ROIC - WACC Audit" : detail.auditMetric === "growth" ? "Growth Audit" : `${detail.auditMetric.toUpperCase()} Audit`}
            />
          )
        ) : null}
        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Audit Actions</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Export the current calculation inputs, source datasets, or print the audit layer directly from this modal.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton label="Download CSV: Analysis" onClick={onDownloadRawDatasetCsv} variant="secondary" size="sm" />
              <ActionButton
                label="Download CSV: OHLCV"
                onClick={onDownloadHistoricalPriceCsv}
                disabled={historicalPrices.length === 0}
                variant="secondary"
                size="sm"
              />
              <ActionButton
                label="Download CSV: Statements"
                onClick={onDownloadQuarterlyStatementsCsv}
                disabled={quarterlyStatementRows.length === 0}
                variant="secondary"
                size="sm"
              />
              <ActionButton label="Print" onClick={onPrint} variant="secondary" size="sm" />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {resultSummaryMetrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              helper={metric.helper}
            />
          ))}
        </section>

        <SectionCard
          title="Formula Explanation"
          description="This section explains the arithmetic path used for the selected KPI, chart, or DCF output."
        >
          <div className="space-y-4">
            <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
              <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Calculation Formula</div>
              <p className="mt-2 whitespace-pre-wrap font-mono text-sm font-bold text-[var(--text-primary)]">{detail.formula}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Result Summary</div>
                <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">{detail.result}</p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Inputs used come from the selected realtime assumption state, saved source data, and the currently active ticker context.
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
                <div className="text-[length:var(--type-caption)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Time Horizon</div>
                <p className="mt-2 text-sm font-bold text-[var(--text-primary)]">{detail.timeHorizon}</p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  Every supporting row and raw dataset below is interpreted through this horizon or model policy window.
                </p>
              </div>
            </div>
          </div>
        </SectionCard>

        <DataTableSection
          title="Result Summary: value, inputs used"
          description="Primary data points that feed the selected result before deeper audit detail."
          columns={["Data Point", "Value", "Source"]}
          rows={detail.summary}
          emptyTitle="No summary rows available"
          emptyDescription="This calculation does not currently expose summary inputs."
        />

        <DataTableSection
          title="Data Lineage"
          description="Trace the path from source systems to transformed values and final output."
          columns={["Field", "Current Value", "Origin"]}
          rows={dataLineageRows}
          emptyTitle="No lineage rows available"
          emptyDescription="Source attribution is not available for this calculation yet."
        />

        <DataTableSection
          title="Supporting Rows"
          description="Detailed components and arithmetic steps underlying the final result."
          columns={["Supporting Row", "Assigned Value", "Basis"]}
          rows={supportingRows(detail)}
          emptyTitle="No supporting rows available"
          emptyDescription="This calculation does not currently expose intermediate rows."
        />

        <DataTableSection
          title="Raw Data Access"
          description="Direct access map showing how calculation steps connect to source attribution and time period."
          columns={["Calculation Step", "Raw Input / Arithmetic", "Source Attribution / Data Period"]}
          rows={rawDataAccessRows}
          emptyTitle="No raw access rows available"
          emptyDescription="No raw access or arithmetic rows are currently available."
        />

        {showDcfFullReport ? (
          <RawDatasetSection
            title="Full DCF Report"
            description="Expanded DCF projection, terminal-value, and WACC breakdown. This stays behind an explicit open action to preserve progressive disclosure."
            status={dcfFullReportStatus ?? "Full report not loaded yet."}
            statusVariant={dcfFullReportIsError ? "error" : statusFromText(dcfFullReportStatus)}
            defaultOpen={Boolean(dcfFullReport)}
          >
            <div className="space-y-4">
              {onRequestDcfFullReport ? (
                <ActionButton
                  label={dcfFullReport ? "Refresh Full Report" : "Load Full Report"}
                  onClick={onRequestDcfFullReport}
                  variant="secondary"
                  size="sm"
                />
              ) : null}
              {dcfFullReportIsLoading && !dcfFullReport ? (
                <EmptyState
                  title="Loading full DCF report..."
                  description="Fetching the expanded projection rows and WACC breakdown for this ticker."
                />
              ) : dcfFullReportIsError && !dcfFullReport ? (
                <ErrorState
                  title="Full DCF Report Unavailable"
                  message={dcfFullReportStatus ?? "Could not load the expanded DCF report for this ticker."}
                />
              ) : dcfFullReport ? (
                <>
                  <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                    <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                      <thead className="bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
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
                            <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{row.year}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.projected_fcff)}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber2(row.discount_factor)}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.present_value)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="overflow-x-auto rounded-[var(--radius)] border border-[var(--border)]">
                    <table className="w-full min-w-[42rem] table-fixed text-left text-sm">
                      <thead className="bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
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
                          <tr key={`${ticker}-dcf-breakdown-${label}`} className="border-t border-[var(--border)]">
                            <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{label}</td>
                            <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{value}</td>
                            <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{source}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <DcfSensitivityTable
                    sensitivity={dcfFullReport.sensitivity}
                    formatNumber={formatNumber}
                    formatPct={formatPct}
                  />
                </>
              ) : (
                <EmptyState
                  title="Full DCF report not loaded yet"
                  description="Use the load action above to fetch the projection rows and WACC breakdown for this ticker."
                />
              )}
            </div>
          </RawDatasetSection>
        ) : null}

        <RawDatasetSection
          title="Raw Datasets"
          description="Collapsed by default so the modal stays readable while keeping full source evidence available on demand."
          status={`${rawDatasetRows.length} analysis rows`}
          statusVariant={rawDatasetRows.length > 0 ? "saved" : "idle"}
          defaultOpen={false}
        >
          {rawDatasetRows.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[52rem] table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
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
                      <td className="max-w-64 break-words px-3 py-2 font-bold text-[var(--text-primary)]">{row.dataset}</td>
                      <td className="max-w-48 break-words px-3 py-2 font-bold text-[var(--text-primary)]">{row.field}</td>
                      <td className="max-w-64 break-words px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{row.value}</td>
                      <td className="max-w-80 break-words px-3 py-2 font-bold text-[var(--text-primary)]">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No raw dataset rows available"
              description="Analysis dataset exports will appear here once the selected audit surface exposes them."
            />
          )}
        </RawDatasetSection>

        <RawDatasetSection
          title="Historical OHLCV Dataset"
          description="Underlying five-year price history used for price-linked context and export."
          status={historicalStatus}
          statusVariant={historicalIsError ? "error" : statusFromText(historicalStatus)}
          defaultOpen={false}
        >
          {historicalIsLoading && historicalPrices.length === 0 ? (
            <EmptyState
              title="Loading historical OHLCV dataset..."
              description="Fetching the five-year price history used for this audit layer."
            />
          ) : historicalIsError && historicalPrices.length === 0 ? (
            <ErrorState
              title="Historical OHLCV Unavailable"
              message={historicalStatus}
            />
          ) : historicalPrices.length > 0 ? (
            <div className="max-h-80 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[48rem] table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
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
                    <tr key={`${ticker}-${row.date}`} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{row.date}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.open)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.high)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.low)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.close)}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{Math.round(row.volume).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Historical stock price rows are not available"
              description="Refresh source data from the Corporate page to populate the OHLCV export surface."
            />
          )}
        </RawDatasetSection>

        <RawDatasetSection
          title="Quarterly Financial Statements"
          description="Quarterly balance sheet, income statement, and cash-flow rows used to support the current audit view."
          status={quarterlyStatementStatus}
          statusVariant={quarterlyStatementsIsError ? "error" : statusFromText(quarterlyStatementStatus)}
          defaultOpen={false}
        >
          {quarterlyStatementsIsLoading && quarterlyStatementRows.length === 0 ? (
            <EmptyState
              title="Loading quarterly financial statements..."
              description="Fetching the supporting quarterly balance-sheet, income, and cash-flow rows."
            />
          ) : quarterlyStatementsIsError && quarterlyStatementRows.length === 0 ? (
            <ErrorState
              title="Quarterly Financial Statements Unavailable"
              message={quarterlyStatementStatus}
            />
          ) : quarterlyStatementRows.length > 0 ? (
            <div className="max-h-96 overflow-auto rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full min-w-[56rem] table-fixed text-left text-sm">
                <thead className="sticky top-0 bg-[var(--surface)] text-[length:var(--type-table-header)] font-bold uppercase tracking-wide text-[var(--text-primary)]">
                  <tr>
                    <th className="px-3 py-2">Statement</th>
                    <th className="px-3 py-2">Quarter</th>
                    <th className="px-3 py-2">Metric</th>
                    <th className="px-3 py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {quarterlyStatementRows.map((row, index) => (
                    <tr key={`${row.statement}-${row.period}-${row.metric}-${index}`} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{row.statement}</td>
                      <td className="px-3 py-2 font-bold text-[var(--text-primary)]">{row.period}</td>
                      <td className="max-w-80 break-words px-3 py-2 font-bold text-[var(--text-primary)]">{row.metric}</td>
                      <td className="px-3 py-2 font-bold tabular-nums text-[var(--text-primary)]">{formatNumber(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Quarterly statement rows are not available"
              description="Refresh source data from the Corporate page to populate this supporting dataset."
            />
          )}
        </RawDatasetSection>

        <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)]">Export Affordances</h3>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Keep download actions visible at the end of the audit layer so exports are available after reviewing raw datasets.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton label="Download CSV: Analysis" onClick={onDownloadRawDatasetCsv} variant="secondary" size="sm" />
              <ActionButton
                label="Download CSV: OHLCV"
                onClick={onDownloadHistoricalPriceCsv}
                disabled={historicalPrices.length === 0}
                variant="secondary"
                size="sm"
              />
              <ActionButton
                label="Download CSV: Statements"
                onClick={onDownloadQuarterlyStatementsCsv}
                disabled={quarterlyStatementRows.length === 0}
                variant="secondary"
                size="sm"
              />
              <ActionButton label="Print" onClick={onPrint} variant="secondary" size="sm" />
            </div>
          </div>
        </section>
      </div>
    </ModalShell>
  );
}
