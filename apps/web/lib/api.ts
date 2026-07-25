/**
 * API client to connect the Next.js frontend with the Python FastAPI backend.
 * Uses fetch for SSR-friendly remote caching where appropriate.
 */

const DEFAULT_API_PORT = 8000;
const DEFAULT_API_BASE_URL = `http://127.0.0.1:${DEFAULT_API_PORT}`;
const DEV_MONITOR_CHECK_TTL_MS = 15_000;
const DEFAULT_FRONTEND_API_SLOW_THRESHOLD_MS = 1_000;

let DYNAMIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;
let clientDevMonitorEnabled: boolean | null = null;
let clientDevMonitorLastCheckedAt = 0;
let clientDevMonitorCheckPromise: Promise<boolean> | null = null;

export function apiBaseUrlForPort(port: number) {
  return `http://127.0.0.1:${port}`;
}

export function setDynamicPort(port: number) {
  DYNAMIC_API_BASE_URL = apiBaseUrlForPort(port);
}

export function getApiBaseUrl() {
  return DYNAMIC_API_BASE_URL;
}

type FetchOptions = RequestInit & {
  params?: Record<string, string | number>;
  baseUrl?: string;
  monitor?: ClientMonitorOptions;
};

export interface ClientPerformanceEventPayload {
  level?: "debug" | "info" | "warn" | "error";
  scope: "api" | "page_load" | "chart" | "worker" | "external" | "system";
  operation: string;
  status: "start" | "success" | "error" | "slow" | "warning" | "canceled";
  duration_ms?: number | null;
  ticker?: string | null;
  route?: string | null;
  method?: string | null;
  provider?: string | null;
  component?: string | null;
  warning_code?: string | null;
  error_code?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ClientMonitorOptions {
  operation?: string;
  component?: string;
  scope?: ClientPerformanceEventPayload["scope"];
  ticker?: string | null;
  provider?: string | null;
  route?: string | null;
  metadata?: Record<string, unknown>;
  slowThresholdMs?: number;
}

function generateRequestId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export async function isClientDevMonitorEnabled(forceRefresh = false) {
  if (typeof window === "undefined") {
    return false;
  }

  if (!forceRefresh && clientDevMonitorEnabled !== null && Date.now() - clientDevMonitorLastCheckedAt < DEV_MONITOR_CHECK_TTL_MS) {
    return clientDevMonitorEnabled;
  }

  if (!forceRefresh && clientDevMonitorCheckPromise) {
    return clientDevMonitorCheckPromise;
  }

  clientDevMonitorCheckPromise = (async () => {
    try {
      const response = await fetch(buildApiUrl("/dev/performance/summary").toString(), {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": generateRequestId(),
        },
      });
      clientDevMonitorEnabled = response.ok;
      if (response.status === 404) {
        clientDevMonitorEnabled = false;
      }
      clientDevMonitorLastCheckedAt = Date.now();
      return clientDevMonitorEnabled;
    } catch {
      clientDevMonitorLastCheckedAt = Date.now();
      clientDevMonitorEnabled = false;
      return false;
    } finally {
      clientDevMonitorCheckPromise = null;
    }
  })();

  return clientDevMonitorCheckPromise;
}

export async function emitClientPerformanceEvent(payload: ClientPerformanceEventPayload) {
  if (typeof window === "undefined") {
    return false;
  }

  const enabled = await isClientDevMonitorEnabled();
  if (!enabled) {
    return false;
  }

  try {
    const response = await fetch(buildApiUrl("/dev/performance/client-event").toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": generateRequestId(),
      },
      body: JSON.stringify(payload),
    });
    if (response.status === 404) {
      clientDevMonitorEnabled = false;
      clientDevMonitorLastCheckedAt = Date.now();
      return false;
    }
    return response.ok;
  } catch {
    return false;
  }
}

export function buildApiUrl(
  endpoint: string,
  {
    params,
    baseUrl,
  }: {
    params?: Record<string, string | number>;
    baseUrl?: string;
  } = {}
) {
  const url = new URL(`/api/v1${endpoint}`, baseUrl ?? getApiBaseUrl());
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
  }
  return url;
}

export async function fetchApi<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { params, headers, baseUrl, monitor, ...restOptions } = options;
  const url = buildApiUrl(endpoint, { params, baseUrl });
  const requestId = generateRequestId();
  const startedAt = nowMs();
  const monitorScope = monitor?.scope ?? "api";
  const monitorOperation = monitor?.operation ?? "frontend.fetch";
  const monitorRoute = monitor?.route ?? `${url.pathname}${url.search}`;
  const monitorMethod = (restOptions.method ?? "GET").toUpperCase();

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
  };

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { ...defaultHeaders, ...headers },
      ...restOptions,
    });
  } catch (error) {
    if (monitor) {
      const durationMs = Number((nowMs() - startedAt).toFixed(1));
      void emitClientPerformanceEvent({
        level: "error",
        scope: monitorScope,
        operation: monitorOperation,
        status: "error",
        duration_ms: durationMs,
        ticker: monitor.ticker ?? null,
        route: monitorRoute,
        method: monitorMethod,
        provider: monitor.provider ?? null,
        component: monitor.component ?? null,
        error_code: "network_error",
        message: error instanceof Error ? error.message : "Network request failed",
        metadata: {
          endpoint,
          ...(monitor.metadata ?? {}),
        },
      });
    }
    throw error;
  }

  if (!response.ok) {
    if (monitor) {
      const durationMs = Number((nowMs() - startedAt).toFixed(1));
      void emitClientPerformanceEvent({
        level: response.status >= 500 ? "error" : "warn",
        scope: monitorScope,
        operation: monitorOperation,
        status: "error",
        duration_ms: durationMs,
        ticker: monitor.ticker ?? null,
        route: monitorRoute,
        method: monitorMethod,
        provider: monitor.provider ?? null,
        component: monitor.component ?? null,
        error_code: `http_${response.status}`,
        message: `API error: ${response.status} ${response.statusText}`,
        metadata: {
          endpoint,
          status_code: response.status,
          ...(monitor.metadata ?? {}),
        },
      });
    }
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  // Prefer generic envelope, but gracefully accept raw JSON payloads.
  const jsonResponse = await response.json();
  
  if (jsonResponse?.status === "error") {
      if (monitor) {
        const durationMs = Number((nowMs() - startedAt).toFixed(1));
        void emitClientPerformanceEvent({
          level: "error",
          scope: monitorScope,
          operation: monitorOperation,
          status: "error",
          duration_ms: durationMs,
          ticker: monitor.ticker ?? null,
          route: monitorRoute,
          method: monitorMethod,
          provider: monitor.provider ?? null,
          component: monitor.component ?? null,
          error_code: "logical_error",
          message: "API returned logical error",
          metadata: {
            endpoint,
            status_code: response.status,
            ...(monitor.metadata ?? {}),
          },
        });
      }
      throw new Error(`API returned logical error`);
  }

  if (monitor) {
    const durationMs = Number((nowMs() - startedAt).toFixed(1));
    const slowThresholdMs = monitor.slowThresholdMs ?? DEFAULT_FRONTEND_API_SLOW_THRESHOLD_MS;
    const rawLength = response.headers.get("content-length");
    const responseBytes = rawLength === null ? null : Number.parseInt(rawLength, 10);
    void emitClientPerformanceEvent({
      level: "info",
      scope: monitorScope,
      operation: monitorOperation,
      status: durationMs >= slowThresholdMs ? "slow" : "success",
      duration_ms: durationMs,
      ticker: monitor.ticker ?? null,
      route: monitorRoute,
      method: monitorMethod,
      provider: monitor.provider ?? null,
      component: monitor.component ?? null,
      metadata: {
        endpoint,
        status_code: response.status,
        bytes: Number.isFinite(responseBytes as number) ? responseBytes : null,
        ...(monitor.metadata ?? {}),
      },
    });
  }

  if (jsonResponse && typeof jsonResponse === "object" && "data" in jsonResponse) {
    return jsonResponse.data as T;
  }
  return jsonResponse as T;
}
