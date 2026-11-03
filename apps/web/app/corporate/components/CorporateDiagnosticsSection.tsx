"use client";

import { useQueries } from "@tanstack/react-query";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { fetchApi } from "@/lib/api";
import { useT } from "@/lib/i18n/locale";
import { BetaWaccCurveGraph, HurdleRateDecompositionGraph, ValueDriverMatrixGraph } from "./CorporateGraphs";
import type { BetaPoint, DetailKey, HurdleBarPoint, ValueMatrixPoint } from "./graphs/shared";
import type { CorporateMetricsApi } from "../corporateTypes";

// Spec §3.1: three charts in one row (2 below 992px, 1 below 768px). DCF Core Modules moved to
// the DCF tab; the explanatory box became this tab's ⓘ.
export function CorporateDiagnosticsSection({
  companyName,
  hurdleBars,
  betaTreemapProxy,
  valueMatrix,
  matrixPeerTickers,
  growthReference,
  onOpenDetail,
}: {
  companyName: string;
  hurdleBars: HurdleBarPoint[];
  betaTreemapProxy: BetaPoint[];
  valueMatrix: ValueMatrixPoint[];
  /** Same-sector watchlist tickers whose metrics become the matrix's comparison points. */
  matrixPeerTickers: string[];
  growthReference: number;
  onOpenDetail: (key: DetailKey) => void;
}) {
  const t = useT();
  // Mounted only while this tab is open, so the peers' metrics load only when the matrix is seen.
  const peerQueries = useQueries({
    queries: matrixPeerTickers.map((ticker) => ({
      queryKey: ["corporate-matrix-peer", ticker],
      queryFn: () => fetchApi<CorporateMetricsApi>(`/corporate/metrics/${ticker}`),
      staleTime: 5 * 60_000,
    })),
  });
  const peerPoints: ValueMatrixPoint[] = peerQueries.flatMap((query) => (query.data
    ? [{
      name: query.data.ticker,
      growth: query.data.growth,
      spread: query.data.roic - query.data.wacc,
      efficiency: 0,
      fcff: query.data.fcff,
    }]
    : []));
  return (
    <div className="flex flex-col gap-3">
      <span data-testid="diagnostics-about" className="type-small self-start text-[var(--ink-muted)]">
        <InfoTooltip label={t("corporate.tabs.about")} description={t("corporate.tabs.diagnosticsAbout")} />
      </span>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <HurdleRateDecompositionGraph hurdleBars={hurdleBars} onOpenDetail={onOpenDetail} />
        <BetaWaccCurveGraph betaTreemapProxy={betaTreemapProxy} onOpenDetail={onOpenDetail} />
        <ValueDriverMatrixGraph companyName={companyName} valueMatrix={[...valueMatrix, ...peerPoints]} growthReference={growthReference} onOpenDetail={onOpenDetail} />
      </div>
    </div>
  );
}
