import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal server bundle for the container image (D10 pipeline).
  // Tracing root = repo root, so packages/shared-types is included.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
