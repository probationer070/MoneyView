"use client";

import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";

interface TornadoEntry {
    name: string;
    target: number;
}

const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

export const TornadoChart: React.FC<{ data: TornadoEntry[] }> = ({ data }) => {
    // Dynamic logic rendering standard distributions (Bear is red, Base is gray, Bull is green)
    const getColor = (name: string) => {
        if (name.includes("Bear")) return "var(--delta-down)";
        if (name.includes("Base")) return "var(--text-muted)";
        return "var(--accent)";
    };

    return (
        <div className="bg-[var(--surface-panel)] rounded-[var(--radius)] border border-[var(--border)] p-6 shadow-sm w-full h-[400px] min-h-[400px] min-w-0">
            <h2 className="text-lg font-bold mb-4">Monte Carlo Sensitivity Bounds</h2>
            <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart data={data} layout="vertical" margin={{ top: 20, right: 30, left: 40, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                    <XAxis type="number" tickFormatter={(v) => `$${v}`} tick={{fill: "var(--text-muted)"}} />
                    <YAxis dataKey="name" type="category" tick={{fill: "var(--text-primary)", fontWeight: 600}} axisLine={false} tickLine={false} />
                    <Tooltip 
                        formatter={(value) => [`$${Number(value ?? 0).toFixed(1)}`, "Implied Target"]}
                        cursor={{fill: "rgba(0,0,0,0.05)"}}
                        contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)" }}
                    />
                    <Bar dataKey="target" radius={[0, 4, 4, 0]} barSize={40}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={getColor(entry.name)} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};
