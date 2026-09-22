import type { Route } from "@playwright/test";

export const API_PREFIX = "/api/v1";

export function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export function nowIso() {
  return "2026-04-11T12:00:00Z";
}

export function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Default records-sync half for GET /api/v1/sync/status: sync off. Pages that don't test the
// status line themselves still call this endpoint via RecordsSyncStatus, so every page mock
// needs a deterministic default; the new spec overrides it per test.
export const RECORDS_SYNC_OFF = {
  enabled: false,
  pc_id: null,
  peers: [],
  skipped_files: [],
  last_sync_at: null,
  last_error: null,
  renamed: [],
};
