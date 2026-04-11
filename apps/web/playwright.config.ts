import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");
const E2E_API_PORT = Number(process.env.MONEYVIEW_E2E_API_PORT ?? 8110);
const E2E_WEB_PORT = Number(process.env.MONEYVIEW_E2E_WEB_PORT ?? 3101);
const E2E_API_BASE_URL = `http://127.0.0.1:${E2E_API_PORT}`;
const E2E_WEB_BASE_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;
const apiHarnessScript = path.join(__dirname, "tests", "e2e", "start-playwright-api.ps1");
const webHarnessScript = path.join(__dirname, "tests", "e2e", "start-playwright-web.ps1");

if (!fs.existsSync(apiHarnessScript) || !fs.existsSync(webHarnessScript)) {
  throw new Error("Playwright harness startup scripts are missing.");
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: E2E_WEB_BASE_URL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command:
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${apiHarnessScript}" -ApiPort ${E2E_API_PORT}`,
      url: `${E2E_API_BASE_URL}/api/v1/healthz`,
      cwd: repoRoot,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `powershell -NoProfile -ExecutionPolicy Bypass -File "${webHarnessScript}" -WebPort ${E2E_WEB_PORT} -ApiPort ${E2E_API_PORT}`,
      url: `${E2E_WEB_BASE_URL}/healthz`,
      cwd: __dirname,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
