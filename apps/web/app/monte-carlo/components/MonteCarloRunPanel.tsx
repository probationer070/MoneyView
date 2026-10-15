"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { useLocale } from "@/lib/i18n/locale";

type RunStatus = "idle" | "loading" | "error" | "cancelled";

type Props = {
  controls?: ReactNode;
  helper?: ReactNode;
  summary?: ReactNode;
  status: RunStatus;
  progress: number;
  progressLabel: string;
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
  errorMessage,
  errorFallbackMessage,
  cancelledMessage,
  hasResult,
  emptyState,
  resultContent,
  children,
}: Props) {
  const { locale } = useLocale();

  return (
    <div className="space-y-6">
      {controls}

      {helper}

      {summary}

      {status === "loading" && (
        <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-4">
          <div className="flex items-center justify-between type-label text-[var(--ink)]">
            <span>{progressLabel}</span>
            <span className="type-mono">{formatNumber(progress, "integer", { locale })}%</span>
          </div>
          {/* Progress track and fill: rounded-full is allowed here because both are tracks, not panels. */}
          <div className="mt-3 h-3 rounded-full bg-[var(--surface)]">
            <div className="h-3 rounded-full bg-[var(--brand)] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="flex items-center gap-2 border border-[var(--status-error-border)] bg-[var(--status-error-surface)] p-4 type-label text-[var(--status-error-ink)]">
          <AlertTriangle className="h-4 w-4" />
          {errorMessage ?? errorFallbackMessage}
        </div>
      )}

      {status === "cancelled" && (
        <div className="flex items-center gap-2 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] p-4 type-label text-[var(--status-warning-ink)]">
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
