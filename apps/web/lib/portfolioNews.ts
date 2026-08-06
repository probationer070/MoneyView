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

/** "AAPL, MSFT +3" — names the first two and counts the rest. */
function nameSome(tickers: string[]): string {
  const named = tickers.slice(0, 2).join(", ");
  return `${named}${tickers.length > 2 ? ` +${tickers.length - 2}` : ""}`;
}

export function summarizeAcquisition(response: NewsAcquireResponse): string {
  const skipped = response.skipped_unknown ?? [];
  const parts: string[] = [];

  if (response.results.length === 0) {
    // "0 refreshed · 0 already current" is a report about work that never happened, and
    // it reads as a clean run. Nothing was requested, or nothing came back; say that.
    parts.push("Nothing to refresh");
  } else {
    const acquired = response.results.filter((r) => r.status === "acquired").length;
    const current = response.results.filter((r) => r.status === "fresh" || r.status === "empty").length;
    const failed = response.results.filter((r) => r.status === "failed");

    parts.push(`${acquired} refreshed`, `${current} already current`);
    if (failed.length > 0) {
      // Name failures rather than counting them anonymously: "3 failed" tells the user
      // nothing they can act on.
      parts.push(`${failed.length} failed (${nameSome(failed.map((r) => r.ticker))})`);
    }
  }

  if (skipped.length > 0) {
    // The backend reports the tickers it could not resolve. Dropping that line leaves a
    // typo'd or delisted ticker sitting in the watchlist looking exactly like a stock
    // that simply has no news, which is the one reading it must not have.
    parts.push(`${skipped.length} not recognised (${nameSome(skipped)})`);
  }

  return parts.join(" · ");
}
