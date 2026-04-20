"use client";

import React from "react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip } from "recharts";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";

interface RadarEntry {
    subject: string;
    score: number;
    peer: number;
    max: number;
}

export const DiagnosticRadar: React.FC<{ data: RadarEntry[] }> = ({ data }) => {
    return (
        <div className="bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-6 shadow-sm w-full h-[400px] min-h-[400px] min-w-0">
            <h2 className="text-lg font-bold mb-4">Strategic Positioning</h2>
            <ResponsiveChart minWidth={1} minHeight={1}>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                    <PolarGrid stroke="var(--border)" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--text-muted)", fontSize: 12 }} />
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
                    
                    <Tooltip 
                        contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                    />
                </RadarChart>
            </ResponsiveChart>
        </div>
    );
};
