import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  title?: string;
  message: string;
  retryAction?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message,
  retryAction,
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      <div className="flex items-center justify-center w-12 h-12 rounded-[var(--radius-md)] bg-[var(--state-error)]/10 text-[var(--state-error)]">
        <AlertCircle className="h-6 w-6" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">{title}</p>
        <p className="text-[12px] text-[var(--text-muted)] max-w-[320px]">{message}</p>
      </div>
      {retryAction && (
        <button
          type="button"
          onClick={retryAction}
          className="mt-1 text-[13px] font-medium text-[var(--state-info)] underline decoration-dotted underline-offset-4 hover:opacity-80 transition-opacity duration-[var(--duration-fast)]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
