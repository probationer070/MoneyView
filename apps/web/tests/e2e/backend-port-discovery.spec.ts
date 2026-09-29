import { expect, test } from "@playwright/test";
import { DEFAULT_BACKEND_PORT, resolveBackendPort } from "../../lib/backendPortDiscovery";

/**
 * Backend port discovery must not be a single point of failure.
 *
 * The app's first request is GET /api/runtime/backend-port. When the Next dev server
 * returned 404 for it (a stale Turbopack dev cache, 2026-09-29), the provider threw,
 * retried for 30s and showed "System Boot Failure" -- with the API healthy on :8000,
 * the same default the route itself falls back to. A failed lookup now falls back to
 * that default and the health check decides.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test.describe("resolveBackendPort", () => {
  test("uses the port the runtime route reports", async () => {
    expect(await resolveBackendPort(undefined, async () => json({ port: 8123 }))).toBe(8123);
  });

  test("a 404 from the route falls back to the default port instead of failing", async () => {
    expect(await resolveBackendPort(undefined, async () => json({ detail: "not found" }, 404))).toBe(DEFAULT_BACKEND_PORT);
  });

  test("a lookup that throws falls back to the default port", async () => {
    expect(await resolveBackendPort(undefined, async () => { throw new TypeError("fetch failed"); })).toBe(DEFAULT_BACKEND_PORT);
  });

  test("a payload without a numeric port falls back to the default port", async () => {
    expect(await resolveBackendPort(undefined, async () => json({ port: "8123" }))).toBe(DEFAULT_BACKEND_PORT);
  });

  test("an explicit base URL wins and the route is not consulted", async () => {
    let consulted = false;
    const port = await resolveBackendPort("http://127.0.0.1:8110", async () => { consulted = true; return json({ port: 1 }); });
    expect(port).toBe(8110);
    expect(consulted).toBe(false);
  });

  test("the default matches the server-side route's own fallback", () => {
    expect(DEFAULT_BACKEND_PORT).toBe(8000);
  });
});
