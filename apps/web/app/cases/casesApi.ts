import { buildApiUrl } from "@/lib/api";
import type {
  CaseRecord, CaseSummary, DiffResult, ForkRequest, PricingResult, RunResult, SimulateRequest, SimulateResult,
} from "./caseTypes";

/**
 * Not fetchApi: that throws "API error: 422 Unprocessable Entity" and drops the body, and on
 * this page the server's `detail` IS the content -- an engine refusal, a missing claim, the
 * Shapley cap. Same reasoning as lib/marketEventsApi.ts.
 */
export class CaseApiError extends Error {
  public constructor(public readonly status: number, public readonly detail: string) {
    super(detail);
  }

  /** A 4xx: the request was understood and refused. Content, not a failure. */
  public get isRefusal(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

function describeDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item: { loc?: unknown[]; msg?: string }) => `${(item.loc ?? []).slice(1).join(".")}: ${item.msg ?? "invalid"}`)
      .join("; ");
  }
  return fallback;
}

async function request<T>(endpoint: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  const response = await fetch(buildApiUrl(endpoint).toString(), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const fallback = `${response.status} ${response.statusText}`;
    let detail = fallback;
    try {
      detail = describeDetail((await response.json())?.detail, fallback);
    } catch {
      // Not JSON: keep the status line.
    }
    throw new CaseApiError(response.status, detail);
  }
  const payload = (await response.json()) as { data?: T } | T;
  return (payload && typeof payload === "object" && "data" in payload ? payload.data : payload) as T;
}

export const casesApi = {
  list: () => request<CaseSummary[]>("/valuation/cases", "GET"),
  get: (id: number) => request<CaseRecord>(`/valuation/cases/${id}`, "GET"),
  // POST, but it computes and stores nothing.
  run: (id: number) => request<RunResult>(`/valuation/cases/${id}/run`, "POST"),
  diff: (id: number) => request<DiffResult>(`/valuation/cases/${id}/diff`, "GET"),
  pricing: (id: number) => request<PricingResult>(`/valuation/cases/${id}/pricing`, "GET"),
  fork: (id: number, body: ForkRequest) => request<{ id: number }>(`/valuation/cases/${id}/fork`, "POST", body),
  simulate: (id: number, body: SimulateRequest) =>
    request<SimulateResult>(`/valuation/cases/${id}/simulate`, "POST", body),
};

/** React Query `retry`: a refusal will be refused again, so only retry real failures. */
export function retryUnlessRefused(failureCount: number, error: unknown): boolean {
  if (error instanceof CaseApiError && error.isRefusal) return false;
  return failureCount < 2;
}
