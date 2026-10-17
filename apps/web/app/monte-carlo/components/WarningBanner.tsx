"use client";

import { useId, useState } from "react";
import { useT } from "@/lib/i18n/locale";

// One warning shows in full; several start collapsed behind a count and a toggle.
export function WarningBanner({ title, warnings }: { title: string; warnings: string[] }) {
  const t = useT();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  if (warnings.length === 0) return null;
  const collapsible = warnings.length > 1;
  const open = !collapsible || expanded;

  return (
    <div
      data-testid="mc-warnings"
      className="shrink-0 border border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] px-3 py-2 type-small text-[var(--status-warning-ink)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="type-label">{title}</span>
        {collapsible ? (
          <span className="flex items-center gap-2">
            <span>{t("monteCarlo.warnings.count", { count: warnings.length })}</span>
            <button
              type="button"
              data-testid="mc-warnings-toggle"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((value) => !value)}
              className="underline"
            >
              {t(expanded ? "monteCarlo.warnings.hide" : "monteCarlo.warnings.show")}
            </button>
          </span>
        ) : null}
      </div>
      {open ? (
        <ul id={listId} className="mt-1 list-disc space-y-1 pl-5">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
