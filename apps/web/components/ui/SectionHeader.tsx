import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function SectionHeader({ title, description, actions }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h2
          className="text-[length:var(--type-section-title)] font-semibold leading-snug text-[var(--text-primary)]"
          style={{ letterSpacing: "-0.01em" }}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-0.5 text-[length:var(--type-helper)] text-[var(--text-muted)] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 shrink-0">{actions}</div>
      )}
    </div>
  );
}
