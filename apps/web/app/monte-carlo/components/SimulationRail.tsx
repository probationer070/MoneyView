"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { useT } from "@/lib/i18n/locale";

// The input rail: fields scroll, the actions stay pinned under them. Below lg the fields collapse behind one
// toggle and the actions sit beside it, so Run is always on screen. The actions are rendered once.
export function SimulationRail({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  const t = useT();
  const inputsId = useId();
  const [expanded, setExpanded] = useState(false);

  return (
    <aside
      data-testid="mc-rail"
      className="flex shrink-0 flex-wrap items-center gap-2 lg:w-[var(--component-rail-width)] lg:flex-col lg:flex-nowrap lg:items-stretch"
    >
      <button
        type="button"
        data-testid="mc-rail-toggle"
        aria-expanded={expanded}
        aria-controls={inputsId}
        onClick={() => setExpanded((open) => !open)}
        className="order-1 inline-flex h-[var(--component-button-height-md)] items-center gap-2 rounded-[var(--radius-1)] border border-[var(--line-strong)] px-3 type-label text-[var(--ink)] lg:hidden"
      >
        {t("monteCarlo.rail.inputs")}
        <ChevronDown aria-hidden="true" className={clsx("h-4 w-4", expanded && "rotate-180")} />
      </button>
      <div data-testid="mc-rail-actions" className="order-2 flex min-w-0 flex-1 shrink-0 gap-2 lg:order-3 lg:w-full lg:flex-none">
        {actions}
      </div>
      <div
        id={inputsId}
        data-testid="mc-rail-inputs"
        className={clsx(
          "order-3 max-h-[40dvh] min-h-0 w-full flex-1 flex-col gap-3 overflow-auto border border-[var(--line)] bg-[var(--surface-raised)] p-3 lg:order-2 lg:flex lg:max-h-none",
          expanded ? "flex" : "hidden",
        )}
      >
        {children}
      </div>
    </aside>
  );
}
