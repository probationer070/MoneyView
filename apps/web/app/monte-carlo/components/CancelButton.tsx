"use client";

import { Square } from "lucide-react";

// The secondary action beside RunButton; enabled only while a run is in flight.
export function CancelButton({ label, onClick, disabled, testId }: { label: string; onClick: () => void; disabled: boolean; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2 type-label text-[var(--ink)] disabled:opacity-50"
    >
      <Square aria-hidden="true" className="h-4 w-4" />
      {label}
    </button>
  );
}
