"use client";

import type { DcfFullReport } from "../../../../../packages/shared-types";
import { ActionButton } from "@/components/ui/ActionButton";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { numberText, pct } from "../corporateUtils";
import { DcfCoreModulesGraph } from "./CorporateGraphs";
import { DcfSensitivityTable } from "./DcfSensitivityTable";
import type { DcfResult, DetailKey } from "./graphs/shared";

export interface DcfTabProps {
  sustainableGrowth: number;
  fcff: number;
  dcfResult?: DcfResult;
  onOpenDetail: (key: DetailKey) => void;
  report: DcfFullReport | null;
  reportLoading: boolean;
  reportError: string | null;
  canLoadReport: boolean;
  onLoadReport: () => void;
}

// Spec §3.2: the DCF core values on the left; the 5x5 grid on the right once the full report is
// loaded, which happens only when asked (the page's idle-on-load rule).
export function DcfTab({ sustainableGrowth, fcff, dcfResult, onOpenDetail, report, reportLoading, reportError, canLoadReport, onLoadReport }: DcfTabProps) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <span className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={t("corporate.tabs.dcfAbout")} />
      </span>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DcfCoreModulesGraph sustainableGrowth={sustainableGrowth} fcff={fcff} dcfResult={dcfResult} onOpenDetail={onOpenDetail} />
        <Card padding="md" className="min-w-0">
          {report ? (
            <DcfSensitivityTable sensitivity={report.sensitivity} formatNumber={numberText} formatPct={pct} />
          ) : (
            <div className="flex flex-col items-start gap-3">
              {reportLoading ? (
                <EmptyState title={t("corporate.dcfTab.loading")} />
              ) : reportError ? (
                <ErrorState title={t("corporate.dcfTab.unavailable")} message={reportError} />
              ) : (
                <EmptyState title={t("corporate.dcfTab.empty")} />
              )}
              <ActionButton label={t("corporate.dcfTab.loadReport")} size="sm" variant="secondary" disabled={!canLoadReport || reportLoading} onClick={onLoadReport} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
