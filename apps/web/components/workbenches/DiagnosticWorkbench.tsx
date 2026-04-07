"use client";

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { DiagnosticRadar } from "@/components/charts/DiagnosticRadar";
import { TornadoChart } from "@/components/charts/TornadoChart";

interface RadarEntry {
    subject: string;
    score: number;
    peer: number;
    max: number;
}

interface TornadoEntry {
    name: string;
    target: number;
}

export const DiagnosticWorkbench: React.FC<{ ticker: string }> = ({ ticker }) => {
    // Parallel React Query fetching for completely decoupled Recharts layouts
    const { data: radarData, isLoading: radarLoading } = useQuery({
        queryKey: ['radar', ticker],
        queryFn: ({ signal }) => fetchApi<RadarEntry[]>(`/corporate/diagnostic/${ticker}/radar`, { signal }),
        staleTime: 1000 * 60 * 60, // Scored rarely update intra-day
    });

    const { data: tornadoData, isLoading: tornadoLoading } = useQuery({
        queryKey: ['tornado', ticker],
        queryFn: ({ signal }) => fetchApi<TornadoEntry[]>(`/corporate/diagnostic/${ticker}/tornado`, { signal }),
        staleTime: 1000 * 60 * 60, 
    });

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="relative">
                {radarLoading && (
                    <div className="absolute inset-0 bg-white z-10 rounded-[var(--radius)] border border-gray-100 p-6 flex flex-col shadow-sm">
                        <div className="h-6 w-48 bg-gray-200 rounded animate-pulse mb-6"></div>
                        <div className="flex-1 w-full flex items-center justify-center">
                            <div className="w-[80%] aspect-square rounded-full border-[20px] border-gray-100 animate-pulse"></div>
                        </div>
                    </div>
                )}
                {radarData ? <DiagnosticRadar data={radarData} /> : <div className="h-[400px] bg-white rounded-lg border border-dashed border-gray-200"></div>}
            </div>

            <div className="relative">
                {tornadoLoading && (
                    <div className="absolute inset-0 bg-white z-10 rounded-[var(--radius)] border border-gray-100 p-6 flex flex-col shadow-sm">
                        <div className="h-6 w-64 bg-gray-200 rounded animate-pulse mb-10"></div>
                        <div className="space-y-8 mt-4 w-full px-6">
                            <div className="h-10 w-full bg-gray-100 rounded animate-pulse relative"><div className="absolute left-0 top-0 h-full w-[25%] bg-gray-200 rounded-l"></div></div>
                            <div className="h-10 w-full bg-gray-100 rounded animate-pulse relative"><div className="absolute left-0 top-0 h-full w-[60%] bg-gray-200 rounded-l"></div></div>
                            <div className="h-10 w-full bg-gray-100 rounded animate-pulse relative"><div className="absolute left-0 top-0 h-full w-[85%] bg-gray-200 rounded-l"></div></div>
                        </div>
                    </div>
                )}
                {tornadoData ? <TornadoChart data={tornadoData} /> : <div className="h-[400px] bg-white rounded-lg border border-dashed border-gray-200"></div>}
            </div>
        </div>
    );
};
