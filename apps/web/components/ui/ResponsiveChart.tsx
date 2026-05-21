"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";
import { emitClientPerformanceEvent } from "@/lib/api";

const DEFAULT_INITIAL_DIMENSION = { width: 1, height: 1 };

interface ResponsiveChartProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  minWidth?: number;
  minHeight?: number;
  monitorName?: string;
}

export function ResponsiveChart({
  children,
  className,
  style,
  minWidth = 1,
  minHeight = 1,
  monitorName = "recharts_panel",
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const mountedAtRef = useRef<number | null>(null);
  const hasReportedRenderRef = useRef(false);

  useEffect(() => {
    if (mountedAtRef.current == null) {
      mountedAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
    const node = containerRef.current;
    if (!node) return;

    const updateSize = (width: number, height: number) => {
      setSize((current) => {
        if (current.width === width && current.height === height) {
          return current;
        }
        return { width, height };
      });
    };

    const measure = () => {
      const rect = node.getBoundingClientRect();
      updateSize(Math.round(rect.width), Math.round(rect.height));
    };

    measure();

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        measure();
        return;
      }
      updateSize(Math.round(entry.contentRect.width), Math.round(entry.contentRect.height));
    });

    resizeObserver.observe(node);
    return () => resizeObserver.disconnect();
  }, []);

  const isReady = size.width >= minWidth && size.height >= minHeight;

  useEffect(() => {
    if (!isReady || hasReportedRenderRef.current) {
      return;
    }
    hasReportedRenderRef.current = true;
    const startedAt = mountedAtRef.current ?? (typeof performance !== "undefined" ? performance.now() : Date.now());
    const durationMs = Number(((typeof performance !== "undefined" ? performance.now() : Date.now()) - startedAt).toFixed(1));
    void emitClientPerformanceEvent({
      level: "info",
      scope: "chart",
      operation: "chart.render",
      status: durationMs >= 1000 ? "slow" : "success",
      duration_ms: durationMs,
      route: typeof window !== "undefined" ? window.location.pathname : null,
      component: monitorName,
      metadata: {
        width: size.width,
        height: size.height,
        min_width: minWidth,
        min_height: minHeight,
      },
    });
  }, [isReady, minHeight, minWidth, monitorName, size.height, size.width]);

  return (
    <div ref={containerRef} className={className} style={style}>
      {isReady ? (
        <ResponsiveContainer
          width="100%"
          height="100%"
          minWidth={minWidth}
          minHeight={minHeight}
          initialDimension={DEFAULT_INITIAL_DIMENSION}
        >
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  );
}
