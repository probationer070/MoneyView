import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { LabelKey } from "@/lib/i18n/labels";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: { label: LabelKey; suffix?: string };
  actions?: ReactNode;
  subtitleTestId?: string;
}

export function PageHeader({ title, subtitle, eyebrow, actions, subtitleTestId }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-2"><Eyebrow label={eyebrow.label} suffix={eyebrow.suffix} /></div>}
        <h1 className="type-heading-5 text-[var(--ink)]">{title}</h1>
        {subtitle && <p data-testid={subtitleTestId} className="type-body mt-1 text-[var(--ink-secondary)]">{subtitle}</p>}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
