"use client";

import { useState } from "react";
import { useMarketEvents } from "@/lib/useMarketEvents";
import { useSetCategoriesVisible } from "@/lib/useEventMutations";

/**
 * The one event filter every chart surface renders. Its state is each category's `visible` flag in
 * the database, so choosing on any chart changes every chart and survives a restart.
 *
 * The button always renders, including while loading and after a failure: a failed request draws
 * no lines, and without the button saying "Events unavailable" that would read as "no events".
 */
export function EventFilter({ testId }: { testId: string }) {
  const { categories, status, visibleCount, refetch } = useMarketEvents();
  const setVisible = useSetCategoriesVisible();
  const [open, setOpen] = useState(false);

  const change = (changes: Array<{ id: string; visible: boolean }>) => {
    if (changes.length > 0) setVisible.mutate(changes);
  };
  const label =
    status === "unavailable" ? "Events unavailable" : status === "loading" ? "Events" : `Events · ${visibleCount} of ${categories.length}`;

  return (
    <div className="relative">
      <button
        type="button"
        data-testid={testId}
        data-status={status}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((isOpen) => !isOpen)}
        className={`rounded-[var(--radius-sm)] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] ${
          status === "unavailable"
            ? "border-[var(--state-warning)] text-[var(--state-warning)]"
            : "border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--surface-muted)]"
        }`}
      >
        {status === "loading" ? <span aria-hidden className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-current" /> : null}
        {label}
      </button>

      {open ? (
        // Not role="dialog": this often sits inside a modal, and a second dialog would make
        // getByRole("dialog") ambiguous for assistive tech as much as for tests.
        <div
          role="group"
          aria-label="Event categories"
          data-testid={`${testId}-popover`}
          className="absolute right-0 z-20 mt-1 w-64 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-xs text-[var(--text-primary)] shadow-lg"
        >
          {status === "unavailable" ? (
            <div className="flex flex-col gap-2">
              <p>Event lines could not be loaded, so none are drawn. The price chart is unaffected.</p>
              <button type="button" data-testid={`${testId}-retry`} onClick={refetch} className="self-start rounded border border-[var(--border)] px-2 py-1 font-semibold">
                Retry
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <button type="button" data-testid={`${testId}-all`} className="rounded border border-[var(--border)] px-2 py-1 font-semibold"
                  onClick={() => change(categories.filter((c) => !c.visible).map((c) => ({ id: c.id, visible: true })))}>
                  All
                </button>
                <button type="button" data-testid={`${testId}-none`} className="rounded border border-[var(--border)] px-2 py-1 font-semibold"
                  onClick={() => change(categories.filter((c) => c.visible).map((c) => ({ id: c.id, visible: false })))}>
                  None
                </button>
              </div>
              <ul className="flex flex-col gap-1">
                {categories.map((category) => (
                  <li key={category.id}>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        data-testid={`${testId}-option-${category.id}`}
                        checked={category.visible}
                        onChange={(event) => change([{ id: category.id, visible: event.target.checked }])}
                      />
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category.color }} />
                      {category.label}
                    </label>
                  </li>
                ))}
              </ul>
              {setVisible.isError ? (
                <p role="alert" data-testid={`${testId}-error`} className="text-[var(--state-warning)]">
                  That change could not be saved, so it was undone.
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
