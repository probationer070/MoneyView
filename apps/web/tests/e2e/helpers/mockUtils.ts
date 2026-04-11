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
