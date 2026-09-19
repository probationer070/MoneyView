"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { useDevMonitorPageLoad } from "@/hooks/useDevMonitorPageLoad";
import { useMarketEvents, type MarketEvent } from "@/lib/useMarketEvents";
import { CategoriesPanel } from "./components/CategoriesPanel";
import { EventForm } from "./components/EventForm";
import { EventsTable } from "./components/EventsTable";

export default function EventsPage() {
  useDevMonitorPageLoad({ component: "events_page" });
  const { events, categories, status, refetch } = useMarketEvents();
  const [editing, setEditing] = useState<MarketEvent | null>(null);

  return (
    <div className="p-6">
      <PageHeader
        title="Events"
        subtitle="Dated events drawn on every price chart. Built-in events come from sourced data files; the ones you add stay on this machine."
      />
      {status === "loading" ? <p className="text-sm text-[var(--text-muted)]">Loading events…</p> : null}
      {status === "unavailable" ? (
        <div role="alert" className="rounded-[var(--radius)] border border-[var(--state-warning)] p-4 text-sm">
          Events could not be loaded.{" "}
          <button type="button" onClick={refetch} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : null}
      {status === "ready" ? (
        <div className="flex flex-col gap-6">
          {/* Keyed by the event being edited, so switching events resets the form's fields. */}
          <EventForm key={editing?.id ?? "new"} categories={categories} editing={editing} onDone={() => setEditing(null)} />
          <CategoriesPanel categories={categories} events={events} />
          <EventsTable events={events} categories={categories} onEdit={setEditing} />
        </div>
      ) : null}
    </div>
  );
}
