import { fetchApi, buildApiUrl } from "@/lib/api";
import type { NewsArticle } from "@/app/portfolio/page";

export interface BulkNewsEntry {
  articles: NewsArticle[];
  last_checked_at: string | null;
}

export interface BulkNewsResponse {
  tickers: Record<string, BulkNewsEntry>;
}

export interface NewsAcquireResult {
  ticker: string;
  status: "acquired" | "fresh" | "empty" | "failed";
  articles: number;
  detail: string | null;
}

export interface NewsAcquireResponse {
  results: NewsAcquireResult[];
  skipped_unknown: string[];
}

export async function fetchBulkNews(tickers: string[], perTicker = 3) {
  return fetchApi<BulkNewsResponse>("/news/feed/bulk", {
    params: { tickers: tickers.join(","), per_ticker: perTicker },
  });
}

export async function acquireNews(tickers: string[]): Promise<NewsAcquireResponse> {
  const response = await fetch(buildApiUrl("/news/acquire").toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers }),
  });
  if (!response.ok) {
    // The route rejects with FastAPI's {detail: "..."} for the ticker cap and for a
    // request with no known tickers. Both are things the user can act on, so the
    // detail is preferred over the bare status line.
    let detail = "";
    try {
      const errorBody = await response.json();
      if (typeof errorBody?.detail === "string") detail = errorBody.detail;
    } catch {
      // Non-JSON error body: fall through to the status line.
    }
    throw new Error(detail || `API error: ${response.status} ${response.statusText}`);
  }
  const json = await response.json();
  return (json.data ?? json) as NewsAcquireResponse;
}

export function summarizeAcquisition(response: NewsAcquireResponse): string {
  const acquired = response.results.filter((r) => r.status === "acquired").length;
  const current = response.results.filter((r) => r.status === "fresh" || r.status === "empty").length;
  const failed = response.results.filter((r) => r.status === "failed");

  const parts = [`${acquired} refreshed`, `${current} already current`];
  if (failed.length > 0) {
    // Name failures rather than counting them anonymously: "3 failed" tells the user
    // nothing they can act on.
    const named = failed.slice(0, 2).map((r) => r.ticker).join(", ");
    const rest = failed.length > 2 ? ` +${failed.length - 2}` : "";
    parts.push(`${failed.length} failed (${named}${rest})`);
  }
  return parts.join(" · ");
}
