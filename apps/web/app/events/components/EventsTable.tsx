"use client";

import { useMemo, useState } from "react";
import { fieldInputClass } from "@/components/ui/InlineField";
import { BilingualLabel } from "@/components/ui/BilingualLabel";
import { useT } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/translate";
import { EventApiError } from "@/lib/marketEventsApi";
import { useDeleteEvent } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";

type OriginFilter = "all" | "builtin" | "rule" | "user" | "computed" | "needs-category";

const ORIGIN_KEY: Record<MarketEvent["origin"], MessageKey> = {
  builtin: "events.origin.builtin",
  rule: "events.origin.rule",
  user: "events.origin.user",
  computed: "events.origin.computed",
};

function host(source: string): string {
  try {
    return new URL(source).host;
  } catch {
    return source;
  }
}

export function EventsTable({ events, categories, onEdit }: { events: MarketEvent[]; categories: EventCategory[]; onEdit: (event: MarketEvent) => void }) {
  const t = useT();
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
    <section data-testid="events-table" className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <div className="flex flex-wrap items-end gap-3">
        <h2 className="type-panel-title mr-auto text-[var(--ink)]">{t("events.eventsTitle")}</h2>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
          {t("events.filterCategory")}
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={fieldInputClass}>
            <option value="all">{t("events.allCategories")}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
          {t("events.filterOrigin")}
          <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value as OriginFilter)} className={fieldInputClass}>
            <option value="all">{t("events.allOrigins")}</option>
            <option value="builtin">{t("events.origin.builtin")}</option>
            <option value="rule">{t("events.origin.rule")}</option>
            <option value="user">{t("events.origin.user")}</option>
            <option value="computed">{t("events.origin.computed")}</option>
            <option value="needs-category">{t("events.origin.needsCategory")}</option>
          </select>
        </label>
      </div>
      {deleteEvent.isError ? (
        <p role="alert" className="mt-2 type-body text-[var(--status-warning-ink)]">
          {deleteEvent.error instanceof EventApiError ? deleteEvent.error.detail : t("events.deleteFailed")}
        </p>
      ) : null}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left type-body">
          <thead className="type-caption text-[var(--ink-secondary)]">
            <tr>
              <th className="py-1 pr-3 text-left"><BilingualLabel k="date" /></th>
              <th className="pr-3 text-left"><BilingualLabel k="event" /></th>
              <th className="pr-3 text-left"><BilingualLabel k="category" /></th>
              <th className="pr-3 text-left"><BilingualLabel k="origin" /></th>
              <th className="pr-3 text-left"><BilingualLabel k="source" /></th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((event) => {
              const category = byId.get(event.category);
              return (
                <tr key={event.id} data-testid={`event-row-${event.id}`} className="border-t border-[var(--grid)] align-top">
                  <td className="py-2 pr-3 type-mono">{event.end_date ? `${event.start_date} – ${event.end_date}` : event.start_date}</td>
                  <td className="pr-3">
                    <span className="type-label text-[var(--ink)]">{event.label}</span>
                    {event.note ? <span className="block type-small text-[var(--ink-muted)]">{event.note}</span> : null}
                  </td>
                  <td className="pr-3">
                    <span className="inline-flex items-center gap-2">
                      {/* rounded-full: dot */}
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: category?.color }} />
                      {category?.label ?? event.category}
                    </span>
                    {event.missing_category ? (
                      <span data-testid={`event-missing-category-${event.id}`} className="block type-caption text-[var(--status-warning-ink)]">
                        {t("events.missingCategory", { category: event.missing_category })}
                      </span>
                    ) : null}
                  </td>
                  <td className="pr-3">{t(ORIGIN_KEY[event.origin])}</td>
                  <td className="pr-3">
                    {event.source ? <a href={event.source} target="_blank" rel="noreferrer" className="underline">{host(event.source)}</a> : "—"}
                  </td>
                  <td className="whitespace-nowrap">
                    {event.origin === "user" ? (
                      <span className="flex gap-2">
                        <button type="button" data-testid={`event-edit-${event.id}`} onClick={() => onEdit(event)} className="underline">{t("events.edit")}</button>
                        {confirming === event.id ? (
                          <button type="button" data-testid={`event-delete-confirm-${event.id}`} className="type-label text-[var(--status-warning-ink)] underline"
                            onClick={() => deleteEvent.mutate(event.id, { onSettled: () => setConfirming(null) })}>
                            {t("events.confirmDelete")}
                          </button>
                        ) : (
                          <button type="button" data-testid={`event-delete-${event.id}`} onClick={() => setConfirming(event.id)} className="underline">{t("events.delete")}</button>
                        )}
                      </span>
                    ) : (
                      <span className="type-caption text-[var(--ink-muted)]">{event.origin === "computed" ? t("events.fromCachedPrices") : t("events.fromDataFile")}</span>
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
