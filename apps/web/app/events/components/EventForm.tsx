"use client";

import { useState } from "react";
import { fieldInputClass } from "@/components/ui/InlineField";
import { useT } from "@/lib/i18n/locale";
import { EventApiError } from "@/lib/marketEventsApi";
import { useCreateEvent, useUpdateEvent } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";
import type { MarketEventInput } from "../../../../../packages/shared-types";

export function EventForm({ categories, editing, onDone }: { categories: EventCategory[]; editing: MarketEvent | null; onDone: () => void }) {
  const t = useT();
  const create = useCreateEvent();
  const update = useUpdateEvent();
  const [startDate, setStartDate] = useState(editing?.start_date ?? "");
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [label, setLabel] = useState(editing?.label ?? "");
  const [category, setCategory] = useState(
    editing?.category ?? categories.find((c) => c.id === "uncategorized")?.id ?? categories[0]?.id ?? "",
  );
  const [note, setNote] = useState(editing?.note ?? "");
  const [source, setSource] = useState(editing?.source ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (formEvent: React.FormEvent<HTMLFormElement>) => {
    formEvent.preventDefault();
    // Mirrors the server's own rules so the common mistakes need no round trip; everything else
    // is the server's call, and its message is shown as-is.
    if (!startDate) return setError(t("events.form.needDate"));
    if (!label.trim()) return setError(t("events.form.needLabel"));
    const input: MarketEventInput = {
      label: label.trim(),
      category,
      start_date: startDate,
      end_date: endDate || null,
      source: source.trim() || null,
      note: note.trim(),
    };
    const onError = (err: unknown) => setError(err instanceof EventApiError ? err.detail : t("events.form.saveFailed"));
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
    <section className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <h2 className="type-panel-title text-[var(--ink)]">{editing ? t("events.form.editTitle", { label: editing.label }) : t("events.form.addTitle")}</h2>

      <form data-testid="event-form" onSubmit={submit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
          {t("events.form.date")}
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={fieldInputClass} />
        </label>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
          {t("events.form.endDate")}
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={fieldInputClass} />
        </label>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
          {t("events.form.label")}
          <input type="text" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)} className={fieldInputClass} />
        </label>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)]">
          {t("events.form.category")}
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={fieldInputClass}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)] sm:col-span-2">
          {t("events.form.note")}
          <textarea maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={`${fieldInputClass} min-h-[4.5rem] py-2`} rows={2} />
        </label>
        <label className="flex flex-col gap-1 type-small text-[var(--ink-secondary)] sm:col-span-2">
          {t("events.form.sourceUrl")}
          <input type="url" placeholder={t("events.form.optional")} value={source} onChange={(e) => setSource(e.target.value)} className={fieldInputClass} />
        </label>
        <div className="flex items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={create.isPending || update.isPending}
            className="type-label rounded-[var(--radius-1)] bg-[var(--brand)] px-3 py-1 text-[var(--on-brand)] disabled:opacity-50">
            {editing ? t("events.form.save") : t("events.form.add")}
          </button>
          {editing ? (
            <button type="button" onClick={onDone} className="type-label rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-1">
              {t("events.form.cancel")}
            </button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" data-testid="event-form-error" className="type-body text-[var(--status-warning-ink)] sm:col-span-2">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
