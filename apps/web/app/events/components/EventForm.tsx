"use client";

import { useState } from "react";
import { EventApiError } from "@/lib/marketEventsApi";
import { useCreateEvent, useUpdateEvent } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";
import type { MarketEventInput } from "../../../../../packages/shared-types";

const inputClass = "rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-transparent px-2 py-1 text-[var(--text-primary)]";

export function EventForm({ categories, editing, onDone }: { categories: EventCategory[]; editing: MarketEvent | null; onDone: () => void }) {
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const [startDate, setStartDate] = useState(editing?.start_date ?? "");
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [category, setCategory] = useState(editing?.category ?? categories[0]?.id ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [source, setSource] = useState(editing?.source ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    // Mirrors the server's own rules so the common mistakes need no round trip; everything else
    // is the server's call, and its message is shown as-is.
    if (!startDate) return setError("A date is required.");
    if (!label.trim()) return setError("A label is required.");
    const input: MarketEventInput = {
      label: label.trim(),
      category,
      start_date: startDate,
      end_date: endDate || null,
      source: source.trim() || null,
      note: note.trim(),
    };
    const onError = (err: unknown) => setError(err instanceof EventApiError ? err.detail : "Could not save the event.");
    if (editing) {
      update.mutate({ id: editing.id, input }, { onError, onSuccess: () => { setError(null); onDone(); } });
    } else {
      create.mutate(input, {
        onError,
        onSuccess: () => {
          setError(null);
          setStartDate(""); setEndDate(""); setLabel(""); setNote(""); setSource("");
        },
      });
    }
  };

  return (
    <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">{editing ? `Edit “${editing.label}”` : "Add an event"}</h2>

      <form data-testid="event-form" onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Date
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          End date
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Label
          <input type="text" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)]">
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] sm:col-span-2">
          Note
          <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} rows={2} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--text-secondary)] sm:col-span-2">
          Source URL
          <input type="url" placeholder="Optional" value={source} onChange={(e) => setSource(e.target.value)} className={inputClass} />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={create.isPending || update.isPending}
            className="rounded-[var(--radius-sm)] bg-[var(--surface)] px-3 py-1 text-sm font-bold text-black disabled:opacity-50">
            {editing ? "Save changes" : "Add event"}
          </button>
          {editing ? (
            <button type="button" onClick={onDone} className="rounded-[var(--radius-sm)] border border-[var(--border)] px-3 py-1 text-sm">
              Cancel
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" data-testid="event-form-error" className="text-sm text-[var(--state-warning)] sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
