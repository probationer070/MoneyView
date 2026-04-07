"use server";

import fs from "fs";
import path from "path";

export async function discoverBackendPort(): Promise<number> {
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
  return 8000;
}
