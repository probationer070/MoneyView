"use client";

import type { ReactNode } from "react";

type TimelineItem = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  content?: ReactNode;
  actions?: ReactNode;
  active?: boolean;
};

type TimelineGroup = {
  id: string;
  label: string;
  items: TimelineItem[];
};

interface TimelineListProps {
  groups: TimelineGroup[];
  empty?: ReactNode;
}

export function TimelineList({ groups, empty }: TimelineListProps) {
  if (groups.length === 0) {
    return empty ? <>{empty}</> : null;
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.id} className="space-y-3">
          <div className="sticky top-0 z-10 inline-flex rounded-full border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1 text-xs font-semibold text-[var(--text-muted)]">
            {group.label}
          </div>
          <div className="space-y-4">
            {group.items.map((item, index) => {
              const isLast = index === group.items.length - 1;

              return (
                <div key={item.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
                  <div className="relative flex justify-center">
                    <span className={`mt-1 h-3 w-3 rounded-full border-2 border-[var(--bg-surface)] ${item.active ? "bg-[var(--accent)]" : "bg-[var(--text-muted)]/40"}`} />
                    {!isLast ? (
                      <span className="absolute top-5 bottom-[-1rem] w-px bg-[var(--border)]" />
                    ) : null}
                  </div>
                  <article className={`rounded-[var(--radius)] border px-4 py-4 ${item.active ? "border-[var(--accent)] bg-[var(--surface-muted)]/40" : "border-[var(--border)] bg-[var(--bg-surface)]"}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <h3 className="text-sm font-bold text-[var(--text-primary)]">{item.title}</h3>
                        {item.subtitle ? (
                          <p className="text-xs text-[var(--text-muted)]">{item.subtitle}</p>
                        ) : null}
                        {item.meta ? (
                          <div className="pt-1 text-xs text-[var(--text-muted)]">{item.meta}</div>
                        ) : null}
                      </div>
                      {item.actions ? (
                        <div className="flex shrink-0 flex-wrap gap-2">{item.actions}</div>
                      ) : null}
                    </div>
                    {item.content ? <div className="mt-3">{item.content}</div> : null}
                  </article>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
