import { AlertCircle } from "lucide-react";
import { useT } from "@/lib/i18n/locale";

interface ErrorStateProps {
  title?: string;
  message: string;
  retryAction?: () => void;
}

export function ErrorState({
  title,
  message,
  retryAction,
}: ErrorStateProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      <div className="flex items-center justify-center w-12 h-12 bg-[var(--status-error-surface)] text-[var(--status-error-ink)]">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="type-body text-[var(--ink)]">{title ?? t("common.errorTitle")}</p>
        <p className="type-small text-[var(--ink-muted)] max-w-[320px]">{message}</p>
      </div>
      {retryAction && (
        <button
          type="button"
          onClick={retryAction}
          className="mt-1 type-small text-[var(--brand-text)] underline decoration-dotted underline-offset-4 hover:opacity-80 transition-opacity duration-[var(--duration-fast)]"
        >
          {t("common.tryAgain")}
        </button>
      )}
    </div>
  );
}
