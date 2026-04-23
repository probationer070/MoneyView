"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

type RunStatus = "idle" | "loading" | "error" | "cancelled";

type Props = {
  controls?: ReactNode;
  helper?: ReactNode;
  summary?: ReactNode;
  status: RunStatus;
  progress: number;
  progressLabel: string;
  progressTone?: "accent" | "surface";
  errorMessage?: string | null;
  errorFallbackMessage: string;
  cancelledMessage: string;
  hasResult?: boolean;
  emptyState?: ReactNode;
  resultContent?: ReactNode;
  children?: ReactNode;
};

export function MonteCarloRunPanel({
  controls,
  helper,
  summary,
  status,
  progress,
  progressLabel,
  progressTone = "accent",
  errorMessage,
  errorFallbackMessage,
  cancelledMessage,
  hasResult,
  emptyState,
  resultContent,
  children,
}: Props) {
  const progressBarClassName =
    progressTone === "surface" ? "bg-[var(--surface)]" : "bg-[var(--accent)]";

  return (
    <div className="space-y-6">
      {controls}

      {helper}

      {summary}

      {status === "loading" && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm font-bold text-[var(--text-primary)]">
            <span>{progressLabel}</span>
            <span>{progress}%</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-slate-100">
            <div className={`h-3 rounded-full transition-all ${progressBarClassName}`} style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle className="h-4 w-4" />
          {errorMessage ?? errorFallbackMessage}
        </div>
      )}

      {status === "cancelled" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          {cancelledMessage}
        </div>
      )}

      {typeof hasResult === "boolean"
        ? (hasResult ? resultContent : emptyState)
        : resultContent}

      {children}
    </div>
  );
}
