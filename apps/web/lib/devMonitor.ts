import { buildApiUrl, fetchApi } from "@/lib/api";

export type DevMonitorLevel = "debug" | "info" | "warn" | "error";
export type DevMonitorScope =
  | "api"
  | "db"
  | "external"
  | "cache"
  | "normalization"
  | "metric"
  | "calculation"
  | "page_load"
  | "worker"
  | "chart"
  | "data_quality"
  | "system";

export type DevMonitorStatus =
  | "start"
  | "success"
  | "error"
  | "slow"
  | "invalid"
  | "cache_hit"
  | "cache_miss"
  | "warning"
  | "canceled";

export interface PerformanceEvent {
  id: string;
  timestamp: string;
  request_id?: string | null;
  parent_id?: string | null;
  level: DevMonitorLevel;
  scope: DevMonitorScope;
  operation: string;
  status: DevMonitorStatus;
  duration_ms?: number | null;
  ticker?: string | null;
  route?: string | null;
  method?: string | null;
  table?: string | null;
  provider?: string | null;
  component?: string | null;
  warning_code?: string | null;
  error_code?: string | null;
  message?: string | null;
  metadata: Record<string, unknown>;
}

export interface PerformanceEventListResponse {
  events: PerformanceEvent[];
  limit: number;
}

export interface PerformanceSummary {
  active_requests: number;
  avg_api_latency_ms: number;
  p95_api_latency_ms: number;
  slow_operations: number;
  errors: number;
  cache_hit_rate: number;
}

export function slowThresholdMsForScope(scope: string) {
  return scope === "api" ? 1000 : 250;
}

export function buildPerformanceStreamUrl() {
  return buildApiUrl("/dev/log-stream");
}

export async function fetchPerformanceRecent(limit = 500) {
  return fetchApi<PerformanceEventListResponse>("/dev/performance/recent", {
    params: { limit },
  });
}

export async function fetchPerformanceSlow(limit = 100) {
  return fetchApi<PerformanceEventListResponse>("/dev/performance/slow", {
    params: { limit },
  });
}

export async function fetchPerformanceErrors(limit = 100) {
  return fetchApi<PerformanceEventListResponse>("/dev/performance/errors", {
    params: { limit },
  });
}

export async function fetchPerformanceSummary() {
  return fetchApi<PerformanceSummary>("/dev/performance/summary");
}

export interface CollapsedNode {
  collapsed_count: number;
  total_ms: number;
  deepest_scope: string;
}

export interface SpanNode {
  id: string;
  parent_id: string | null;
  operation: string;
  scope: string;
  status: string;
  total_ms: number | null;
  self_ms: number | null;
  offset_ms: number;
  clock_skew: boolean;
  orphaned: boolean;
  ticker: string | null;
  table: string | null;
  component: string | null;
  rows: number | null;
  bytes: number | null;
  series_points: number | null;
  cache_state: string | null;
  children: Array<SpanNode | CollapsedNode>;
}

export function isCollapsedNode(node: SpanNode | CollapsedNode): node is CollapsedNode {
  return "collapsed_count" in node;
}

// `type` (not `interface`) so this satisfies DenseTable's
// `<T extends Record<string, unknown>>` constraint when used as row data.
export type RequestSummaryRow = {
  request_id: string;
  route: string | null;
  method: string | null;
  started_at: string;
  ended_at: string | null;
  total_ms: number | null;
  span_count: number;
  ticker_count: number;
  status: string;
  partial: boolean;
};

export interface RequestIndex {
  requests: RequestSummaryRow[];
  limit: number;
  buffer_used: number;
  buffer_limit: number;
}

export interface RequestWaterfall {
  request_id: string;
  route: string | null;
  total_ms: number | null;
  span_count: number;
  partial: boolean;
  truncated: boolean;
  overlap_detected: boolean;
  root: SpanNode;
}

// `type` (not `interface`) so this satisfies DenseTable's row constraint.
export type TickerCostRow = {
  ticker: string;
  self_ms: number;
  span_count: number;
  db_ms: number;
  calculation_ms: number;
  external_ms: number;
  cache_hits: number;
  cache_misses: number;
  rows_read: number;
  bytes: number | null;
  series_points: number | null;
};

export interface TickerCostTable {
  rows: TickerCostRow[];
  ticker_count: number;
  total_self_ms: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
  cv: number;
  distribution: "uniform" | "mixed" | "skewed";
}

export interface ScopeRow {
  scope: string;
  self_ms: number;
  pct_of_total: number;
  event_count: number;
  slow_count: number;
}

export interface ScopeBreakdown {
  scopes: ScopeRow[];
  total_ms: number;
  unattributed_ms: number;
  overlap_detected: boolean;
}

// `type` (not `interface`) so this satisfies DenseTable's row constraint.
export type CacheRow = {
  component: string;
  hits: number;
  misses: number;
  hit_rate: number;
  avg_miss_cost_ms: number;
  estimated_time_saved_ms: number;
};

export interface CacheReport {
  caches: CacheRow[];
}

// No `monitor:` option on any of these -- the analysis surface must not
// inject events into the buffer it is analysing.
export async function fetchPerformanceRequests(limit = 50) {
  return fetchApi<RequestIndex>("/dev/performance/requests", { params: { limit } });
}

export async function fetchPerformanceWaterfall(requestId: string) {
  return fetchApi<RequestWaterfall>(`/dev/performance/waterfall/${requestId}`);
}

export async function fetchPerformanceByTicker(options: {
  requestId?: string;
  route?: string;
  window?: number;
} = {}) {
  const params: Record<string, string | number> = {};
  if (options.requestId) params.request_id = options.requestId;
  if (options.route) params.route = options.route;
  if (options.window) params.window = options.window;
  return fetchApi<TickerCostTable>("/dev/performance/by-ticker", { params });
}

export async function fetchPerformanceBreakdown(requestId?: string) {
  const params: Record<string, string | number> = {};
  if (requestId) params.request_id = requestId;
  return fetchApi<ScopeBreakdown>("/dev/performance/breakdown", { params });
}

export async function fetchPerformanceCache(window = 300) {
  return fetchApi<CacheReport>("/dev/performance/cache", { params: { window } });
}
