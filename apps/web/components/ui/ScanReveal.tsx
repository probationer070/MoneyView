"use client";

import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import { usePrefersReducedMotion } from "@/lib/motion";
import { tokens } from "@/lib/tokens.generated";

const SCAN = Number.parseFloat(tokens.duration.scan);
const EASING = tokens.easing.default;

interface ScanRevealProps {
  /** When this changes after mount, the scan runs. The first value never scans. */
  trigger: string;
  children: ReactNode;
  className?: string;
}

/** A 1px brand line sweeps down the panel while the children are revealed behind it. Reduced motion: nothing runs. */
export function ScanReveal({ trigger, children, className }: ScanRevealProps) {
  const reduced = usePrefersReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const last = useRef(trigger);

  useEffect(() => {
    if (last.current === trigger) return;
    last.current = trigger;
    if (reduced || !host.current || !body.current || !line.current) return;
    const h = host.current.offsetHeight;
    const options = { duration: SCAN, easing: EASING };
    line.current.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 1, transform: `translateY(${h - 1}px)`, offset: 0.9 },
        { opacity: 0, transform: `translateY(${h - 1}px)` },
      ],
      options
    );
    body.current.animate(
      [{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0% 0)" }],
      options
    );
  }, [trigger, reduced]);

  return (
    <div ref={host} className={clsx("relative", className)}>
      <div
        ref={line}
        data-testid="scan-line"
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[var(--hairline)] bg-[var(--brand)] opacity-0"
      />
      <div ref={body}>{children}</div>
    </div>
  );
}
