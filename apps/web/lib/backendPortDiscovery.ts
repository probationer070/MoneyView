/**
 * Client-side backend port discovery for the boot health check (AppProvider).
 *
 * The port normally comes from GET /api/runtime/backend-port, which reads the launcher's
 * port file and itself falls back to 8000. That lookup is not allowed to be a single point
 * of failure: on 2026-09-29 the Next dev server returned 404 for it (a stale dev cache),
 * and the app showed "System Boot Failure" after 30s while the API was healthy on :8000.
 * A failed or malformed lookup therefore falls back to the same default, and the health
 * check that follows decides whether that port is right. Each retry looks the port up
 * again, so a lookup that recovers still wins.
 */

/** Mirrors lib/server/backendPort.ts DEFAULT_BACKEND_PORT, the route's own fallback. */
export const DEFAULT_BACKEND_PORT = 8000;

export async function resolveBackendPort(
  explicitBaseUrl: string | undefined,
  lookup: () => Promise<Response>,
): Promise<number> {
  if (explicitBaseUrl) {
    return Number(new URL(explicitBaseUrl).port || String(DEFAULT_BACKEND_PORT));
  }
  try {
    const response = await lookup();
    if (!response.ok) return DEFAULT_BACKEND_PORT;
    const payload = (await response.json()) as { port?: unknown };
    return typeof payload.port === "number" ? payload.port : DEFAULT_BACKEND_PORT;
  } catch {
    return DEFAULT_BACKEND_PORT;
  }
}
