"use client";

import { Card } from "@/components/ui/Card";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { useT } from "@/lib/i18n/locale";
import { MISSING } from "@/lib/format";
import { numberText2, pct } from "../corporateUtils";
import type { AssumptionsApi } from "../corporateTypes";
import { AssumptionSourceCaption, WaccRefusedNote } from "./AssumptionSourceCaption";
import type { CalculationDetailKey } from "./calculationDetailTypes";

interface KpiRowProps {
  spread: number;
  bottomUpKe: number;
  wacc: number;
  leveredBeta: number;
  /** The `wacc_refusal.missing` list when the server refused the WACC; null otherwise. */
  refusedMissing: string[] | null;
  /** The server's rf/ERP echo: its source line replaces the Ke caption, so the Summary keeps its height. */
  assumptionsEcho: AssumptionsApi | null;
  onOpenDetail: (key: CalculationDetailKey) => void;
}

// Spec §2.3: ROIC - WACC, Bottom-up Ke, WACC, levered beta; one-line caption; the tile opens
// its detail. The numbers behind each caption are in the detail's substituted formula.
export function KpiRow({ spread, bottomUpKe, wacc, leveredBeta, refusedMissing, assumptionsEcho, onOpenDetail }: KpiRowProps) {
  const t = useT();
  const tiles: { key: CalculationDetailKey; label: string; value: string; caption: string }[] = [
    { key: "spread", label: t("corporate.kpi.spread"), value: pct(spread), caption: Number.isFinite(spread) ? t(spread >= 0 ? "corporate.kpi.spreadUp" : "corporate.kpi.spreadDown") : "" },
    refusedMissing
      ? { key: "bottomUpKe", label: t("corporate.kpi.ke"), value: MISSING, caption: t("corporate.assumptions.missing.title") }
      : { key: "bottomUpKe", label: t("corporate.kpi.ke"), value: pct(bottomUpKe), caption: t("corporate.kpi.keCaption") },
    { key: "wacc", label: t("corporate.kpi.wacc"), value: pct(wacc), caption: t("corporate.kpi.waccCaption") },
    { key: "leveredBeta", label: t("corporate.kpi.beta"), value: numberText2(leveredBeta), caption: t("corporate.kpi.betaCaption") },
  ];
  return (
    <div data-testid="corporate-kpis" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.key} padding="sm" hoverable>
          {tile.key === "wacc" && refusedMissing ? (
            <>
              <span className="type-label text-[var(--ink-secondary)]">{tile.label}</span>
              <div className="mt-1"><WaccRefusedNote missing={refusedMissing} /></div>
            </>
          ) : (
            <>
              <KPIBlock label={tile.label} value={tile.value} size="sm" onClick={() => onOpenDetail(tile.key)} />
              {tile.key === "bottomUpKe" && assumptionsEcho ? (
                <div className="mt-1"><AssumptionSourceCaption assumptions={assumptionsEcho} compact /></div>
              ) : (
                <p title={tile.caption} className="type-small mt-1 truncate text-[var(--ink-muted)]">{tile.caption}</p>
              )}
            </>
          )}
        </Card>
      ))}
    </div>
  );
}
