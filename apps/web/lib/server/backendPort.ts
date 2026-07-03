import fs from "fs";
import path from "path";

const DEFAULT_BACKEND_PORT = 8000;

export function readBackendPort(): number {
  const target = path.join(process.cwd(), "../../data/cache/moneyview_port.json");
  try {
    if (fs.existsSync(target)) {
      const payload = fs.readFileSync(target, "utf-8").replace(/^\uFEFF/, "");
      const parsed = JSON.parse(payload);
      if (parsed && typeof parsed.port === "number") {
        return parsed.port;
      }
    }
  } catch (error) {
    console.error("Failed to read dynamic port file, falling back to 8000", error);
  }
  return DEFAULT_BACKEND_PORT;
}

/**
 * SSR-side API base URL. In the D10 container the deployment sets
 * API_BASE_URL_INTERNAL to the in-cluster service address; in local desktop
 * mode the env var is absent and the dynamic port file keeps working.
 */
export function serverApiBaseUrl(): string {
  const internal = process.env.API_BASE_URL_INTERNAL;
  if (internal) {
    return internal;
  }
  return `http://127.0.0.1:${readBackendPort()}`;
}

export { DEFAULT_BACKEND_PORT };
