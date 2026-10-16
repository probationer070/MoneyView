/** Status lines for the calculation modal's raw-data datasets (the page's strings, moved out of page.tsx). */
export function historicalPriceStatus(query: { isLoading: boolean; isError: boolean }, rowCount: number): string {
  if (query.isLoading && rowCount === 0) return "Loading 5-year historical price data";
  if (query.isError && rowCount === 0) return "5-year historical price data unavailable";
  if (rowCount === 0) return "Refresh source data to load 5-year historical price data";
  return `${rowCount} daily rows from the 5-year OHLCV endpoint`;
}

export function quarterlyStatementsStatus(
  query: { isLoading: boolean; isError: boolean },
  data: { rows: unknown[]; source?: string | null } | null | undefined,
): string {
  if (query.isLoading && !data) return "Loading Yahoo quarterly financial statements";
  if (query.isError && !data) return "Yahoo quarterly financial statements unavailable";
  if (!data) return "Refresh source data to load Yahoo quarterly financial statements";
  return `${data.rows.length} rows from ${data.source ?? "Yahoo quarterly financial statements"}`;
}
