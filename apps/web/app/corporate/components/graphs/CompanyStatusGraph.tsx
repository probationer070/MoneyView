"use client";

import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, Tooltip } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { type DetailKey, type HealthRadarPoint, numberText } from "./shared";

export function CompanyStatusGraph({
  companyName,
  healthScore,
  healthRadar,
  includeSubjectiveHealth,
  onIncludeSubjectiveHealthChange,
  onOpenDetail,
}: {
  companyName: string;
  healthScore: number;
  healthRadar: HealthRadarPoint[];
  includeSubjectiveHealth: boolean;
  onIncludeSubjectiveHealthChange: (value: boolean) => void;
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => onOpenDetail("companyStatus")}
          className="text-left text-sm font-bold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
        >
          <InfoTooltip
            label="Company Status Diagnosis"
            description="Radar axes combine objective operating drivers with levered beta risk. Governance, ESG/agency, and innovation are subjective and can be toggled into or out of the score."
          />
        </button>
        <div
          className="h-14 w-14 rounded-full border-4 flex items-center justify-center text-sm font-black"
          style={{
            borderColor: healthScore > 65 ? "var(--accent)" : "var(--delta-down)",
            backgroundColor: healthScore > 65 ? "rgba(96,202,173,0.12)" : "rgba(157,165,162,0.14)",
          }}
        >
          {numberText(healthScore)}
        </div>
      </div>
      <label className="mt-3 flex items-center gap-2 rounded-[var(--radius)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--text-primary)]">
        <input
          type="checkbox"
          checked={includeSubjectiveHealth}
          onChange={(event) => onIncludeSubjectiveHealthChange(event.target.checked)}
          className="h-4 w-4 accent-[var(--surface)]"
        />
        Include subjective Innovation, Governance, and ESG/Agency inputs
      </label>
      <div className="h-72 min-h-72 min-w-0">
        <ResponsiveChart minWidth={1} minHeight={1}>
          <RadarChart data={healthRadar}>
            <PolarGrid stroke="var(--border)" />
            <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
            <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
            <Radar name={companyName} dataKey="score" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.45} />
            <Radar name="Peer" dataKey="peer" stroke="var(--text-muted)" fill="var(--text-muted)" fillOpacity={0.16} />
            <Tooltip />
          </RadarChart>
        </ResponsiveChart>
      </div>
    </div>
  );
}
