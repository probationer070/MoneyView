"use client";

import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { type DetailKey, type HurdleBarPoint, type RegionalHurdlePoint, pct, pct2 } from "./shared";

export function HurdleRateDecompositionGraph({
  hurdleBars,
  regionalMinard,
  onOpenDetail,
}: {
  hurdleBars: HurdleBarPoint[];
  regionalMinard: RegionalHurdlePoint[];
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-sm">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-[var(--text-primary)]">Hurdle Rate Decomposition</h3>
        <button
          type="button"
          onClick={() => onOpenDetail("hurdleDecomposition")}
          className="mt-1 text-left text-xs text-[var(--text-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
        >
          <InfoTooltip
            label="Open formula and regional breakdown details"
            description="Cost of equity uses market-implied expected returns instead of historical ERP. Indicators are shown for the US, EU, Korea, and emerging markets."
          />
        </button>
      </div>
      <div className="h-72 min-h-72 min-w-0">
        <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
          <ComposedChart data={regionalMinard} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="region" tick={{ fill: "var(--text-muted)" }} />
            <YAxis tick={{ fill: "var(--text-muted)" }} />
            <ZAxis dataKey="revenue" range={[80, 520]} />
            <Tooltip formatter={(value, name) => (name === "Implied ERP" ? pct2(Number(value)) : pct(Number(value)))} />
            <Bar dataKey="crp" name="CRP" fill="#444444" radius={[4, 4, 0, 0]} />
            <Line dataKey="erp" name="Implied ERP" stroke="var(--accent)" strokeWidth={3} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveChart>
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[var(--text-muted)] sm:grid-cols-2 lg:grid-cols-3">
        {hurdleBars.map((item) => (
          <button
            key={item.name}
            type="button"
            onClick={() => {
              if (item.name === "CRP") onOpenDetail("crp");
              else if (item.name === "Beta x Implied ERP") onOpenDetail("erp");
              else onOpenDetail("bottomUpKe");
            }}
            className="flex items-center gap-2 text-left transition hover:text-[var(--surface)]"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.fill }} />
            {item.name}: {pct(item.value)}
          </button>
        ))}
      </div>
    </div>
  );
}
