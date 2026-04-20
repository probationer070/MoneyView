"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { RefreshCw } from "lucide-react";
import { Sliders } from "@/components/ui/Sliders";
import type { DcfSummaryResponse as DCFResult } from "../../../../packages/shared-types";

interface DCFWorkbenchProps {
  ticker: string;
}

const DCF_WORKBENCH_CACHE_KEY = "moneyview:detail-dcf-workbench-cache:v1";

type DcfWorkbenchSnapshot = {
  ticker: string;
  wacc: number;
  margin: number;
  growth: number;
};

type CachedCalculation<TSnapshot, TResult> = {
  snapshot: TSnapshot;
  result: TResult;
  lastUpdatedAt: string;
};

function readSessionCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const rawValue = window.sessionStorage.getItem(key);
    if (!rawValue) return null;
    return JSON.parse(rawValue) as T;
  } catch {
    window.sessionStorage.removeItem(key);
    return null;
  }
}

function writeSessionCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "Not calculated yet";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return `Last updated ${parsed.toLocaleString()}`;
}

export const DCFWorkbench: React.FC<DCFWorkbenchProps> = ({ ticker }) => {
  // Rapid 60fps local UI state
  const [uiState, setUiState] = useState({ wacc: 10, margin: 15, growth: 5 });
  const [requestedSnapshot, setRequestedSnapshot] = useState<DcfWorkbenchSnapshot | null>(
    () => readSessionCache<CachedCalculation<DcfWorkbenchSnapshot, DCFResult>>(DCF_WORKBENCH_CACHE_KEY)?.snapshot ?? null,
  );
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [cachedCalculation] = useState<CachedCalculation<DcfWorkbenchSnapshot, DCFResult> | null>(
    () => readSessionCache<CachedCalculation<DcfWorkbenchSnapshot, DCFResult>>(DCF_WORKBENCH_CACHE_KEY),
  );
  const activeSnapshot = useMemo<DcfWorkbenchSnapshot>(() => ({
    ticker,
    wacc: uiState.wacc,
    margin: uiState.margin,
    growth: uiState.growth,
  }), [ticker, uiState.growth, uiState.margin, uiState.wacc]);

  // React Query rigorously managing UI polling and stale boundaries
  const { data, isFetching, isError } = useQuery<DCFResult>({
    queryKey: [
      "detail-dcf-workbench",
      requestedSnapshot?.ticker ?? "idle",
      requestedSnapshot?.wacc ?? "idle",
      requestedSnapshot?.margin ?? "idle",
      requestedSnapshot?.growth ?? "idle",
      refreshToken ?? "idle",
    ],
    queryFn: ({ signal }) => fetchApi(`/corporate/dcf/${ticker}`, {
      method: "POST",
      signal, // Wires ReactQuery AbortController cancelling stale inflight loops instantly
      body: JSON.stringify({
        revenue_growth_rate: (requestedSnapshot?.growth ?? uiState.growth) / 100,
        operating_margin: (requestedSnapshot?.margin ?? uiState.margin) / 100,
        wacc: (requestedSnapshot?.wacc ?? uiState.wacc) / 100,
        tax_rate: 0.25,
        terminal_growth_rate: 0.02
      })
    }),
    placeholderData: (prev) => prev, // Eliminates UI visual jarring on refetches
    staleTime: 1000 * 60,
    enabled: Boolean(requestedSnapshot && refreshToken),
  });
  const cachedData = cachedCalculation?.snapshot.ticker === ticker ? cachedCalculation.result : null;
  const displayData = data ?? cachedData;
  const displayLastUpdatedAt = data
    ? new Date().toISOString()
    : cachedCalculation?.snapshot.ticker === ticker
      ? cachedCalculation.lastUpdatedAt
      : null;
  const isStale = Boolean(
    displayData
    && requestedSnapshot
    && JSON.stringify(requestedSnapshot) !== JSON.stringify(activeSnapshot),
  );

  useEffect(() => {
    if (!data || !requestedSnapshot) return;
    writeSessionCache(DCF_WORKBENCH_CACHE_KEY, {
      snapshot: requestedSnapshot,
      result: data,
      lastUpdatedAt: new Date().toISOString(),
    } satisfies CachedCalculation<DcfWorkbenchSnapshot, DCFResult>);
  }, [data, requestedSnapshot]);

  const handleRefresh = () => {
    setRequestedSnapshot(activeSnapshot);
    setRefreshToken(`${Date.now()}`);
  };

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
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">Discounted Cash Flow (DCF) Diagnostics</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              This workbench stays idle on first load and recalculates only when you explicitly refresh it.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 text-xs text-[var(--text-muted)] sm:items-end">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isFetching}
              className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 font-semibold text-[var(--text-primary)] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh DCF Diagnostics
            </button>
            <span>{formatDateTime(displayLastUpdatedAt)}</span>
            {isStale ? (
              <span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">
                Showing stale diagnostics
              </span>
            ) : null}
          </div>
        </div>

        {/* Network Loader Ghost UI Mapping (Full Structural Skeleton) */}
        {isFetching && (
          <div className="absolute inset-0 bg-white/90 backdrop-blur-sm z-10 p-6 flex flex-col justify-center rounded-[var(--radius)]">
            <div className="flex space-x-3 mb-6 items-center">
              <div className="h-4 w-4 bg-[var(--surface)] rounded-full animate-bounce"></div>
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

        {!isError && displayData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Implied Fair Value</span>
                <div className="text-3xl font-black mt-1 tabular-nums text-[var(--text-primary)]">
                  ${Number.isFinite(displayData.estimated_value) ? (displayData.estimated_value).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "N/A"}
                </div>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-lg p-4">
                <span className="text-xs text-[var(--text-muted)] font-semibold uppercase tracking-wider">Market Dislocation</span>
                <div className={`text-3xl font-black mt-1 tabular-nums ${displayData.upside_pct >= 0 ? "text-[var(--surface)]" : "text-[var(--delta-down)]"}`}>
                  {displayData.upside_pct > 0 ? "+" : ""}{Number.isFinite(displayData.upside_pct) ? displayData.upside_pct.toFixed(1) : "0.0"}%
                </div>
              </div>
            </div>

            <div className="text-sm text-[var(--text-muted)] p-3 bg-blue-50/50 rounded-lg border border-blue-100/50">
              <strong>Engine Status:</strong> The security is currently flagged as <span className="font-bold underline decoration-dotted">{displayData.status}</span> trading directly off Python array inferences mapping targeted {displayData.margin_used * 100}% margins against a {displayData.wacc_used * 100}% WACC barrier.
            </div>
          </div>
        )}

        {!isError && !displayData && !isFetching && (
          <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-6 text-sm text-[var(--text-muted)]">
            DCF diagnostics stay idle on first load. Adjust the sliders if needed, then click `Refresh DCF Diagnostics`.
          </div>
        )}
      </div>
    </div>
  );
};
