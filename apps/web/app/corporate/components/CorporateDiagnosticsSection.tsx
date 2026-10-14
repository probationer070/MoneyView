"use client";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { useT } from "@/lib/i18n/locale";
import { BetaWaccCurveGraph, HurdleRateDecompositionGraph, ValueDriverMatrixGraph } from "./CorporateGraphs";
import type { BetaPoint, DetailKey, HurdleBarPoint, RegionalHurdlePoint, ValueMatrixPoint, WaccCurvePoint } from "./graphs/shared";

// Spec §3.1: three charts in one row (2 below 992px, 1 below 768px). DCF Core Modules moved to
// the DCF tab; the explanatory box became this tab's ⓘ.
export function CorporateDiagnosticsSection({
  companyName,
  hurdleBars,
  regionalHurdle,
  assumptionsDebtRatio,
  betaTreemapProxy,
  waccCurve,
  valueMatrix,
  onOpenDetail,
}: {
  companyName: string;
  hurdleBars: HurdleBarPoint[];
  regionalHurdle: RegionalHurdlePoint[];
  assumptionsDebtRatio: number;
  betaTreemapProxy: BetaPoint[];
  waccCurve: WaccCurvePoint[];
  valueMatrix: ValueMatrixPoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-3">
      <span data-testid="diagnostics-about" className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={t("corporate.tabs.diagnosticsAbout")} />
      </span>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <HurdleRateDecompositionGraph hurdleBars={hurdleBars} regionalHurdle={regionalHurdle} onOpenDetail={onOpenDetail} />
        <BetaWaccCurveGraph assumptionsDebtRatio={assumptionsDebtRatio} betaTreemapProxy={betaTreemapProxy} waccCurve={waccCurve} onOpenDetail={onOpenDetail} />
        <ValueDriverMatrixGraph companyName={companyName} valueMatrix={valueMatrix} onOpenDetail={onOpenDetail} />
      </div>
    </div>
  );
}
