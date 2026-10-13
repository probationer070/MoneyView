"use client";

import { Card } from "@/components/ui/Card";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { useT } from "@/lib/i18n/locale";
import { numberText2, pct } from "../corporateUtils";
import type { CalculationDetailKey } from "./calculationDetailTypes";

interface KpiRowProps {
  spread: number;
  bottomUpKe: number;
  wacc: number;
  leveredBeta: number;
  onOpenDetail: (key: CalculationDetailKey) => void;
}

// Spec §2.3: ROIC - WACC, Bottom-up Ke, WACC, levered beta; one-line caption; the tile opens
// its detail. The numbers behind each caption are in the detail's substituted formula.
export function KpiRow({ spread, bottomUpKe, wacc, leveredBeta, onOpenDetail }: KpiRowProps) {
  const t = useT();
  const tiles: { key: CalculationDetailKey; label: string; value: string; caption: string }[] = [
    { key: "spread", label: t("corporate.kpi.spread"), value: pct(spread), caption: t(spread >= 0 ? "corporate.kpi.spreadUp" : "corporate.kpi.spreadDown") },
    { key: "bottomUpKe", label: t("corporate.kpi.ke"), value: pct(bottomUpKe), caption: t("corporate.kpi.keCaption") },
    { key: "wacc", label: t("corporate.kpi.wacc"), value: pct(wacc), caption: t("corporate.kpi.waccCaption") },
    { key: "leveredBeta", label: t("corporate.kpi.beta"), value: numberText2(leveredBeta), caption: t("corporate.kpi.betaCaption") },
  ];
  return (
    <div data-testid="corporate-kpis" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((tile) => (
        <Card key={tile.key} padding="sm" hoverable>
          <KPIBlock label={tile.label} value={tile.value} size="sm" onClick={() => onOpenDetail(tile.key)} />
          <p className="type-small mt-1 truncate text-[var(--ink-muted)]">{tile.caption}</p>
        </Card>
      ))}
    </div>
  );
}
