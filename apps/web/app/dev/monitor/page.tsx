"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Download, Pause, Play, RefreshCw, RotateCw, ShieldAlert, Timer, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { ActionButton } from "@/components/ui/ActionButton";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { fieldInputClass } from "@/components/ui/InlineField";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { FilterBar } from "@/components/ui/FilterBar";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatNumber, type FormatLocale } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
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

function formatDuration(value: number | null | undefined, locale: FormatLocale) {
  if (value == null) return "—";
  return `${formatNumber(value, "price", { digits: 1, locale })} ms`;
}

function formatTimestamp(value: string, locale: FormatLocale) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString(locale === "ko" ? "ko-KR" : "en-US");
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
  if (level === "error") return "text-[var(--status-error-ink)]";
  if (level === "warn") return "text-[var(--status-warning-ink)]";
  if (level === "debug") return "text-[var(--ink-muted)]";
  return "text-[var(--ink)]";
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
    <Card className="min-h-[132px]">
      <div className="flex h-full flex-col justify-between gap-4">
        <div className="type-caption uppercase text-[var(--ink-muted)]">
          {label}
        </div>
        <div>
          <div className="type-figure-md text-[var(--ink)]">
            {value}
          </div>
          <div className="mt-2 type-small text-[var(--ink-secondary)]">
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
        <h2 className="type-panel-title text-[var(--ink)]">{title}</h2>
        <p className="mt-1 type-body text-[var(--ink-secondary)]">{description}</p>
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
  const { locale } = useLocale();
  return (
    <div className="grid gap-2 border border-[var(--line)] bg-[var(--surface-raised)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="overflow-inline-ellipsis type-label text-[var(--ink)]">{label}</div>
          <div className="mt-1 overflow-inline-ellipsis type-small text-[var(--ink-muted)]">{sublabel}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="type-mono text-[var(--ink)]">{formatDuration(durationMs, locale)}</div>
          <div className="mt-1">{status}</div>
        </div>
      </div>
      {/* rounded-full: track */}
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface)]">
        {/* rounded-full: fill */}
        <div
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width }}
        />
      </div>
    </div>
  );
}

export default function DevMonitorPage() {
  const t = useT();
  const { locale } = useLocale();
  const count = (value: number) => formatNumber(value, "integer", { locale });
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

  const metricPanelGroups = useMemo(() => {
    const definitions = [
      { key: "roic", label: t("devMonitor.metricTiming.groups.roic"), matches: ["roic"] },
      { key: "wacc", label: t("devMonitor.metricTiming.groups.wacc"), matches: ["wacc"] },
      { key: "dcf", label: t("devMonitor.metricTiming.groups.dcf"), matches: ["dcf"] },
      { key: "attribution", label: t("devMonitor.metricTiming.groups.attribution"), matches: ["attribution"] },
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
  }, [durationEvents, visibleEvents, t]);

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
          eyebrow={{ label: "devRuntime" }}
          title={t("devMonitor.title")}
          subtitle={t("devMonitor.subtitleShell")}
        />
        <LoadingState variant="skeleton" />
      </div>
    );
  }

  if (monitorUnavailable) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in duration-500">
        <PageHeader
          eyebrow={{ label: "devRuntime" }}
          title={t("devMonitor.title")}
          subtitle={t("devMonitor.subtitleLocal")}
        />
        <EmptyState
          icon={<ShieldAlert className="h-6 w-6" />}
          title={t("devMonitor.disabledTitle")}
          description={t("devMonitor.disabledDescription")}
        />
      </div>
    );
  }

  if (recentQuery.isError && !monitorUnavailable) {
    return (
      <div className="mx-auto max-w-5xl space-y-8 animate-in fade-in duration-500">
        <PageHeader
          eyebrow={{ label: "devRuntime" }}
          title={t("devMonitor.title")}
          subtitle={t("devMonitor.subtitleShell")}
        />
        <ErrorState
          title={t("devMonitor.shellErrorTitle")}
          message={recentQuery.error instanceof Error ? recentQuery.error.message : t("devMonitor.shellErrorFallback")}
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
        eyebrow={{ label: "devRuntime" }}
        title={t("devMonitor.title")}
        subtitle={t("devMonitor.subtitleLive")}
        actions={(
          <>
            <StatusBadge status={connectionBadgeState(connectionState)} label={connectionState} />
            <ActionButton
              label={isPaused ? t("devMonitor.resume") : t("devMonitor.pause")}
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
              label={t("devMonitor.clear")}
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={clear}
            />
            <ActionButton
              label={t("devMonitor.exportJsonl")}
              size="sm"
              icon={<Download className="h-3.5 w-3.5" />}
              disabled={visibleEvents.length === 0}
              onClick={() => exportEventsAsJsonl(visibleEvents)}
            />
            <ActionButton
              label={t("devMonitor.refreshSummary")}
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
        <KpiCard label={t("devMonitor.kpi.activeRequests")} value={count(summary.active_requests)} detail={t("devMonitor.kpi.activeRequestsDetail")} />
        <KpiCard label={t("devMonitor.kpi.avgLatency")} value={formatDuration(summary.avg_api_latency_ms, locale)} detail={t("devMonitor.kpi.avgLatencyDetail")} />
        <KpiCard label={t("devMonitor.kpi.p95Latency")} value={formatDuration(summary.p95_api_latency_ms, locale)} detail={t("devMonitor.kpi.p95LatencyDetail")} />
        <KpiCard label={t("devMonitor.kpi.slowOperations")} value={count(summary.slow_operations)} detail={t("devMonitor.kpi.slowOperationsDetail")} />
        <KpiCard label={t("devMonitor.kpi.errors")} value={count(summary.errors)} detail={t("devMonitor.kpi.errorsDetail")} />
        <KpiCard label={t("devMonitor.kpi.cacheHitRate")} value={formatNumber(summary.cache_hit_rate, "percent", { digits: 1, locale })} detail={t("devMonitor.kpi.cacheHitRateDetail")} />
      </section>

      <FilterBar className="items-end">
        <label className="flex min-w-[11rem] flex-1 flex-col gap-2 type-small text-[var(--ink-muted)]">
          {t("devMonitor.filters.scope")}
          <select
            value={scopeFilter}
            onChange={(event) => setScopeFilter(event.target.value)}
            className={fieldInputClass}
          >
            <option value="all">{t("devMonitor.filters.allScopes")}</option>
            {availableScopes.map((scope) => (
              <option key={scope} value={scope}>
                {scope}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-2 type-small text-[var(--ink-muted)]">
          {t("devMonitor.filters.ticker")}
          <input
            value={tickerFilter}
            onChange={(event) => setTickerFilter(event.target.value)}
            placeholder="AAPL"
            className={fieldInputClass}
          />
        </label>
        <label className="flex min-w-[14rem] flex-[1.2] flex-col gap-2 type-small text-[var(--ink-muted)]">
          {t("devMonitor.filters.route")}
          <input
            value={routeFilter}
            onChange={(event) => setRouteFilter(event.target.value)}
            placeholder="/api/v1/portfolio"
            className={fieldInputClass}
          />
        </label>
        <label className="flex min-w-[16rem] flex-[1.4] flex-col gap-2 type-small text-[var(--ink-muted)]">
          {t("devMonitor.filters.operation")}
          <input
            value={operationSearch}
            onChange={(event) => setOperationSearch(event.target.value)}
            placeholder="request_complete"
            className={fieldInputClass}
          />
        </label>
        <label className="flex items-center gap-2 type-body text-[var(--ink)]">
          <input type="checkbox" checked={slowOnly} onChange={(event) => setSlowOnly(event.target.checked)} />
          {t("devMonitor.filters.slowOnly")}
        </label>
        <label className="flex items-center gap-2 type-body text-[var(--ink)]">
          <input type="checkbox" checked={errorOnly} onChange={(event) => setErrorOnly(event.target.checked)} />
          {t("devMonitor.filters.errorOnly")}
        </label>
      </FilterBar>

      {errorMessage ? (
        <Card className="border-[var(--status-warning-border)] bg-[var(--status-warning-surface)]">
          <div className="flex items-start gap-3">
            <Activity className="mt-0.5 h-4 w-4 text-[var(--status-warning-ink)]" />
            <div>
              <div className="type-label text-[var(--ink)]">{t("devMonitor.streamStatus")}</div>
              <div className="mt-1 type-body text-[var(--ink-secondary)]">{errorMessage}</div>
            </div>
          </div>
        </Card>
      ) : null}

      {connectionState === "reconnecting" ? (
        <Card className="border-[var(--brand)] bg-[var(--brand-soft)]">
          <div className="flex items-start gap-3">
            <RotateCw className="mt-0.5 h-4 w-4 animate-spin text-[var(--brand-text)]" />
            <div>
              <div className="type-label text-[var(--ink)]">{t("devMonitor.reconnectingTitle")}</div>
              <div className="mt-1 type-body text-[var(--ink-secondary)]">
                {t("devMonitor.reconnectingBody")}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {isPaused ? (
        <Card className="border-[var(--line)] bg-[var(--surface)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="type-label text-[var(--ink)]">{t("devMonitor.pausedTitle")}</div>
              <div className="mt-1 type-body text-[var(--ink-secondary)]">
                {t("devMonitor.pausedBody")}
              </div>
            </div>
            <ActionButton
              label={t("devMonitor.resumeLiveStream")}
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
            title={t("devMonitor.operationLatency.title")}
            description={t("devMonitor.operationLatency.description")}
          />
          {recentLatencyEvents.length === 0 ? (
            <EmptyState
              icon={<Timer className="h-6 w-6" />}
              title={t("devMonitor.operationLatency.emptyTitle")}
              description={t("devMonitor.operationLatency.emptyDescription")}
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
            title={t("devMonitor.tickerLatency.title")}
            description={t("devMonitor.tickerLatency.description")}
          />
          {fetchLatencyEvents.length === 0 ? (
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title={t("devMonitor.tickerLatency.emptyTitle")}
              description={t("devMonitor.tickerLatency.emptyDescription")}
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

      <section className="grid grid-cols-1 gap-6">
        <Card padding="lg">
          <SectionTitle
            title={t("devMonitor.metricTiming.title")}
            description={t("devMonitor.metricTiming.description")}
          />
          <div className="grid gap-3">
            {metricPanelGroups.map((group) => (
              <div key={group.key} className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="type-label text-[var(--ink)]">{group.label}</div>
                    <div className="mt-1 type-small text-[var(--ink-muted)]">
                      {group.latestEvent ? `${group.latestEvent.operation} · ${group.latestEvent.component ?? group.latestEvent.scope}` : t("devMonitor.metricTiming.noEvent")}
                    </div>
                  </div>
                  {group.latestEvent ? (
                    <StatusBadge status={statusBadgeVariant(group.latestEvent)} label={group.latestEvent.status} />
                  ) : (
                    <StatusBadge status="idle" label={t("devMonitor.metricTiming.idle")} />
                  )}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 type-body">
                  <div className="bg-[var(--surface)] px-3 py-2">
                    <div className="type-small text-[var(--ink-muted)]">{t("devMonitor.metricTiming.latestDuration")}</div>
                    <div className="mt-1 type-mono text-[var(--ink)]">
                      {formatDuration(group.latestEvent?.duration_ms, locale)}
                    </div>
                  </div>
                  <div className="bg-[var(--surface)] px-3 py-2">
                    <div className="type-small text-[var(--ink-muted)]">{t("devMonitor.metricTiming.relatedWarnings")}</div>
                    <div className="mt-1 type-mono text-[var(--ink)]">
                      {count(group.warnings.length)}
                    </div>
                  </div>
                </div>
                {group.warnings.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.warnings.slice(0, 3).map((warning) => (
                      <span
                        key={warning.id}
                        className="inline-flex items-center gap-1 rounded-[var(--radius-2)] bg-[var(--status-warning-surface)] px-2.5 py-1 type-small text-[var(--status-warning-ink)]"
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
            title={t("devMonitor.dataQuality.title")}
            description={t("devMonitor.dataQuality.description")}
          />
          {dataQualityWarnings.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle className="h-6 w-6" />}
              title={t("devMonitor.dataQuality.emptyTitle")}
              description={t("devMonitor.dataQuality.emptyDescription")}
            />
          ) : (
            <div className="space-y-3">
              {dataQualityWarnings.map((event) => {
                const auditLink = stringMetadata(event, "audit_link");
                return (
                  <div key={event.id} className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="type-label text-[var(--ink)]">
                          {event.ticker ?? "-"} · {metricLabel(event)}
                        </div>
                        <div className="mt-1 type-small text-[var(--ink-muted)]">
                          {event.warning_code ?? t("devMonitor.dataQuality.warning")} · {formatSource(event)}
                        </div>
                      </div>
                      <StatusBadge status="stale" label={event.status} />
                    </div>
                    <p className="mt-3 type-body text-[var(--ink-secondary)]">{event.message ?? t("devMonitor.dataQuality.noMessage")}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 type-small text-[var(--ink-muted)] md:grid-cols-4">
                      <div>
                        <div>{t("devMonitor.dataQuality.timestamp")}</div>
                        <div className="mt-1 type-mono text-[var(--ink)]">{formatTimestamp(event.timestamp, locale)}</div>
                      </div>
                      <div>
                        <div>{t("devMonitor.dataQuality.requestId")}</div>
                        <div className="mt-1 type-mono overflow-inline-ellipsis text-[var(--ink)]">{event.request_id ?? "-"}</div>
                      </div>
                      <div>
                        <div>{t("devMonitor.dataQuality.source")}</div>
                        <div className="mt-1 text-[var(--ink)]">{formatSource(event)}</div>
                      </div>
                      <div>
                        <div>{t("devMonitor.dataQuality.auditLink")}</div>
                        <div className="mt-1 text-[var(--ink)]">
                          {auditLink ? (
                            <a href={auditLink} className="text-[var(--brand-text)] underline decoration-dotted underline-offset-4">
                              {t("devMonitor.dataQuality.open")}
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
            title={t("devMonitor.slowOperations.title")}
            description={t("devMonitor.slowOperations.description")}
          />
          <div className="mb-4 border border-[var(--line)] bg-[var(--surface)] px-4 py-3 type-small text-[var(--ink-secondary)]">
            {t("devMonitor.slowOperations.threshold", {
              apiMs: count(slowThresholdMsForScope("api")),
              dbMs: count(slowThresholdMsForScope("db")),
            })}
          </div>
          {slowQuery.isFetching && !slowQuery.data ? (
            <LoadingState variant="spinner" label={t("devMonitor.slowOperations.loading")} />
          ) : visibleSlowEvents.length === 0 ? (
            <EmptyState
              icon={<Timer className="h-6 w-6" />}
              title={t("devMonitor.slowOperations.emptyTitle")}
              description={t("devMonitor.slowOperations.emptyDescription")}
            />
          ) : (
            <div className="overflow-hidden border border-[var(--line)]">
              <div className="grid grid-cols-[6rem_6rem_minmax(0,1.4fr)_7rem_6rem_6rem] gap-3 bg-[var(--surface)] px-4 py-3 type-caption uppercase text-[var(--ink-muted)]">
                <span><BilingualLabel k="scope" /></span>
                <span><BilingualLabel k="threshold" /></span>
                <span><BilingualLabel k="operation" /></span>
                <span><BilingualLabel k="ticker" /></span>
                <span><BilingualLabel k="duration" /></span>
                <span><BilingualLabel k="status" /></span>
              </div>
              <div className="max-h-[28rem] overflow-y-auto bg-[var(--surface-raised)]">
                {visibleSlowEvents.map((event) => (
                  <div
                    key={event.id}
                    className="grid grid-cols-[6rem_6rem_minmax(0,1.4fr)_7rem_6rem_6rem] gap-3 border-t border-[var(--grid)] px-4 py-3 type-mono text-[var(--ink)]"
                  >
                    <span>{event.scope}</span>
                    <span className="tabular-nums text-[var(--ink-secondary)]">{count(slowThresholdMsForScope(event.scope))} ms</span>
                    <span className="overflow-inline-ellipsis">{event.operation}</span>
                    <span className="overflow-inline-ellipsis text-[var(--ink-secondary)]">{event.ticker ?? "-"}</span>
                    <span className="tabular-nums text-[var(--ink-secondary)]">{formatDuration(event.duration_ms, locale)}</span>
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
            <h2 className="type-panel-title text-[var(--ink)]">
              {t("devMonitor.liveLog.title")}
            </h2>
            <p className="mt-1 type-body text-[var(--ink-secondary)]">
              {t("devMonitor.liveLog.description")}
            </p>
          </div>
          <div className="text-right type-small text-[var(--ink-muted)]">
            <div>{t("devMonitor.liveLog.visible", { count: count(visibleEvents.length) })}</div>
            <div>{t("devMonitor.liveLog.buffered", { count: count(streamedEvents.length) })}</div>
          </div>
        </div>

        {recentQuery.isFetching && streamedEvents.length === 0 ? (
          <LoadingState variant="spinner" label={t("devMonitor.liveLog.loading")} />
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            title={t("devMonitor.liveLog.emptyTitle")}
            description={t("devMonitor.liveLog.emptyDescription")}
          />
        ) : (
          <div className="overflow-hidden border border-[var(--line)]">
            <div className="grid grid-cols-[7rem_5rem_7rem_minmax(0,1.4fr)_6rem_6rem_6rem] gap-3 bg-[var(--surface)] px-4 py-3 type-caption uppercase text-[var(--ink-muted)]">
              <span><BilingualLabel k="time" /></span>
              <span><BilingualLabel k="level" /></span>
              <span><BilingualLabel k="scope" /></span>
              <span><BilingualLabel k="operation" /></span>
              <span><BilingualLabel k="ticker" /></span>
              <span><BilingualLabel k="duration" /></span>
              <span><BilingualLabel k="status" /></span>
            </div>
            <div className="max-h-[40rem] overflow-y-auto bg-[var(--surface-raised)]">
              {visibleEvents.slice().reverse().map((event) => (
                <div
                  key={event.id}
                  className="grid grid-cols-[7rem_5rem_7rem_minmax(0,1.4fr)_6rem_6rem_6rem] gap-3 border-t border-[var(--grid)] px-4 py-3 type-mono text-[var(--ink)]"
                  title={event.message ?? event.operation}
                >
                  <span className="text-[var(--ink-muted)]">{formatTimestamp(event.timestamp, locale)}</span>
                  <span className={levelTone(event.level)}>{event.level}</span>
                  <span className="text-[var(--ink-secondary)]">{event.scope}</span>
                  <span className="overflow-mono-block">{event.operation}</span>
                  <span className="overflow-inline-ellipsis text-[var(--ink-secondary)]">{event.ticker ?? "-"}</span>
                  <span className="tabular-nums text-[var(--ink-secondary)]">{formatDuration(event.duration_ms, locale)}</span>
                  <span className="text-[var(--ink-secondary)]">{event.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
