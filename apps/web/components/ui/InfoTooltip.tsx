"use client";

import { useId, useRef, useState } from "react";
import { Info } from "lucide-react";

interface InfoTooltipProps {
  label: string;
  description: string;
}

export function InfoTooltip({ label, description }: InfoTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 256 });

  const showTooltip = () => {
    const trigger = triggerRef.current;
    if (!trigger || typeof window === "undefined") return;

    const viewportPadding = 12;
    const preferredWidth = 256;
    const width = Math.min(preferredWidth, window.innerWidth - viewportPadding * 2);
    const rect = trigger.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left, viewportPadding),
      window.innerWidth - width - viewportPadding,
    );
    const top = rect.bottom + 8;

    setPosition({ left, top, width });
    setIsVisible(true);
  };

  const hideTooltip = () => setIsVisible(false);

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex items-center gap-1 align-middle"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      aria-describedby={isVisible ? tooltipId : undefined}
    >
      <span>{label}</span>
      <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
      {isVisible && (
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-50 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-xs font-normal leading-relaxed text-[var(--text-primary)] shadow-lg"
          style={{
            left: position.left,
            top: position.top,
            width: `calc(${position.width}px - 20px)`,
          }}
        >
          {description}
        </span>
      )}
    </span>
  );
}
