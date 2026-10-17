"use client";

import { Loader2 } from "lucide-react";

// The brand run button. The arrow is decoration, so it is hidden from assistive tech and the name stays the label.
export function RunButton({ label, onClick, running, testId }: { label: string; onClick: () => void; running: boolean; testId: string }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={running}
      className="group inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-[var(--radius-1)] bg-[var(--brand)] px-4 py-2 type-label text-[var(--on-brand)] disabled:opacity-60"
    >
      {running ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
      {label}
      <span
        aria-hidden="true"
        className="inline-block [transition:transform_var(--duration-normal)] motion-reduce:transition-none group-hover:translate-x-1 group-focus-visible:translate-x-1 motion-reduce:group-hover:translate-x-0 motion-reduce:group-focus-visible:translate-x-0"
      >
        →
      </span>
    </button>
  );
}
