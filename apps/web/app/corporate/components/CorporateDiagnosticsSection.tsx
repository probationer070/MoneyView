"use client";

import {
  BetaWaccCurveGraph,
  CompanyStatusGraph,
  DcfCoreModulesGraph,
  HurdleRateDecompositionGraph,
  RiskReturnMinardGraph,
  ValueDriverMatrixGraph,
} from "./CorporateGraphs";
import type {
  BetaPoint,
  DetailKey,
  DcfResult,
  HealthRadarPoint,
  HurdleBarPoint,
  RegionalHurdlePoint,
  RiskReturnPoint,
  ValueMatrixPoint,
  WaccCurvePoint,
} from "./graphs/shared";

export function CorporateDiagnosticsSection({
  companyName,
  healthScore,
  healthRadar,
  includeSubjectiveHealth,
  onIncludeSubjectiveHealthChange,
  hurdleBars,
  regionalMinard,
  assumptionsDebtRatio,
  betaTreemapProxy,
  waccCurve,
  valueMatrix,
  derivedSpread,
  successProbability,
  riskReturn,
  sustainableGrowth,
  terminalValueShare,
  fcff,
  dcfResult,
  onOpenDetail,
}: {
  companyName: string;
  healthScore: number;
  healthRadar: HealthRadarPoint[];
  includeSubjectiveHealth: boolean;
  onIncludeSubjectiveHealthChange: (value: boolean) => void;
  hurdleBars: HurdleBarPoint[];
  regionalMinard: RegionalHurdlePoint[];
  assumptionsDebtRatio: number;
  betaTreemapProxy: BetaPoint[];
  waccCurve: WaccCurvePoint[];
  valueMatrix: ValueMatrixPoint[];
  derivedSpread: number;
  successProbability: number;
  riskReturn: RiskReturnPoint[];
  sustainableGrowth: number;
  terminalValueShare: number;
  fcff: number;
  dcfResult?: DcfResult;
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <>
      <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-muted)] p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Core Diagnostics</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Company Status Diagnosis, Hurdle Rate Decomposition, 4-Quadrant Value Driver Matrix, and Risk-Return Minard Chart are part of the main Corporate Analysis dashboard and should remain visible in the chart section below.
            </p>
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            Tap any chart title to open its detailed formula view.
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <CompanyStatusGraph
          companyName={companyName}
          healthScore={healthScore}
          healthRadar={healthRadar}
          includeSubjectiveHealth={includeSubjectiveHealth}
          onIncludeSubjectiveHealthChange={onIncludeSubjectiveHealthChange}
          onOpenDetail={onOpenDetail}
        />

        <HurdleRateDecompositionGraph
          hurdleBars={hurdleBars}
          regionalMinard={regionalMinard}
          onOpenDetail={onOpenDetail}
        />

        <BetaWaccCurveGraph
          assumptionsDebtRatio={assumptionsDebtRatio}
          betaTreemapProxy={betaTreemapProxy}
          waccCurve={waccCurve}
          onOpenDetail={onOpenDetail}
        />

        <ValueDriverMatrixGraph
          companyName={companyName}
          valueMatrix={valueMatrix}
          onOpenDetail={onOpenDetail}
        />

        <RiskReturnMinardGraph
          derivedSpread={derivedSpread}
          successProbability={successProbability}
          riskReturn={riskReturn}
          onOpenDetail={onOpenDetail}
        />

        <DcfCoreModulesGraph
          sustainableGrowth={sustainableGrowth}
          terminalValueShare={terminalValueShare}
          fcff={fcff}
          dcfResult={dcfResult}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </>
  );
}
