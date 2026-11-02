"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/locale";

/**
 * "How to read this screen": a closed-by-default panel under the page header. A native <details>,
 * so it needs no state and opens with the keyboard. Spec 2026-11-01 signals guide (phase 1 of the
 * per-tab guides).
 */
export function PageGuide({ children, testId = "page-guide" }: { children: ReactNode; testId?: string }) {
  const t = useT();
  return (
    <details data-testid={testId} className="border border-[var(--line)] bg-[var(--surface-raised)]">
      <summary className="type-label cursor-pointer px-4 py-3 text-[var(--ink)]">{t("guide.summary")}</summary>
      <div className="flex flex-col gap-4 border-t border-[var(--line)] p-4">{children}</div>
    </details>
  );
}

export function GuideSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="type-panel-title text-[var(--ink)]">{title}</h3>
      <div className="type-body flex flex-col gap-1 text-[var(--ink-secondary)]">{children}</div>
    </section>
  );
}
