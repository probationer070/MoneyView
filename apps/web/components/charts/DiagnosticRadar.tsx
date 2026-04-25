"use client";

import React from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip } from "recharts";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { AXIS_TICK_STYLE, withTooltipProps } from "@/lib/chartConfig";

interface RadarEntry {
    subject: string;
    score: number;
    peer: number;
    max: number;
}

export const DiagnosticRadar: React.FC<{ data: RadarEntry[] }> = ({ data }) => {
    return (
        <ChartPanelFrame
            title="Strategic Positioning"
            empty={data.length === 0}
            emptyTitle="No diagnostic radar data available"
            emptyDescription="Refresh diagnostics to load the strategic positioning radar."
            className="h-[400px] min-h-[400px] min-w-0 w-full bg-[var(--surface-panel)]"
        >
            <div className="mt-4 h-full">
            <ResponsiveChart minWidth={1} minHeight={1}>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="subject" tick={AXIS_TICK_STYLE} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    
                    {/* Primary Overlay */}
                    <Radar 
                        name="Target Security" 
                        dataKey="score" 
                        stroke="var(--accent)"
                        fill="var(--accent)"
                        fillOpacity={0.5} 
                    />
                    
                    {/* Peer Overlay */}
                    <Radar 
                        name="Industry Average" 
                        dataKey="peer" 
                        stroke="var(--text-muted)"
                        fill="var(--text-muted)"
                        fillOpacity={0.2} 
                    />
                    
                    <Tooltip {...withTooltipProps()} />
                </RadarChart>
            </ResponsiveChart>
            </div>
        </ChartPanelFrame>
    );
};
