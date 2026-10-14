"use client";

import type { CorporateMetricAudit, DcfFullReport } from "../../../../../packages/shared-types";
import { MetricQualityBadge } from "@/components/ui/MetricQualityBadge";
import { ModalShell } from "@/components/ui/ModalShell";
import { Tabs } from "@/components/ui/Tabs";
import { useT } from "@/lib/i18n/locale";
import { tabStateKey, useTabState } from "@/lib/tabState";
import { availableDetailTabs, resolveDetailTab, type DetailTabKey } from "../detailTabs";
import { waccInputIfDivergent } from "../formulaContext";
import type { CalculationDetail, CalculationDetailKey, RawDatasetRow } from "./calculationDetailTypes";
import { RawDataTab, type QuarterlyStatementRow, type StockPriceRow } from "./detail/RawDataTab";
import { StepsTab } from "./detail/StepsTab";
import { SummaryTab } from "./detail/SummaryTab";
import { VerdictStatusLabel } from "./VerdictBlock";

/** Tabs built so far. Task 9 adds "trend", Task 10 "peers", Task 11 "sensitivity". */
const BUILT_TABS: readonly DetailTabKey[] = ["summary", "steps", "raw"];

interface CalculationDetailModalProps {
  detail: CalculationDetail;
  detailKey: CalculationDetailKey;
  ticker: string;
  substitutedFormula: string | null;
  /** The page's WACC input (the slider value), compared with the audit's final WACC. */
  sliderWacc: number;
  dcfStatus: string | null;
  dcfGeneratedAt: string | null;
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

// Spec §4: still a ModalShell modal (U9), its sections split into tabs. The last tab chosen is
// remembered; a metric without it opens Summary and the memory is left as it was.
export function CalculationDetailModal(props: CalculationDetailModalProps) {
  const { detail, detailKey, ticker, substitutedFormula, sliderWacc, dcfStatus, dcfGeneratedAt, metricAudit, metricAuditIsLoading, metricAuditIsError, onClose } = props;
  const t = useT();
  const [storedTab, setStoredTab] = useTabState<string>(tabStateKey("corporate", "detailTab"), "summary");
  const available = availableDetailTabs(detailKey).filter((tab) => BUILT_TABS.includes(tab));
  const active = resolveDetailTab(storedTab, available);
  const auditEntry = detail.auditMetric && metricAudit ? metricAudit[detail.auditMetric] : null;
  const isDcfKey = detailKey === "backendDcf" || detailKey === "backendFairValue";
  const status = auditEntry ? (
    <>
      <MetricQualityBadge quality={auditEntry.quality} />
      {auditEntry.reason ? <span className="type-small text-[var(--ink-muted)]">{auditEntry.reason}</span> : null}
    </>
  ) : isDcfKey && dcfStatus ? (
    <VerdictStatusLabel status={dcfStatus} />
  ) : null;
  const asOf = auditEntry?.as_of ?? (isDcfKey ? dcfGeneratedAt : null);
  const waccInput = detailKey === "wacc" ? waccInputIfDivergent(metricAudit?.wacc ?? null, sliderWacc) : null;

  return (
    <ModalShell open onClose={onClose} title={detail.title} subtitle={`${ticker} · ${detail.result}`} size="xl">
      <div className="flex flex-col gap-4">
        <Tabs
          ariaLabel={t("corporate.detail.tabsAria")}
          activeKey={active}
          onChange={setStoredTab}
          items={available.map((tab) => ({ key: tab, label: t(`corporate.detail.tab.${tab}`) }))}
        />
        <div role="tabpanel" id={`panel-${active}`} aria-labelledby={`tab-${active}`}>
          {active === "summary" ? (
            <SummaryTab detail={detail} detailKey={detailKey} status={status} substituted={substitutedFormula} waccInput={waccInput} asOf={asOf} />
          ) : null}
          {active === "steps" ? (
            <StepsTab detail={detail} ticker={ticker} metricAudit={metricAudit} metricAuditIsLoading={metricAuditIsLoading} metricAuditIsError={metricAuditIsError} />
          ) : null}
          {active === "raw" ? <RawDataTab {...props} /> : null}
        </div>
      </div>
    </ModalShell>
  );
}
