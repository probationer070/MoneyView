"use client";

import { useMemo, useState } from "react";
import { EventApiError } from "@/lib/marketEventsApi";
import { useDeleteEvent } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";

type OriginFilter = "all" | "builtin" | "rule" | "user" | "computed" | "needs-category";

const ORIGIN_LABEL: Record<MarketEvent["origin"], string> = { builtin: "Built-in", rule: "Rule", user: "Added by you", computed: "Computed from prices" };

function host(source: string): string {
  try {
    return new URL(source).host;
  } catch {
    return source;
  }
}

export function EventsTable({ events, categories, onEdit }: { events: MarketEvent[]; categories: EventCategory[]; onEdit: (event: MarketEvent) => void }) {
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState<OriginFilter>("all");
  const [confirming, setConfirming] = useState<string | null>(null);
  const deleteEvent = useDeleteEvent();
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const rows = useMemo(
    () =>
      events
        .filter((e) => categoryFilter === "all" || e.category === categoryFilter)
        .filter((e) => (originFilter === "all" ? true : originFilter === "needs-category" ? e.missing_category !== null : e.origin === originFilter))
        .sort((a, b) => b.start_date.localeCompare(a.start_date) || a.id.localeCompare(b.id)),
    [events, categoryFilter, originFilter],
  );

  return (
    <section data-testid="events-table" className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="mr-auto text-sm font-bold text-[var(--text-primary)]">All events</h2>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Filter by category
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className="rounded border border-[var(--border-default)] px-2 py-1">
            <option value="all">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Filter by origin
          <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} className="rounded border border-[var(--border-default)] px-2 py-1">
            <option value="all">All origins</option>
            <option value="builtin">Built-in</option>
            <option value="rule">Rule</option>
            <option value="user">Added by you</option>
            <option value="computed">Computed from prices</option>
            <option value="needs-category">Needs category</option>
          </select>
        </label>
      </div>
      {deleteEvent.isError ? (
        <p role="alert" className="mt-2 text-sm text-[var(--state-warning)]">
          {deleteEvent.error instanceof EventApiError ? deleteEvent.error.detail : "Could not delete the event."}
        </p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-[var(--text-secondary)]">
            <tr><th className="py-1 pr-3">Date</th><th className="pr-3">Event</th><th className="pr-3">Category</th><th className="pr-3">Origin</th><th className="pr-3">Source</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              const category = byId.get(event.category);
              return (
                <tr key={event.id} data-testid={`event-row-${event.id}`} className="border-t border-[var(--border)] align-top">
                  <td className="py-2 pr-3 tabular-nums">{event.end_date ? `${event.start_date} – ${event.end_date}` : event.start_date}</td>
                  <td className="pr-3">
                    <span className="font-semibold text-[var(--text-primary)]">{event.label}</span>
                    {event.note ? <span className="block text-xs text-[var(--text-secondary)]">{event.note}</span> : null}
                  </td>
                  <td className="pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category?.color }} />
                      {category?.label ?? event.category}
                    </span>
                    {event.missing_category ? (
                      <span data-testid={`event-missing-category-${event.id}`} className="block text-xs text-[var(--state-warning)]">
                        category removed ({event.missing_category}), choose a new one
                      </span>
                    ) : null}
                  </td>
                  <td className="pr-3">{ORIGIN_LABEL[event.origin]}</td>
                  <td className="pr-3">
                    {event.source ? <a href={event.source} target="_blank" rel="noreferrer" className="underline">{host(event.source)}</a> : "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    {event.origin === "user" ? (
                      <span className="flex gap-2">
                        <button type="button" data-testid={`event-edit-${event.id}`} onClick={() => onEdit(event)} className="underline">Edit</button>
                        {confirming === event.id ? (
                          <button type="button" data-testid={`event-delete-confirm-${event.id}`} className="font-semibold text-[var(--state-warning)] underline"
                            onClick={() => deleteEvent.mutate(event.id, { onSettled: () => setConfirming(null) })}>
                            Confirm delete
                          </button>
                        ) : (
                          <button type="button" data-testid={`event-delete-${event.id}`} onClick={() => setConfirming(event.id)} className="underline">Delete</button>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-muted)]">{event.origin === "computed" ? "from cached prices" : "from a data file"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
