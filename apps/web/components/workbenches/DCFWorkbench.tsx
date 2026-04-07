"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { Sliders } from "@/components/ui/Sliders";

interface DCFWorkbenchProps {
  ticker: string;
}

// Ensure strict payload typing
interface DCFResult {
  estimated_value: number;
  current_price: number;
  upside_pct: number;
  wacc_used: number;
  margin_used: number;
  growth_used: number;
  status: string; // e.g. "Undervalued", "Overvalued"
}

export const DCFWorkbench: React.FC<DCFWorkbenchProps> = ({ ticker }) => {
  // Rapid 60fps local UI state
  const [uiState, setUiState] = useState({ wacc: 10, margin: 15, growth: 5 });
  
  // Staged 300ms delayed state for backend dispatching
  const debouncedState = useDebounce(uiState, 300);

  // React Query rigorously managing UI polling and stale boundaries
  const { data, isFetching, isError } = useQuery<DCFResult>({
    queryKey: ['dcf', ticker, debouncedState.wacc, debouncedState.margin, debouncedState.growth],
    queryFn: ({ signal }) => fetchApi(`/corporate/dcf/${ticker}`, {
        method: "POST",
        signal, // Wires ReactQuery AbortController cancelling stale inflight loops instantly
        body: JSON.stringify({
            revenue_growth_rate: debouncedState.growth / 100, 
            operating_margin: debouncedState.margin / 100,
            wacc: debouncedState.wacc / 100,
            tax_rate: 0.25, 
            terminal_growth_rate: 0.02 
        })
    }),
    placeholderData: (prev) => prev, // Eliminates UI visual jarring on refetches
    staleTime: 1000 * 60, 
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
      <div className="lg:col-span-1">
        <Sliders 
          initialWacc={uiState.wacc}
          initialMargin={uiState.margin}
          initialGrowth={uiState.growth}
          onChange={setUiState}
        />
      </div>

      <div className="lg:col-span-2 bg-white rounded-[var(--radius)] border border-[var(--border)] p-6 shadow-sm relative">
        <h2 className="text-lg font-bold mb-4">Discounted Cash Flow (DCF) Diagnostics</h2>
        
        {/* Network Loader Ghost UI Mapping (Full Structural Skeleton) */}
        {isFetching && (
            <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-10 p-6 flex flex-col justify-center rounded-[var(--radius)]">
                <div className="flex space-x-3 mb-6 items-center">
                    <div className="h-4 w-4 bg-[var(--accent)] rounded-full animate-bounce"></div>
                    <div className="h-4 w-48 bg-gray-200 rounded animate-pulse"></div>
                </div>
                <div className="grid grid-cols-2 gap-4 flex-1">
                    <div className="bg-gray-100 rounded-lg animate-pulse w-full h-24"></div>
                    <div className="bg-gray-100 rounded-lg animate-pulse w-full h-24"></div>
                </div>
            </div>
        )}

        {isError && (
            <div className="text-red-500 text-sm bg-red-50 rounded-md p-3 border border-red-100">
               Backend failed to compute DCF boundaries. Check Pydantic validation logs.
            </div>
        )}

        {!isError && data && (
            <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                         <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Implied Fair Value</span>
                         <div className="text-3xl font-black mt-1 tabular-nums text-[var(--text-primary)]">
                             ${Number.isFinite(data.estimated_value) ? (data.estimated_value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) : "N/A"}
                         </div>
                    </div>
                    <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                         <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Market Dislocation</span>
                         <div className={`text-3xl font-black mt-1 tabular-nums ${data.upside_pct >= 0 ? "text-[var(--accent)]" : "text-[var(--delta-down)]"}`}>
                             {data.upside_pct > 0 ? "+" : ""}{Number.isFinite(data.upside_pct) ? data.upside_pct.toFixed(2) : "0.00"}%
                         </div>
                    </div>
                </div>

                <div className="text-sm text-[var(--text-muted)] p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
                    <strong>Engine Status:</strong> The security is currently flagged as <span className="font-bold underline decoration-dotted">{data.status}</span> trading directly off Python array inferences mapping targeted {data.margin_used * 100}% margins against a {data.wacc_used * 100}% WACC barrier.
                </div>
            </div>
        )}
      </div>
    </div>
  );
};
