import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal server bundle for the container image (D10 pipeline).
  // Tracing root = repo root, so packages/shared-types is included.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Container builds set NEXT_BUILD_CPUS to keep peak memory inside the
  // CI runner's small WSL VM; local builds stay at the default parallelism.
  ...(process.env.NEXT_BUILD_CPUS
    ? { experimental: { cpus: Number(process.env.NEXT_BUILD_CPUS) } }
    : {}),
};

export default nextConfig;
