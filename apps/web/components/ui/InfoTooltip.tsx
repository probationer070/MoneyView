"use client";

import { Info } from "lucide-react";

interface InfoTooltipProps {
  label: string;
  description: string;
}

export function InfoTooltip({ label, description }: InfoTooltipProps) {
  return (
    <span className="group relative inline-flex items-center gap-1 align-middle">
      <span>{label}</span>
      <Info className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-6 z-30 hidden w-64 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-xs font-normal leading-relaxed text-[var(--text-primary)] shadow-lg group-hover:block"
      >
        {description}
      </span>
    </span>
  );
}
