"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { emitClientPerformanceEvent } from "@/lib/api";

interface UseDevMonitorPageLoadOptions {
  component: string;
  ticker?: string | null;
  metadata?: Record<string, unknown>;
}

export function useDevMonitorPageLoad({
  component,
  ticker,
  metadata,
}: UseDevMonitorPageLoadOptions) {
  const pathname = usePathname();
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (startedAtRef.current == null) {
      startedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    const animationFrameId = window.requestAnimationFrame(() => {
      const startedAt = startedAtRef.current ?? (typeof performance !== "undefined" ? performance.now() : Date.now());
      const durationMs = Number(((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt).toFixed(1));
      void emitClientPerformanceEvent({
        level: "info",
        scope: "page_load",
        operation: `page_load.frontend.${component}`,
        status: durationMs >= 1000 ? "slow" : "success",
        duration_ms: durationMs,
        ticker: ticker ?? null,
        route: pathname,
        component,
        metadata: metadata ?? {},
      });
      startedAtRef.current = null;
    });

    return () => {
      window.cancelAnimationFrame(animationFrameId);
    };
  }, [component, metadata, pathname, ticker]);
}
