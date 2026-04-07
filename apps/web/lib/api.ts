/**
 * API client to connect the Next.js frontend with the Python FastAPI backend.
 * Uses fetch for SSR-friendly remote caching where appropriate.
 */

const DEFAULT_API_PORT = 8000;
const DEFAULT_API_BASE_URL = `http://127.0.0.1:${DEFAULT_API_PORT}`;

let DYNAMIC_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL;

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
};

export async function fetchApi<T>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { params, headers, baseUrl, ...restOptions } = options;
  
  const url = new URL(`/api/v1${endpoint}`, baseUrl ?? getApiBaseUrl());
  
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.append(key, String(value));
    });
  }

  // Generate Request ID for end-to-end trace correlation
  const requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `req-${Date.now()}`;

  const defaultHeaders: HeadersInit = {
    "Content-Type": "application/json",
    "X-Request-ID": requestId,
  };

  const response = await fetch(url.toString(), {
    headers: { ...defaultHeaders, ...headers },
    ...restOptions,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  // Prefer generic envelope, but gracefully accept raw JSON payloads.
  const jsonResponse = await response.json();
  
  if (jsonResponse?.status === "error") {
      throw new Error(`API returned logical error`);
  }

  if (jsonResponse && typeof jsonResponse === "object" && "data" in jsonResponse) {
    return jsonResponse.data as T;
  }
  return jsonResponse as T;
}
