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
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // Auto-refresh is off by default: this page inspects a specific run, and
  // background repolling would churn the ring buffer mid-analysis.
  const common = { refetchOnWindowFocus: false, refetchInterval: false as const };

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

  if (requestsQuery.isLoading) return <LoadingState />;

  if (isNotFoundError(requestsQuery.error)) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <PageHeader title="Performance Analysis" subtitle="Where time is spent" />
        <EmptyState
          title="Instrumentation disabled"
          description="Set MONEYVIEW_DEV_MONITOR=true and restart the API server."
        />
      </div>
    );
  }

  if (requestsQuery.error) {
    return (
      <ErrorState
        message="Failed to load performance data."
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
      <PageHeader title="Performance Analysis" subtitle="Where time is spent" />

      <div className="flex items-center gap-3" data-testid="buffer-status">
        <ActionButton label="Refresh" onClick={refreshAll} />
        <span className="text-xs text-[var(--text-muted)]">
          buffer {index?.buffer_used ?? 0} / {index?.buffer_limit ?? 0}
        </span>
        {bufferFull ? (
          <StatusBadge status="stale" label="buffer full — older events evicted" />
        ) : null}
      </div>

      {index && index.requests.length === 0 ? (
        <EmptyState
          title="No requests recorded yet"
          description="Exercise the app, then refresh."
        />
      ) : null}

      <Card>
        <SectionHeader title="Requests" />
        <DenseTable<RequestSummaryRow>
          columns={[
            { key: "route", header: "route", render: (_value, row) => row.route ?? "-" },
            { key: "total_ms", header: "total_ms", render: (_value, row) => (row.total_ms ?? 0).toFixed(1) },
            { key: "span_count", header: "spans" },
            { key: "ticker_count", header: "tickers" },
            {
              key: "partial",
              header: "state",
              render: (_value, row) =>
                row.partial ? <StatusBadge status="stale" label="partial" /> : "ok",
            },
          ]}
          data={index?.requests ?? []}
          onRowClick={(row) => setSelectedRequestId(row.request_id)}
        />
      </Card>

      <Card>
        <SectionHeader title="Scope breakdown" />
        {breakdownQuery.data ? (
          <div className="space-y-1" data-testid="scope-breakdown">
            {breakdownQuery.data.scopes.map((scope) => (
              <div key={scope.scope} className="flex items-center gap-2 text-xs">
                <span className="w-28">{scope.scope}</span>
                <span className="tabular-nums">{scope.self_ms.toFixed(1)} ms</span>
                <span className="tabular-nums text-[var(--text-muted)]">{scope.pct_of_total}%</span>
              </div>
            ))}
            <div className="text-xs text-[var(--text-muted)]">
              unattributed {breakdownQuery.data.unattributed_ms.toFixed(1)} ms
              {breakdownQuery.data.overlap_detected
                ? " — spans overlapped (concurrent execution)"
                : ""}
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="Waterfall" />
        {waterfallQuery.data ? (
          <div data-testid="waterfall-panel">
            <div className="flex gap-2 mb-2">
              {waterfallQuery.data.partial ? (
                <StatusBadge status="stale" label="partial — some spans evicted" />
              ) : null}
              {waterfallQuery.data.truncated ? (
                <span className="text-xs text-[var(--text-muted)]">truncated at 2,000 spans</span>
              ) : null}
            </div>
            <SpanWaterfall
              root={waterfallQuery.data.root}
              totalMs={waterfallQuery.data.total_ms ?? 0}
            />
          </div>
        ) : (
          <EmptyState title="Select a request" description="Pick a row above to inspect its shape." />
        )}
      </Card>

      <Card>
        <SectionHeader title="Per-stock cost" />
        {tickerQuery.data ? (
          <div data-testid="per-stock-panel">
            <div className="text-xs mb-1">
              {tickerQuery.data.ticker_count} tickers · {tickerQuery.data.total_self_ms.toFixed(1)} ms total
              {" · "}
              <strong>{tickerQuery.data.distribution}</strong> (cv {tickerQuery.data.cv})
            </div>
            <div className="text-xs text-[var(--text-muted)] mb-2">
              p50 {tickerQuery.data.p50_ms} ms · p95 {tickerQuery.data.p95_ms} ms · max {tickerQuery.data.max_ms} ms
            </div>
            <details>
              <summary className="text-xs cursor-pointer">Full table</summary>
              <DenseTable<TickerCostRow>
                columns={[
                  { key: "ticker", header: "ticker" },
                  { key: "self_ms", header: "self_ms", render: (_value, row) => row.self_ms.toFixed(1) },
                  { key: "db_ms", header: "db_ms", render: (_value, row) => row.db_ms.toFixed(1) },
                  { key: "rows_read", header: "rows" },
                ]}
                data={tickerQuery.data.rows}
              />
            </details>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionHeader title="Cache effectiveness" />
        <DenseTable<CacheRow>
          columns={[
            { key: "component", header: "component" },
            { key: "hits", header: "hits" },
            { key: "misses", header: "misses" },
            { key: "hit_rate", header: "rate", render: (_value, row) => `${(row.hit_rate * 100).toFixed(0)}%` },
            { key: "avg_miss_cost_ms", header: "avg miss" },
            { key: "estimated_time_saved_ms", header: "saved (est)" },
          ]}
          data={cacheQuery.data?.caches ?? []}
        />
      </Card>
    </div>
  );
}
