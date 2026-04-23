import type { ReactNode } from "react";
import { BarChart3, Inbox } from "lucide-react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      <div className="flex items-center justify-center w-12 h-12 rounded-[var(--radius-md)] bg-[var(--bg-subtle)] text-[var(--text-muted)]">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-[14px] font-medium text-[var(--text-primary)]">{title}</p>
        {description && (
          <p className="text-[12px] text-[var(--text-muted)] max-w-[280px]">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// Convenience variant for charts and data panels
export function EmptyChart() {
  return (
    <EmptyState
      icon={<BarChart3 className="h-6 w-6" />}
      title="No data available"
      description="Run an analysis or refresh the data to see results here."
    />
  );
}
