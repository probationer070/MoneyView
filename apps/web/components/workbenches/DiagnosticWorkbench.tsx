"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { RefreshCw } from "lucide-react";
import { DiagnosticRadar } from "@/components/charts/DiagnosticRadar";
import { TornadoChart } from "@/components/charts/TornadoChart";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";

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

const DIAGNOSTIC_WORKBENCH_CACHE_KEY = "moneyview:detail-diagnostic-workbench-cache:v1";

type DiagnosticSnapshot = {
    ticker: string;
};

type DiagnosticCache = {
    snapshot: DiagnosticSnapshot;
    radarData: RadarEntry[];
    tornadoData: TornadoEntry[];
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
    if (!value) return "Not loaded yet";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return `Last updated ${parsed.toLocaleString()}`;
}

export const DiagnosticWorkbench: React.FC<{ ticker: string }> = ({ ticker }) => {
    const [requestedSnapshot, setRequestedSnapshot] = useState<DiagnosticSnapshot | null>(
        () => readSessionCache<DiagnosticCache>(DIAGNOSTIC_WORKBENCH_CACHE_KEY)?.snapshot ?? null,
    );
    const [refreshToken, setRefreshToken] = useState<string | null>(null);
    const [cachedDiagnostics] = useState<DiagnosticCache | null>(
        () => readSessionCache<DiagnosticCache>(DIAGNOSTIC_WORKBENCH_CACHE_KEY),
    );

    // Parallel React Query fetching for completely decoupled Recharts layouts
    const { data: radarData, isLoading: radarLoading, isError: radarError } = useQuery({
        queryKey: ["detail-radar", requestedSnapshot?.ticker ?? "idle", refreshToken ?? "idle"],
        queryFn: ({ signal }) => fetchApi<RadarEntry[]>(`/corporate/diagnostic/${requestedSnapshot?.ticker ?? ticker}/radar`, { signal }),
        staleTime: 1000 * 60 * 60, // Scored rarely update intra-day
        enabled: Boolean(requestedSnapshot && refreshToken),
    });

    const { data: tornadoData, isLoading: tornadoLoading, isError: tornadoError } = useQuery({
        queryKey: ["detail-tornado", requestedSnapshot?.ticker ?? "idle", refreshToken ?? "idle"],
        queryFn: ({ signal }) => fetchApi<TornadoEntry[]>(`/corporate/diagnostic/${requestedSnapshot?.ticker ?? ticker}/tornado`, { signal }),
        staleTime: 1000 * 60 * 60, 
        enabled: Boolean(requestedSnapshot && refreshToken),
    });
    const cachedForTicker = cachedDiagnostics?.snapshot.ticker === ticker ? cachedDiagnostics : null;
    const displayRadarData = radarData ?? cachedForTicker?.radarData ?? null;
    const displayTornadoData = tornadoData ?? cachedForTicker?.tornadoData ?? null;
    const displayLastUpdatedAt = (radarData || tornadoData) ? new Date().toISOString() : cachedForTicker?.lastUpdatedAt ?? null;
    const isRefreshing = radarLoading || tornadoLoading;

    useEffect(() => {
        if (!radarData || !tornadoData || !requestedSnapshot) return;
        writeSessionCache(DIAGNOSTIC_WORKBENCH_CACHE_KEY, {
            snapshot: requestedSnapshot,
            radarData,
            tornadoData,
            lastUpdatedAt: new Date().toISOString(),
        } satisfies DiagnosticCache);
    }, [radarData, requestedSnapshot, tornadoData]);

    const handleRefresh = () => {
        setRequestedSnapshot({ ticker });
        setRefreshToken(`${Date.now()}`);
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            <div className="md:col-span-2 flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">Corporate Diagnostics</h2>
                    <p className="mt-1 text-sm text-[var(--text-muted)]">
                        Radar and tornado diagnostics now stay idle on first load and refresh only when you request them.
                    </p>
                </div>
                <div className="flex flex-col items-start gap-2 text-xs text-[var(--text-muted)] sm:items-end">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={isRefreshing}
                        className="inline-flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 font-semibold text-[var(--text-primary)] disabled:opacity-60"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                        Refresh Diagnostics
                    </button>
                    <span>{formatDateTime(displayLastUpdatedAt)}</span>
                </div>
            </div>

            {!displayRadarData && !displayTornadoData && !isRefreshing ? (
                <div className="md:col-span-2 rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-[var(--surface-muted)] px-4 py-6 text-sm text-[var(--text-muted)]">
                    Diagnostics stay idle on first load. Click `Refresh Diagnostics` when you want the latest radar and tornado views.
                </div>
            ) : null}

            <div className="relative">
                {radarLoading && (
                    <div className="absolute inset-0 z-10 rounded-[var(--radius)] bg-[var(--bg-surface)]">
                        <LoadingState variant="skeleton" label="Loading radar diagnostics..." />
                    </div>
                )}
                {radarError && !displayRadarData ? (
                    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                        <ErrorState title="Radar Diagnostics Unavailable" message="Refresh diagnostics to retry the strategic positioning radar." />
                    </div>
                ) : (
                    <DiagnosticRadar data={displayRadarData ?? []} />
                )}
            </div>

            <div className="relative">
                {tornadoLoading && (
                    <div className="absolute inset-0 z-10 rounded-[var(--radius)] bg-[var(--bg-surface)]">
                        <LoadingState variant="skeleton" label="Loading tornado diagnostics..." />
                    </div>
                )}
                {tornadoError && !displayTornadoData ? (
                    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
                        <ErrorState title="Tornado Diagnostics Unavailable" message="Refresh diagnostics to retry the sensitivity bounds chart." />
                    </div>
                ) : (
                    <TornadoChart data={displayTornadoData ?? []} />
                )}
            </div>
        </div>
    );
};
