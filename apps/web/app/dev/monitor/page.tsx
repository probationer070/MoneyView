"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Download, Pause, Play, RefreshCw, RotateCw, ShieldAlert, Timer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ActionButton } from "@/components/ui/ActionButton";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  fetchPerformanceRecent,
  fetchPerformanceSlow,
  fetchPerformanceSummary,
  slowThresholdMsForScope,
  type PerformanceEvent,
  type PerformanceSummary,
} from "@/lib/devMonitor";
import { usePerformanceStream } from "@/hooks/usePerformanceStream";

const INITIAL_RECENT_LIMIT = 200;
const SLOW_EVENT_LIMIT = 100;

function formatDuration(value: number | null | undefined) {
  if (value == null) return "n/a";
  return `${value.toFixed(1)} ms`;
}

function formatTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

function isNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("404");
}

function connectionBadgeState(connectionState: string) {
  if (connectionState === "live") return "live";
  if (connectionState === "paused") return "idle";
  if (connectionState === "connecting" || connectionState === "reconnecting") return "loading";
  return "error";
}

function levelTone(level: PerformanceEvent["level"]) {
  if (level === "error") return "text-[var(--state-error)]";
  if (level === "warn") return "text-[var(--state-warning)]";
  if (level === "debug") return "text-[var(--text-muted)]";
  return "text-[var(--text-primary)]";
}

function statusBadgeVariant(event: PerformanceEvent): "live" | "loading" | "error" | "stale" | "idle" {
  if (event.level === "error" || event.status === "error") return "error";
  if (event.status === "slow" || event.status === "warning") return "stale";
  if (event.status === "start") return "loading";
  if (event.status === "cache_hit" || event.status === "success") return "live";
  return "idle";
}

function durationBarWidth(value: number, ceiling: number) {
  if (!Number.isFinite(value) || ceiling <= 0) return "0%";
  return `${Math.max(8, Math.round((value / ceiling) * 100))}%`;
}

function stringMetadata(event: PerformanceEvent, key: string) {
  const value = event.metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function metricLabel(event: PerformanceEvent) {
  const fromMetadata = stringMetadata(event, "metric");
  if (fromMetadata) return fromMetadata.toUpperCase();
  if (event.operation.startsWith("data_quality.")) return event.operation.replace("data_quality.", "").toUpperCase();
  if (event.operation.startsWith("metric.")) return event.operation.replace("metric.", "").replaceAll("_", " ").toUpperCase();
  if (event.operation.startsWith("calculation.")) return event.operation.replace("calculation.", "").replaceAll("_", " ").toUpperCase();
  return event.operation.toUpperCase();
}

function formatSource(event: PerformanceEvent) {
  return stringMetadata(event, "source_mode") ?? event.provider ?? event.component ?? event.scope;
}

function exportEventsAsJsonl(events: PerformanceEvent[]) {
  const jsonl = `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
  const blob = new Blob([jsonl], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `moneyview-dev-monitor-${Date.now()}.jsonl`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function KpiCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card className="min-h-[132px] bg-[linear-gradient(180deg,var(--bg-surface),var(--surface-muted))]">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="text-[length:var(--type-label)] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {label}
        </div>
        <div>
          <div className="text-[length:var(--type-metric-lg)] font-bold tracking-tight text-[var(--text-primary)]">
            {value}
          </div>
          <div className="mt-2 text-[length:var(--type-helper)] text-[var(--text-secondary)]">
            {detail}
          </div>
        </div>
      </div>
    </Card>
  );
}

function buildSummaryFallback(events: PerformanceEvent[]): PerformanceSummary {
  const apiEvents = events.filter((event) => event.scope === "api" && event.operation === "api.request_complete" && event.duration_ms != null);
  const apiDurations = apiEvents.map((event) => event.duration_ms ?? 0).sort((left, right) => left - right);
  const cacheEvents = events.filter((event) => event.scope === "cache" && (event.status === "cache_hit" || event.status === "cache_miss"));
  const cacheHitRate = cacheEvents.length
    ? cacheEvents.filter((event) => event.status === "cache_hit").length / cacheEvents.length
    : 0;
  const avgLatency = apiDurations.length
    ? apiDurations.reduce((sum, value) => sum + value, 0) / apiDurations.length
    : 0;
  const p95Index = apiDurations.length ? Math.max(0, Math.ceil(apiDurations.length * 0.95) - 1) : 0;

  return {
    active_requests: 0,
    avg_api_latency_ms: avgLatency,
    p95_api_latency_ms: apiDurations[p95Index] ?? 0,
    slow_operations: events.filter((event) => event.status === "slow").length,
    errors: events.filter((event) => event.level === "error" || event.status === "error").length,
    cache_hit_rate: cacheHitRate,
  };
}

function SectionTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[length:var(--type-section-title)] font-bold text-[var(--text-primary)]">{title}</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
      </div>
    </div>
  );
}

function LatencyBarRow({
  label,
  sublabel,
  durationMs,
  status,
  width,
}: {
  label: string;
  sublabel: string;
  durationMs: number;
  status: React.ReactNode;
  width: string;
}) {
  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="overflow-inline-ellipsis text-sm font-semibold text-[var(--text-primary)]">{label}</div>
          <div className="mt-1 overflow-inline-ellipsis text-[length:var(--type-helper)] text-[var(--text-muted)]">{sublabel}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{formatDuration(durationMs)}</div>
          <div className="mt-1">{status}</div>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
        <div
          className="h-full rounded-full bg-[linear-gradient(90deg,var(--state-info),var(--state-warning))]"
          style={{ width }}
        />
      </div>
    </div>
  );
}

export default function DevMonitorPage() {
  const [scopeFilter, setScopeFilter] = useState("all");
  const [tickerFilter, setTickerFilter] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [operationSearch, setOperationSearch] = useState("");
  const [slowOnly, setSlowOnly] = useState(false);
  const [errorOnly, setErrorOnly] = useState(false);

  const deferredTickerFilter = useDeferredValue(tickerFilter);
  const deferredRouteFilter = useDeferredValue(routeFilter);
  const deferredOperationSearch = useDeferredValue(operationSearch);

  const recentQuery = useQuery({
    queryKey: ["dev-monitor", "recent", INITIAL_RECENT_LIMIT],
    queryFn: () => fetchPerformanceRecent(INITIAL_RECENT_LIMIT),
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const monitorUnavailable = isNotFoundError(recentQuery.error);
  const {
    events: streamedEvents,
    connectionState,
    errorMessage,
    isPaused,
    pause,
    resume,
    clear,
  } = usePerformanceStream({
    enabled: !monitorUnavailable,
    seedEvents: recentQuery.data?.events ?? [],
    maxBuffer: 1000,
  });

  const summaryQuery = useQuery({
    queryKey: ["dev-monitor", "summary"],
    queryFn: fetchPerformanceSummary,
    enabled: !monitorUnavailable,
    staleTime: 0,
    retry: false,
    refetchInterval: isPaused ? false : 3000,
    refetchOnWindowFocus: false,
  });

  const slowQuery = useQuery({
    queryKey: ["dev-monitor", "slow", SLOW_EVENT_LIMIT],
    queryFn: () => fetchPerformanceSlow(SLOW_EVENT_LIMIT),
    enabled: !monitorUnavailable,
    staleTime: 0,
    retry: false,
    refetchInterval: isPaused ? false : 5000,
    refetchOnWindowFocus: false,
  });

  const visibleEvents = useMemo(() => {
    const tickerNeedle = deferredTickerFilter.trim().toUpperCase();
    const routeNeedle = deferredRouteFilter.trim().toLowerCase();
    const operationNeedle = deferredOperationSearch.trim().toLowerCase();

    return streamedEvents.filter((event) => {
      if (scopeFilter !== "all" && event.scope !== scopeFilter) return false;
      if (slowOnly && event.status !== "slow") return false;
      if (errorOnly && event.level !== "error" && event.status !== "error") return false;
      if (tickerNeedle && (event.ticker ?? "").toUpperCase().indexOf(tickerNeedle) === -1) return false;
      if (routeNeedle && (event.route ?? "").toLowerCase().indexOf(routeNeedle) === -1) return false;
      if (operationNeedle) {
        const haystack = `${event.operation} ${event.message ?? ""}`.toLowerCase();
        if (!haystack.includes(operationNeedle)) return false;
      }
      return true;
    });
  }, [deferredOperationSearch, deferredRouteFilter, deferredTickerFilter, errorOnly, scopeFilter, slowOnly, streamedEvents]);

  const availableScopes = useMemo(
    () => Array.from(new Set(streamedEvents.map((event) => event.scope))).sort(),
    [streamedEvents]
  );

  const durationEvents = useMemo(
    () => visibleEvents.filter((event) => event.duration_ms != null && event.status !== "start"),
    [visibleEvents]
  );

  const recentLatencyEvents = useMemo(
    () => durationEvents.slice(-8).reverse(),
    [durationEvents]
  );

  const recentLatencyMax = useMemo(
    () => Math.max(1, ...recentLatencyEvents.map((event) => event.duration_ms ?? 0)),
    [recentLatencyEvents]
  );

  const fetchLatencyEvents = useMemo(() => {
    return durationEvents
      .filter((event) => event.ticker && (event.scope === "external" || event.scope === "cache"))
      .slice(-8)
      .reverse();
  }, [durationEvents]);

  const fetchLatencyMax = useMemo(
    () => Math.max(1, ...fetchLatencyEvents.map((event) => event.duration_ms ?? 0)),
    [fetchLatencyEvents]
  );

  const pageLoadGroups = useMemo(() => {
    const pageRequests = new Map<string, { requestId: string; route: string; component: string; timestamp: string; totalDurationMs: number | null }>();
    for (const event of visibleEvents) {
      if (event.scope !== "page_load" || !event.request_id || event.status === "start") continue;
      const current = pageRequests.get(event.request_id);
      if (!current || new Date(event.timestamp).getTime() > new Date(current.timestamp).getTime()) {
        pageRequests.set(event.request_id, {
          requestId: event.request_id,
          route: event.route ?? "unknown route",
          component: event.component ?? stringMetadata(event, "request_group") ?? "page",
          timestamp: event.timestamp,
          totalDurationMs: event.duration_ms ?? null,
        });
      }
    }

    return Array.from(pageRequests.values())
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 6)
      .map((pageRequest) => {
        const steps = visibleEvents
          .filter((event) => event.request_id === pageRequest.requestId && event.duration_ms != null && event.status !== "start")
          .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
          .slice(-6);
        return {
          ...pageRequest,
          steps,
          maxStepDurationMs: Math.max(1, ...steps.map((event) => event.duration_ms ?? 0)),
        };
      });
  }, [visibleEvents]);

  const metricPanelGroups = useMemo(() => {
    const definitions = [
      { key: "roic", label: "ROIC", matches: ["roic"] },
      { key: "wacc", label: "WACC", matches: ["wacc"] },
      { key: "dcf", label: "DCF", matches: ["dcf"] },
      { key: "attribution", label: "Attribution", matches: ["attribution"] },
    ] as const;

    return definitions.map((definition) => {
      const relatedEvents = durationEvents.filter((event) => {
        const haystack = `${event.operation} ${event.component ?? ""} ${stringMetadata(event, "metric") ?? ""}`.toLowerCase();
        return definition.matches.some((match) => haystack.includes(match));
      });
      const latestEvent = relatedEvents.at(-1) ?? null;
      const warnings = visibleEvents.filter((event) => {
        if (event.scope !== "data_quality") return false;
        const haystack = `${event.operation} ${event.component ?? ""} ${stringMetadata(event, "metric") ?? ""}`.toLowerCase();
        return definition.matches.some((match) => haystack.includes(match));
      });
      return {
        key: definition.key,
        label: definition.label,
        latestEvent,
        warnings,
      };
    });
  }, [durationEvents, visibleEvents]);

  const dataQualityWarnings = useMemo(() => {
    return visibleEvents
      .filter((event) => event.scope === "data_quality")
      .slice()
      .reverse()
      .slice(0, 10);
  }, [visibleEvents]);

  const visibleSlowEvents = useMemo(() => {
    const slowEvents = slowQuery.data?.events ?? [];
    const tickerNeedle = deferredTickerFilter.trim().toUpperCase();
    const routeNeedle = deferredRouteFilter.trim().toLowerCase();
    const operationNeedle = deferredOperationSearch.trim().toLowerCase();
    return slowEvents.filter((event) => {
      if (scopeFilter !== "all" && event.scope !== scopeFilter) return false;
      if (errorOnly && event.level !== "error" && event.status !== "error") return false;
      if (tickerNeedle && (event.ticker ?? "").toUpperCase().indexOf(tickerNeedle) === -1) return false;
      if (routeNeedle && (event.route ?? "").toLowerCase().indexOf(routeNeedle) === -1) return false;
      if (operationNeedle) {
        const haystack = `${event.operation} ${event.message ?? ""}`.toLowerCase();
        if (!haystack.includes(operationNeedle)) return false;
      }
      return true;
    });
  }, [deferredOperationSearch, deferredRouteFilter, deferredTickerFilter, errorOnly, scopeFilter, slowQuery.data?.events]);

  const summary = summaryQuery.data ?? buildSummaryFallback(streamedEvents);

  if (recentQuery.isLoading && !recentQuery.data) {
    return (
      <div className="mx-auto max-w-7xl space-y-8 animate-in fade-in duration-500">
        <PageHeader
          eyebrow="Developer Runtime"
          title="Dev Monitor"
          subtitle="Local event stream, performance counters, and backend activity for MoneyView development."
        />
        <LoadingState variant="skeleton" />
      </div>
    );
  }

  if (monitorUnavailable) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in duration-500">
        <PageHeader
          eyebrow="Developer Runtime"
          title="Dev Monitor"
          subtitle="This page is local-only and appears when backend monitor mode is enabled."
        />
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title="Dev monitor is disabled"
          description="Set MONEYVIEW_DEV_MONITOR=true for the backend, then refresh this page to load the local performance stream."
        />
      </div>
    );
  }

  if (recentQuery.isError && !monitorUnavailable) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in duration-500">
        <PageHeader
          eyebrow="Developer Runtime"
          title="Dev Monitor"
          subtitle="Local event stream, performance counters, and backend activity for MoneyView development."
        />
        <ErrorState
          title="Monitor shell unavailable"
          message={recentQuery.error instanceof Error ? recentQuery.error.message : "Could not load the recent dev-monitor events."}
          retryAction={() => {
            void recentQuery.refetch();
            void summaryQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 animate-in fade-in duration-500">
      <PageHeader
        eyebrow="Developer Runtime"
        title="Dev Monitor"
        subtitle="Local-only event observability for API requests, cache decisions, provider timing, and calculation flow."
        actions={(
          <>
            <StatusBadge status={connectionBadgeState(connectionState)} label={connectionState} />
            <ActionButton
              label={isPaused ? "Resume" : "Pause"}
              size="sm"
              icon={isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              onClick={() => {
                if (isPaused) {
                  resume();
                  return;
                }
                pause();
              }}
            />
            <ActionButton
              label="Clear"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={clear}
            />
            <ActionButton
              label="Export JSONL"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              disabled={visibleEvents.length === 0}
              onClick={() => exportEventsAsJsonl(visibleEvents)}
            />
            <ActionButton
              label="Refresh Summary"
              size="sm"
              loading={summaryQuery.isFetching}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={() => {
                void summaryQuery.refetch();
                void recentQuery.refetch();
                void slowQuery.refetch();
              }}
            />
          </>
        )}
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Active Requests" value={`${summary.active_requests}`} detail="Open API request count observed in the local monitor buffer." />
        <KpiCard label="Avg API Latency" value={formatDuration(summary.avg_api_latency_ms)} detail="Average completion time for recent API request-complete events." />
        <KpiCard label="P95 API Latency" value={formatDuration(summary.p95_api_latency_ms)} detail="High-percentile request latency derived from the recent event window." />
        <KpiCard label="Slow Operations" value={`${summary.slow_operations}`} detail="Monitor events currently classified as slow using backend thresholds." />
        <KpiCard label="Errors" value={`${summary.errors}`} detail="Recent monitor events with error level or error status." />
        <KpiCard label="Cache Hit Rate" value={`${(summary.cache_hit_rate * 100).toFixed(1)}%`} detail="Hit ratio across recent cache hit and miss events in the active buffer." />
      </section>

      <FilterBar className="items-end">
        <label className="flex min-w-[11rem] flex-1 flex-col gap-2 text-[length:var(--type-helper)] text-[var(--text-muted)]">
          Scope
          <select
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          >
            <option value="all">All scopes</option>
            {availableScopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-2 text-[length:var(--type-helper)] text-[var(--text-muted)]">
          Ticker
          <input
            value={tickerFilter}
            onChange={(event) => setTickerFilter(event.target.value)}
            placeholder="AAPL"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[14rem] flex-[1.2] flex-col gap-2 text-[length:var(--type-helper)] text-[var(--text-muted)]">
          Route
          <input
            value={routeFilter}
            onChange={(event) => setRouteFilter(event.target.value)}
            placeholder="/api/v1/portfolio"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex min-w-[16rem] flex-[1.4] flex-col gap-2 text-[length:var(--type-helper)] text-[var(--text-muted)]">
          Operation Search
          <input
            value={operationSearch}
            onChange={(event) => setOperationSearch(event.target.value)}
            placeholder="request_complete"
            className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)]"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input type="checkbox" checked={slowOnly} onChange={(event) => setSlowOnly(event.target.checked)} />
          Slow only
        </label>
        <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]">
          <input type="checkbox" checked={errorOnly} onChange={(event) => setErrorOnly(event.target.checked)} />
          Error only
        </label>
      </FilterBar>

      {errorMessage ? (
        <Card className="border-[var(--state-warning)]/30 bg-[var(--state-warning)]/5">
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-4 w-4 text-[var(--state-warning)]" />
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">Stream status</div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">{errorMessage}</div>
            </div>
          </div>
        </Card>
      ) : null}

      {connectionState === "reconnecting" ? (
        <Card className="border-[var(--state-info)]/30 bg-[var(--state-info)]/5">
          <div className="flex items-start gap-3">
            <RotateCw className="mt-0.5 h-4 w-4 animate-spin text-[var(--state-info)]" />
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">Reconnecting live stream</div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                The local SSE stream dropped and the monitor is retrying automatically. Recent buffered events stay visible while it reconnects.
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {isPaused ? (
        <Card className="border-[var(--border-default)] bg-[var(--surface-muted)]/60">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold text-[var(--text-primary)]">Live updates are paused</div>
              <div className="mt-1 text-sm text-[var(--text-secondary)]">
                Stream reconnects and summary polling are paused until you resume. The current local buffer remains available for filtering and export.
              </div>
            </div>
            <ActionButton
              label="Resume live stream"
              size="sm"
              icon={<Play className="h-3.5 w-3.5" />}
              onClick={resume}
            />
          </div>
        </Card>
      ) : null}

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card padding="lg">
          <SectionTitle
            title="Operation Latency"
            description="Recent instrumented operations with scope, status, and measured duration."
          />
          {recentLatencyEvents.length === 0 ? (
            <EmptyState
              icon={<Timer className="h-6 w-6" />}
              title="No timed operations yet"
              description="Run backend routes with the monitor enabled to populate recent operation duration rows."
            />
          ) : (
            <div className="space-y-3">
              {recentLatencyEvents.map((event) => (
                <LatencyBarRow
                  key={event.id}
                  label={event.operation}
                  sublabel={`${event.scope} · ${event.status}`}
                  durationMs={event.duration_ms ?? 0}
                  status={<StatusBadge status={statusBadgeVariant(event)} label={event.status} />}
                  width={durationBarWidth(event.duration_ms ?? 0, recentLatencyMax)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card padding="lg">
          <SectionTitle
            title="Ticker Fetch Latency"
            description="Recent ticker-scoped cache and provider fetch timings with cache outcome and provider context."
          />
          {fetchLatencyEvents.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No ticker fetches in the current window"
              description="Market and portfolio requests will add cache and provider timing rows here when they carry ticker context."
            />
          ) : (
            <div className="space-y-3">
              {fetchLatencyEvents.map((event) => {
                const providerLabel = event.provider ?? stringMetadata(event, "source") ?? "local";
                const cacheLabel = stringMetadata(event, "cache_status") ?? (event.status === "cache_hit" || event.status === "cache_miss" ? event.status : "n/a");
                return (
                  <LatencyBarRow
                    key={event.id}
                    label={`${event.ticker} · ${event.operation}`}
                    sublabel={`${providerLabel} · cache=${cacheLabel} · ${event.status}`}
                    durationMs={event.duration_ms ?? 0}
                    status={<StatusBadge status={statusBadgeVariant(event)} label={event.scope} />}
                    width={durationBarWidth(event.duration_ms ?? 0, fetchLatencyMax)}
                  />
                );
              })}
            </div>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card padding="lg">
          <SectionTitle
            title="Page-Load Timelines"
            description="Recent request groups reconstructed from page-load monitor events and related timed steps."
          />
          {pageLoadGroups.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No page-load request groups yet"
              description="Open monitor-relevant MoneyView screens to capture grouped request timelines."
            />
          ) : (
            <div className="space-y-4">
              {pageLoadGroups.map((group) => (
                <div key={group.requestId} className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="overflow-inline-ellipsis text-sm font-semibold text-[var(--text-primary)]">
                        {group.component} · {group.route}
                      </div>
                      <div className="mt-1 text-[length:var(--type-helper)] text-[var(--text-muted)]">
                        request {group.requestId} · {formatTimestamp(group.timestamp)}
                      </div>
                    </div>
                    <div className="text-right text-sm text-[var(--text-secondary)]">
                      total {formatDuration(group.totalDurationMs)}
                    </div>
                  </div>
                  <div className="mt-4 space-y-2">
                    {group.steps.map((event) => (
                      <div key={event.id} className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3">
                        <div>
                          <div className="flex items-center justify-between gap-2 text-[length:var(--type-helper)] text-[var(--text-muted)]">
                            <span className="overflow-inline-ellipsis">{event.operation}</span>
                            <span>{event.scope}</span>
                          </div>
                          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--bg-subtle)]">
                            <div
                              className="h-full rounded-full bg-[linear-gradient(90deg,var(--state-info),var(--state-success))]"
                              style={{ width: durationBarWidth(event.duration_ms ?? 0, group.maxStepDurationMs) }}
                            />
                          </div>
                        </div>
                        <div className="text-right text-[length:var(--type-helper)] tabular-nums text-[var(--text-primary)]">
                          {formatDuration(event.duration_ms)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="lg">
          <SectionTitle
            title="Metric Timing"
            description="Latest measured calculation timings for core corporate and portfolio analysis paths."
          />
          <div className="grid gap-3">
            {metricPanelGroups.map((group) => (
              <div key={group.key} className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">{group.label}</div>
                    <div className="mt-1 text-[length:var(--type-helper)] text-[var(--text-muted)]">
                      {group.latestEvent ? `${group.latestEvent.operation} · ${group.latestEvent.component ?? group.latestEvent.scope}` : "No recent timing event"}
                    </div>
                  </div>
                  {group.latestEvent ? (
                    <StatusBadge status={statusBadgeVariant(group.latestEvent)} label={group.latestEvent.status} />
                  ) : (
                    <StatusBadge status="idle" label="idle" />
                  )}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-[length:var(--type-helper)] text-[var(--text-muted)]">Latest Duration</div>
                    <div className="mt-1 font-semibold tabular-nums text-[var(--text-primary)]">
                      {formatDuration(group.latestEvent?.duration_ms)}
                    </div>
                  </div>
                  <div className="rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-3 py-2">
                    <div className="text-[length:var(--type-helper)] text-[var(--text-muted)]">Related Warnings</div>
                    <div className="mt-1 font-semibold text-[var(--text-primary)]">
                      {group.warnings.length}
                    </div>
                  </div>
                </div>
                {group.warnings.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.warnings.slice(0, 3).map((warning) => (
                      <span
                        key={warning.id}
                        className="inline-flex items-center gap-1 rounded-full bg-[var(--state-warning)]/10 px-2.5 py-1 text-[length:var(--type-helper)] text-[var(--state-warning)]"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {warning.warning_code ?? metricLabel(warning)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card padding="lg">
          <SectionTitle
            title="Data-Quality Warnings"
            description="Recent warning events for metric and source-quality issues, including audit-link metadata when present."
          />
          {dataQualityWarnings.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle className="h-6 w-6" />}
              title="No recent data-quality warnings"
              description="When metric audits or source fallbacks raise warnings, they will appear here with request and metric context."
            />
          ) : (
            <div className="space-y-3">
              {dataQualityWarnings.map((event) => {
                const auditLink = stringMetadata(event, "audit_link");
                return (
                  <div key={event.id} className="rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--bg-surface)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-[var(--text-primary)]">
                          {event.ticker ?? "-"} · {metricLabel(event)}
                        </div>
                        <div className="mt-1 text-[length:var(--type-helper)] text-[var(--text-muted)]">
                          {event.warning_code ?? "warning"} · {formatSource(event)}
                        </div>
                      </div>
                      <StatusBadge status="stale" label={event.status} />
                    </div>
                    <p className="mt-3 text-sm text-[var(--text-secondary)]">{event.message ?? "No warning message was provided."}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-[length:var(--type-helper)] text-[var(--text-muted)] md:grid-cols-4">
                      <div>
                        <div>Timestamp</div>
                        <div className="mt-1 text-[var(--text-primary)]">{formatTimestamp(event.timestamp)}</div>
                      </div>
                      <div>
                        <div>Request ID</div>
                        <div className="mt-1 overflow-inline-ellipsis text-[var(--text-primary)]">{event.request_id ?? "-"}</div>
                      </div>
                      <div>
                        <div>Source</div>
                        <div className="mt-1 text-[var(--text-primary)]">{formatSource(event)}</div>
                      </div>
                      <div>
                        <div>Audit Link</div>
                        <div className="mt-1 text-[var(--text-primary)]">
                          {auditLink ? (
                            <a href={auditLink} className="text-[var(--state-info)] underline decoration-dotted underline-offset-4">
                              open
                            </a>
                          ) : (
                            "-"
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card padding="lg">
          <SectionTitle
            title="Slow Operations"
            description="Rows from the backend slow-event endpoint, using the same thresholds as the server classification path."
          />
          <div className="mb-4 rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-muted)] px-4 py-3 text-[length:var(--type-helper)] text-[var(--text-secondary)]">
            API events are slow at {slowThresholdMsForScope("api")} ms or higher. All other scopes are slow at {slowThresholdMsForScope("db")} ms or higher.
          </div>
          {slowQuery.isFetching && !slowQuery.data ? (
            <LoadingState variant="spinner" label="Loading slow operations..." />
          ) : visibleSlowEvents.length === 0 ? (
            <EmptyState
              icon={<Timer className="h-6 w-6" />}
              title="No slow operations in the current result set"
              description="This table reads from the backend slow-event endpoint, so only server-classified slow rows appear here."
            />
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-soft)]">
              <div className="grid grid-cols-[6rem_6rem_minmax(0,1.4fr)_7rem_6rem_6rem] gap-3 bg-[var(--surface-muted)] px-4 py-3 text-[length:var(--type-table-header)] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                <span>Scope</span>
                <span>Threshold</span>
                <span>Operation</span>
                <span>Ticker</span>
                <span>Duration</span>
                <span>Status</span>
              </div>
              <div className="max-h-[28rem] overflow-y-auto bg-[var(--bg-surface)]">
                {visibleSlowEvents.map((event) => (
                  <div
                    key={event.id}
                    className="grid grid-cols-[6rem_6rem_minmax(0,1.4fr)_7rem_6rem_6rem] gap-3 border-t border-[var(--border-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--text-primary)]"
                  >
                    <span>{event.scope}</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">{slowThresholdMsForScope(event.scope)} ms</span>
                    <span className="overflow-inline-ellipsis">{event.operation}</span>
                    <span className="overflow-inline-ellipsis text-[var(--text-secondary)]">{event.ticker ?? "-"}</span>
                    <span className="tabular-nums text-[var(--text-secondary)]">{formatDuration(event.duration_ms)}</span>
                    <span><StatusBadge status={statusBadgeVariant(event)} label={event.status} /></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      </section>

      <Card padding="lg" className="overflow-hidden">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[length:var(--type-section-title)] font-bold text-[var(--text-primary)]">
              Live Log Stream
            </h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Monospace local event rows for request, cache, provider, and calculation activity. No remote telemetry assumptions.
            </p>
          </div>
          <div className="text-right text-[length:var(--type-helper)] text-[var(--text-muted)]">
            <div>{visibleEvents.length} visible</div>
            <div>{streamedEvents.length} buffered</div>
          </div>
        </div>

        {recentQuery.isFetching && streamedEvents.length === 0 ? (
          <LoadingState variant="spinner" label="Loading recent monitor events..." />
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            title="No monitor events match the current filters"
            description="Adjust the scope or search controls, or wait for new local backend events to arrive."
          />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-soft)]">
            <div className="grid grid-cols-[7rem_5rem_7rem_minmax(0,1.4fr)_6rem_6rem_6rem] gap-3 bg-[var(--surface-muted)] px-4 py-3 text-[length:var(--type-table-header)] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              <span>Time</span>
              <span>Level</span>
              <span>Scope</span>
              <span>Operation</span>
              <span>Ticker</span>
              <span>Duration</span>
              <span>Status</span>
            </div>
            <div className="max-h-[40rem] overflow-y-auto bg-[var(--bg-surface)]">
              {visibleEvents.slice().reverse().map((event) => (
                <div
                  key={event.id}
                  className="grid grid-cols-[7rem_5rem_7rem_minmax(0,1.4fr)_6rem_6rem_6rem] gap-3 border-t border-[var(--border-soft)] px-4 py-3 font-mono text-[12px] leading-5 text-[var(--text-primary)]"
                  title={event.message ?? event.operation}
                >
                  <span className="text-[var(--text-muted)]">{formatTimestamp(event.timestamp)}</span>
                  <span className={levelTone(event.level)}>{event.level}</span>
                  <span className="text-[var(--text-secondary)]">{event.scope}</span>
                  <span className="overflow-mono-block">{event.operation}</span>
                  <span className="overflow-inline-ellipsis text-[var(--text-secondary)]">{event.ticker ?? "-"}</span>
                  <span className="tabular-nums text-[var(--text-secondary)]">{formatDuration(event.duration_ms)}</span>
                  <span className="text-[var(--text-secondary)]">{event.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
