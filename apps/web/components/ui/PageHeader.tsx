import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-medium tracking-wide uppercase text-[var(--text-muted)] mb-1">
            {eyebrow}
          </p>
        )}
        <h1
          className="text-[28px] font-bold leading-tight tracking-tight text-[var(--text-primary)]"
          style={{ letterSpacing: "-0.015em" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--text-secondary)] leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0 pt-1">{actions}</div>
      )}
    </div>
  );
}
