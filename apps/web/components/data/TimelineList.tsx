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
          <div className="sticky top-0 z-10 inline-flex rounded-full border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-1 type-small text-[var(--ink-muted)]">
            {group.label}
          </div>
          <div className="space-y-4">
            {group.items.map((item, index) => {
              const isLast = index === group.items.length - 1;

              return (
                <div key={item.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
                  <div className="relative flex justify-center">
                    <span className={`mt-1 h-3 w-3 rounded-full border-2 border-[var(--surface-raised)] ${item.active ? "bg-[var(--brand)]" : "bg-[var(--line)]"}`} />
                    {!isLast ? (
                      <span className="absolute top-5 bottom-[-1rem] w-px bg-[var(--line)]" />
                    ) : null}
                  </div>
                  <article className={`border px-4 py-4 ${item.active ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--line)] bg-[var(--surface-raised)]"}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 space-y-1">
                        <h3 className="type-body text-[var(--ink)]">{item.title}</h3>
                        {item.subtitle ? (
                          <p className="type-small text-[var(--ink-muted)]">{item.subtitle}</p>
                        ) : null}
                        {item.meta ? (
                          <div className="pt-1 type-small text-[var(--ink-muted)]">{item.meta}</div>
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
