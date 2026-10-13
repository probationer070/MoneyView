import type { ReactNode } from "react";
import { BarChart3, Inbox } from "lucide-react";
import { useT } from "@/lib/i18n/locale";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 px-6 text-center">
      <div className="flex items-center justify-center w-12 h-12 bg-[var(--surface)] text-[var(--ink-muted)]">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <div className="flex flex-col gap-1">
        <p className="type-body text-[var(--ink)]">{title}</p>
        {description && (
          <p className="type-small text-[var(--ink-muted)] max-w-[280px]">{description}</p>
        )}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

// Convenience variant for charts and data panels
export function EmptyChart() {
  const t = useT();
  return (
    <EmptyState
      icon={<BarChart3 className="h-6 w-6" />}
      title={t("common.noData")}
      description={t("common.noDataHint")}
    />
  );
}
