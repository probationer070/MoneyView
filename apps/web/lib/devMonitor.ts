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
