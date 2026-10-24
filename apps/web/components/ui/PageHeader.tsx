import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/Eyebrow";
import type { LabelKey } from "@/lib/i18n/labels";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  eyebrow?: { label: LabelKey; suffix?: string };
  actions?: ReactNode;
  subtitleTestId?: string;
  /** Beside the subtitle on wide screens, under it on narrow ones (the corporate verdict strip). */
  subtitleAside?: ReactNode;
  /** A 12px gap under the header instead of 24px, for a one-screen page short of height (the market overview). */
  tight?: boolean;
}

export function PageHeader({ title, subtitle, eyebrow, actions, subtitleTestId, subtitleAside, tight = false }: PageHeaderProps) {
  return (
    <div className={`${tight ? "mb-3" : "mb-6"} flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between`}>
      <div className="min-w-0">
        {eyebrow && <div className="mb-2"><Eyebrow label={eyebrow.label} suffix={eyebrow.suffix} /></div>}
        <h1 className="type-heading-5 text-[var(--ink)]">{title}</h1>
        {/* The plain subtitle is kept as it was, so pages without a subtitleAside render the same DOM. */}
        {subtitle && !subtitleAside && <p data-testid={subtitleTestId} className="type-body mt-1 text-[var(--ink-secondary)]">{subtitle}</p>}
        {subtitleAside && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            {subtitle && <p data-testid={subtitleTestId} className="type-body text-[var(--ink-secondary)]">{subtitle}</p>}
            {subtitleAside}
          </div>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
