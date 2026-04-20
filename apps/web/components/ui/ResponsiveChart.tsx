"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { ResponsiveContainer } from "recharts";

const DEFAULT_INITIAL_DIMENSION = { width: 1, height: 1 };

interface ResponsiveChartProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  minWidth?: number;
  minHeight?: number;
}

export function ResponsiveChart({
  children,
  className,
  style,
  minWidth = 1,
  minHeight = 1,
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
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
