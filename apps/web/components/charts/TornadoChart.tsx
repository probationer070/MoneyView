"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Cell, CartesianGrid } from "recharts";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { useLocale } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";
import { GRID_STYLE, fmtCurrencyTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";

interface TornadoEntry {
    name: string;
    target: number;
}

export const TornadoChart: React.FC<{ data: TornadoEntry[] }> = ({ data }) => {
  const { locale } = useLocale();
    // Dynamic logic rendering standard distributions (Bear is red, Base is gray, Bull is green)
    const getColor = (name: string) => {
        if (name.includes("Bear")) return "var(--down)";
        if (name.includes("Base")) return "var(--ink-muted)";
        return "var(--brand)";
    };

    return (
        <ChartPanelFrame
            title="Monte Carlo Sensitivity Bounds"
            empty={data.length === 0}
            emptyTitle="No sensitivity data available"
            emptyDescription="Refresh diagnostics to load the tornado sensitivity bounds."
            className="h-[400px] min-h-[400px] min-w-0 w-full bg-[var(--surface-raised)]"
        >
            <div className="mt-4 h-full">
            <ResponsiveChart minWidth={1} minHeight={1}>
                <BarChart data={data} layout="vertical" margin={{ top: 20, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid {...GRID_STYLE} horizontal={false} />
                    <XAxis type="number" {...withAxisProps({ tickFormatter: (value: number | string) => fmtCurrencyTick(Number(value), 0) })} />
                    <YAxis dataKey="name" type="category" {...withCategoryAxisProps()} />
                    <Tooltip 
                        {...withTooltipProps({ cursor: { fill: "var(--surface)" } })}
                        formatter={(value) => [`$${formatNumber(Number(value ?? 0), "price", { digits: 1, locale })}`, "Implied Target"]}
                    />
                    <Bar dataKey="target" barSize={40}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getColor(entry.name)} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveChart>
            </div>
        </ChartPanelFrame>
    );
};
