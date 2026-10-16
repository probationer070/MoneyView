"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { DenseTable } from "@/components/ui/DenseTable";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ActionButton } from "@/components/ui/ActionButton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { LoadingState } from "@/components/ui/LoadingState";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import {
  fetchPerformanceByTicker,
  fetchPerformanceBreakdown,
  fetchPerformanceCache,
  fetchPerformanceRequests,
  fetchPerformanceWaterfall,
  type RequestSummaryRow,
  type TickerCostRow,
  type CacheRow,
} from "@/lib/devMonitor";
import { SpanWaterfall } from "./SpanWaterfall";

function isNotFoundError(error: unknown) {
  return error instanceof Error && error.message.includes("404");
}

export default function PerformanceAnalysisPage() {
  const t = useT();
  const { locale } = useLocale();
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // Auto-refresh is off by default: this page inspects a specific run, and
  // background repolling would churn the ring buffer mid-analysis.
  //
  // retry overrides the app-wide `retry: 3`. When the backend runs without
  // MONEYVIEW_DEV_MONITOR the gate returns 404 deterministically, so retrying
  // costs three round trips plus exponential backoff -- about seven seconds of
  // blank page before the "instrumentation disabled" message can appear. That
  // delay is what makes these dashboards look broken rather than switched off.
  const common = {
    refetchOnWindowFocus: false,
    refetchInterval: false as const,
    retry: (failureCount: number, error: unknown) =>
      !isNotFoundError(error) && failureCount < 3,
  };

  const requestsQuery = useQuery({
    queryKey: ["perf-requests"],
    queryFn: () => fetchPerformanceRequests(50),
    ...common,
  });
  const waterfallQuery = useQuery({
    queryKey: ["perf-waterfall", selectedRequestId],
    queryFn: () => fetchPerformanceWaterfall(selectedRequestId as string),
    enabled: Boolean(selectedRequestId),
    ...common,
  });
  const breakdownQuery = useQuery({
    queryKey: ["perf-breakdown", selectedRequestId],
    queryFn: () => fetchPerformanceBreakdown(selectedRequestId ?? undefined),
    ...common,
  });
  const tickerQuery = useQuery({
    queryKey: ["perf-by-ticker", selectedRequestId],
    queryFn: () => fetchPerformanceByTicker({ requestId: selectedRequestId ?? undefined }),
    ...common,
  });
  const cacheQuery = useQuery({
    queryKey: ["perf-cache"],
    queryFn: () => fetchPerformanceCache(300),
    ...common,
  });

  // Rendered inside the page shell rather than bare: a bare skeleton is a few
  // near-invisible grey bars at the top of an empty viewport, which reads as a
  // page that failed rather than one that is still loading.
  if (requestsQuery.isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PageHeader title={t("devPerformance.title")} subtitle={t("devPerformance.subtitle")} />
        <LoadingState variant="spinner" label={t("devPerformance.loading")} />
      </div>
    );
  }

  if (isNotFoundError(requestsQuery.error)) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PageHeader title={t("devPerformance.title")} subtitle={t("devPerformance.subtitle")} />
        <EmptyState
          title={t("devPerformance.disabledTitle")}
          description={t("devPerformance.disabledDescription")}
        />
      </div>
    );
  }

  if (requestsQuery.error) {
    return (
      <ErrorState
        message={t("devPerformance.loadFailed")}
        retryAction={() => requestsQuery.refetch()}
      />
    );
  }

  const index = requestsQuery.data;
  const bufferFull = Boolean(index && index.buffer_used >= index.buffer_limit);

  const refreshAll = () => {
    void requestsQuery.refetch();
    void waterfallQuery.refetch();
    void breakdownQuery.refetch();
    void tickerQuery.refetch();
    void cacheQuery.refetch();
  };

  const count = (value: number) => formatNumber(value, "integer", { locale });
  const ms = (value: number | null | undefined) => formatNumber(value, "price", { digits: 1, locale });

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <PageHeader title={t("devPerformance.title")} subtitle={t("devPerformance.subtitle")} />

      <div className="flex items-center gap-3" data-testid="buffer-status">
        <ActionButton label={t("devPerformance.refresh")} onClick={refreshAll} />
        <span className="type-small text-[var(--ink-muted)]">
          {t("devPerformance.buffer", { used: count(index?.buffer_used ?? 0), limit: count(index?.buffer_limit ?? 0) })}
        </span>
        {bufferFull ? (
          <StatusBadge status="stale" label={t("devPerformance.bufferFull")} />
        ) : null}
      </div>

      {index && index.requests.length === 0 ? (
        <EmptyState
          title={t("devPerformance.noRequestsTitle")}
          description={t("devPerformance.noRequestsDescription")}
        />
      ) : null}

      <Card>
        <SectionHeader title={t("devPerformance.requests")} />
        <DenseTable<RequestSummaryRow>
          columns={[
            { key: "route", label: "route", render: (_value, row) => row.route ?? "-" },
            { key: "total_ms", label: "totalMs", render: (_value, row) => ms(row.total_ms ?? 0) },
            { key: "span_count", label: "spans", render: (_value, row) => count(row.span_count) },
            { key: "ticker_count", label: "tickers", render: (_value, row) => count(row.ticker_count) },
            {
              key: "partial",
              label: "state",
              render: (_value, row) =>
                row.partial ? <StatusBadge status="stale" label={t("devPerformance.partial")} /> : t("devPerformance.ok"),
            },
          ]}
          data={index?.requests ?? []}
          onRowClick={(row) => setSelectedRequestId(row.request_id)}
        />
      </Card>

      <Card>
        <SectionHeader title={t("devPerformance.scopeBreakdown")} />
        {breakdownQuery.data ? (
          <div className="space-y-1" data-testid="scope-breakdown">
            {breakdownQuery.data.scopes.map((scope) => (
              <div key={scope.scope} className="flex items-center gap-2 type-small">
                <span className="w-28">{scope.scope}</span>
                <span className="type-mono">{ms(scope.self_ms)} ms</span>
                {/* pct_of_total is already a percentage (42.5 = 42.5%), so it is not a fraction for "percent". */}
                <span className="type-mono text-[var(--ink-muted)]">{formatNumber(scope.pct_of_total, "ratio", { digits: 1, locale })}%</span>
              </div>
            ))}
            <div className="type-small text-[var(--ink-muted)]">
              {t("devPerformance.unattributed", { ms: ms(breakdownQuery.data.unattributed_ms) })}
              {breakdownQuery.data.overlap_detected
                ? t("devPerformance.overlapped")
                : ""}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title={t("devPerformance.waterfall")} />
        {waterfallQuery.data ? (
          <div data-testid="waterfall-panel">
            <div className="flex gap-2 mb-2">
              {waterfallQuery.data.partial ? (
                <StatusBadge status="stale" label={t("devPerformance.partialSpans")} />
              ) : null}
              {waterfallQuery.data.truncated ? (
                <span className="type-small text-[var(--ink-muted)]">{t("devPerformance.truncated")}</span>
              ) : null}
            </div>
            <SpanWaterfall
              root={waterfallQuery.data.root}
              totalMs={waterfallQuery.data.total_ms ?? 0}
            />
          </div>
        ) : (
          <EmptyState title={t("devPerformance.selectTitle")} description={t("devPerformance.selectDescription")} />
        )}
      </Card>

      <Card>
        <SectionHeader title={t("devPerformance.perStock")} />
        {tickerQuery.data ? (
          <div data-testid="per-stock-panel">
            <div className="type-small mb-1">
              {t("devPerformance.tickerTotal", { count: count(tickerQuery.data.ticker_count), ms: ms(tickerQuery.data.total_self_ms) })}
              {" · "}
              <strong className="type-label">{tickerQuery.data.distribution}</strong> ({t("devPerformance.cv", { cv: formatNumber(tickerQuery.data.cv, "ratio", { locale }) })})
            </div>
            <div className="type-small text-[var(--ink-muted)] mb-2">
              {t("devPerformance.percentiles", { p50: ms(tickerQuery.data.p50_ms), p95: ms(tickerQuery.data.p95_ms), max: ms(tickerQuery.data.max_ms) })}
            </div>
            <details>
              <summary className="type-small cursor-pointer">{t("devPerformance.fullTable")}</summary>
              <DenseTable<TickerCostRow>
                columns={[
                  { key: "ticker", label: "ticker" },
                  { key: "self_ms", label: "selfMs", render: (_value, row) => ms(row.self_ms) },
                  { key: "db_ms", label: "dbMs", render: (_value, row) => ms(row.db_ms) },
                  { key: "rows_read", label: "rows", render: (_value, row) => count(row.rows_read) },
                ]}
                data={tickerQuery.data.rows}
              />
            </details>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title={t("devPerformance.cacheEffectiveness")} />
        <DenseTable<CacheRow>
          columns={[
            { key: "component", label: "component" },
            { key: "hits", label: "hits", render: (_value, row) => count(row.hits) },
            { key: "misses", label: "misses", render: (_value, row) => count(row.misses) },
            { key: "hit_rate", label: "rate", render: (_value, row) => formatNumber(row.hit_rate, "percent", { digits: 0, locale }) },
            { key: "avg_miss_cost_ms", label: "avgMiss", render: (_value, row) => ms(row.avg_miss_cost_ms) },
            { key: "estimated_time_saved_ms", label: "saved", render: (_value, row) => ms(row.estimated_time_saved_ms) },
          ]}
          data={cacheQuery.data?.caches ?? []}
        />
      </Card>
    </div>
  );
}
