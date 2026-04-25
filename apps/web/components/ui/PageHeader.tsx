import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium tracking-wide uppercase text-[var(--text-muted)] mb-1">
            {eyebrow}
          </p>
        )}
        <h1
          className="text-[length:var(--type-page-title)] font-bold leading-tight tracking-tight text-[var(--text-primary)]"
          style={{ letterSpacing: "-0.015em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-[length:var(--type-body)] text-[var(--text-secondary)] leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 pt-1 sm:w-auto sm:shrink-0 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
