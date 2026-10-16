"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DcfRefusalError, postDcf } from "@/lib/dcfRefusal";
import { RefreshCw } from "lucide-react";
import { useLocale } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";
import { Sliders } from "@/components/ui/Sliders";
import type { DcfSummaryResponse as DCFResult } from "../../../../packages/shared-types";
import { bridgedEstimatedValue, bridgedUpsidePct, UNBRIDGED_PLACEHOLDER, UNBRIDGED_REASON } from "@/lib/bridgeQuality";

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
  const { locale } = useLocale();
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
  const { data, isFetching, isError, error } = useQuery<DCFResult>({
    queryKey: [
      "detail-dcf-workbench",
      requestedSnapshot?.ticker ?? "idle",
      requestedSnapshot?.wacc ?? "idle",
      requestedSnapshot?.margin ?? "idle",
      requestedSnapshot?.growth ?? "idle",
      refreshToken ?? "idle",
    ],
    // postDcf, not fetchApi: a 422 refusal (e.g. non_positive_fcff) must reach the render as
    // a DcfRefusalError with its code, not as a generic failure. The signal still cancels
    // stale in-flight requests.
    queryFn: ({ signal }) => postDcf<DCFResult>(`/corporate/dcf/${ticker}`, {
      revenue_growth_rate: (requestedSnapshot?.growth ?? uiState.growth) / 100,
      operating_margin: (requestedSnapshot?.margin ?? uiState.margin) / 100,
      wacc: (requestedSnapshot?.wacc ?? uiState.wacc) / 100,
      tax_rate: 0.25,
      terminal_growth_rate: 0.02
    }, signal),
    placeholderData: (prev) => prev, // Eliminates UI visual jarring on refetches
    // A refusal is deterministic: retrying it (AppProvider's default is 3) only held the
    // skeleton for ~7s and sent the same request 4 times. Other failures keep the default.
    retry: (failureCount, error) => !(error instanceof DcfRefusalError) && failureCount < 3,
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

      <div className="lg:col-span-2 bg-[var(--surface-raised)] border border-[var(--line)] p-6 relative">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="type-panel-title">Discounted Cash Flow (DCF) Diagnostics</h2>
            <p className="mt-1 type-body text-[var(--ink-muted)]">
              This workbench stays idle on first load and recalculates only when you explicitly refresh it.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 type-small text-[var(--ink-muted)] sm:items-end">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isFetching}
              className="inline-flex items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-2 text-[var(--ink)] disabled:opacity-60"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh DCF Diagnostics
            </button>
            <span>{formatDateTime(displayLastUpdatedAt)}</span>
            {isStale ? (
              <span className="rounded-[var(--radius-2)] bg-[var(--status-warning-surface)] px-2 py-1 type-caption text-[var(--status-warning-ink)]">
                Showing stale diagnostics
              </span>
            ) : null}
          </div>
        </div>

        {/* Network Loader Ghost UI Mapping (Full Structural Skeleton) */}
        {isFetching && (
          <div className="absolute inset-0 bg-[var(--surface-raised)] backdrop-blur-sm z-10 p-6 flex flex-col justify-center">
            <div className="flex space-x-3 mb-6 items-center">
              {/* rounded-full: dot */}
              <div className="h-4 w-4 bg-[var(--brand)] rounded-full animate-bounce"></div>
              <div className="h-4 w-48 bg-[var(--surface)] animate-pulse"></div>
            </div>
            <div className="grid grid-cols-2 gap-4 flex-1">
              <div className="bg-[var(--surface)] animate-pulse w-full h-24"></div>
              <div className="bg-[var(--surface)] animate-pulse w-full h-24"></div>
            </div>
          </div>
        )}

        {isError && error instanceof DcfRefusalError && (
          <p data-testid="dcf-workbench-refusal" className="type-body p-3 border border-[var(--line)] text-[var(--ink-secondary)]">
            Not valued: {error.readerText}
          </p>
        )}
        {isError && !(error instanceof DcfRefusalError) && (
          <div className="text-[var(--status-error-ink)] type-body bg-[var(--status-error-surface)] p-3 border border-[var(--status-error-border)]">
            Backend failed to compute DCF boundaries. Check Pydantic validation logs.
          </div>
        )}

        {!isError && displayData && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[var(--surface)] border border-[var(--grid)] p-4">
                <span className="type-small text-[var(--ink-muted)] uppercase">Implied Fair Value</span>
                <div
                  className="type-figure-md mt-1 tabular-nums text-[var(--ink)]"
                  title={bridgedEstimatedValue(displayData) === null ? UNBRIDGED_REASON : undefined}
                >
                  {(() => {
                    const fairValue = bridgedEstimatedValue(displayData);
                    if (fairValue === null) return UNBRIDGED_PLACEHOLDER;
                    // Pre-existing non-finite guard, kept as it was apart from moving the "$"
                    // inside it -- it previously rendered the string "$N/A".
                    if (!Number.isFinite(fairValue)) return "N/A";
                    return `$${formatNumber(fairValue, "price", { digits: 1, locale })}`;
                  })()}
                </div>
              </div>
              <div className="bg-[var(--surface)] border border-[var(--grid)] p-4">
                <span className="type-small text-[var(--ink-muted)] uppercase">Market Dislocation</span>
                <div className={`type-figure-md mt-1 tabular-nums ${bridgedUpsidePct(displayData) === null ? "text-[var(--ink-muted)]" : displayData.upside_pct >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                  {bridgedUpsidePct(displayData) === null
                    ? UNBRIDGED_PLACEHOLDER
                    : `${formatNumber(displayData.upside_pct / 100, "percent", { signed: true, locale })}`}
                </div>
              </div>
            </div>

            <div className="type-body text-[var(--ink-muted)] p-3 bg-[var(--surface)] border border-[var(--grid)]">
              <strong>Engine Status:</strong> The security is currently flagged as <span className="underline decoration-dotted">{displayData.status}</span> trading directly off Python array inferences mapping targeted {displayData.margin_used * 100}% margins against a {displayData.wacc_used * 100}% WACC barrier.
            </div>
          </div>
        )}

        {!isError && !displayData && !isFetching && (
          <div className="border border-dashed border-[var(--line)] bg-[var(--surface)] px-4 py-6 type-body text-[var(--ink-muted)]">
            DCF diagnostics stay idle on first load. Adjust the sliders if needed, then click `Refresh DCF Diagnostics`.
          </div>
        )}
      </div>
    </div>
  );
};
