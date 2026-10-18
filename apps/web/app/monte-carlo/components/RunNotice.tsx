"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

const TONES = {
  error: "border-[var(--status-error-border)] bg-[var(--status-error-surface)] text-[var(--status-error-ink)]",
  warning: "border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] text-[var(--status-warning-ink)]",
};

// A one-line banner under the result header: a failed run (error) or a cancelled one (warning).
export function RunNotice({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return (
    <div className={`flex shrink-0 items-center gap-2 border px-3 py-2 type-small ${TONES[tone]}`}>
      <AlertTriangle aria-hidden="true" className="h-4 w-4" />
      {children}
    </div>
  );
}
