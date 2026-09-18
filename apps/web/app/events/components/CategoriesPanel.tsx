"use client";

import { useMemo, useState } from "react";
import { EventApiError } from "@/lib/marketEventsApi";
import { useCreateCategory, useDeleteCategory, usePatchCategory, useResetCategory, useSetCategoriesVisible } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";

const describe = (err: unknown, fallback: string) => (err instanceof EventApiError ? err.detail : fallback);

function CategoryRow({ category, usedBy }: { category: EventCategory; usedBy: number }) {
  const [label, setLabel] = useState(category.label);
  const [color, setColor] = useState(category.color.toLowerCase());
  const [error, setError] = useState<string | null>(null);
  const patch = usePatchCategory();
  const reset = useResetCategory();
  const remove = useDeleteCategory();
  const setVisible = useSetCategoriesVisible();
  const dirty = label.trim() !== category.label || color.toLowerCase() !== category.color.toLowerCase();

  return (
    <li data-testid={`category-row-${category.id}`} className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-2 text-sm">
      <input type="checkbox" aria-label={`Show ${category.label} on charts`} checked={category.visible}
        onChange={(e) => setVisible.mutate([{ id: category.id, visible: e.target.checked }])} />
      {/* A native colour input yields #rrggbb, the one colour form the server accepts. */}
      <input type="color" aria-label={`${category.label} colour`} data-testid={`category-color-${category.id}`} value={color} onChange={(e) => setColor(e.target.value)} />
      <input type="text" aria-label={`${category.label} name`} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1" />
      <button type="button" data-testid={`category-save-${category.id}`} disabled={!dirty || patch.isPending}
        onClick={() => patch.mutate({ id: category.id, patch: { label: label.trim(), color } }, { onError: (err) => setError(describe(err, "Could not save.")), onSuccess: () => setError(null) })}
        className="rounded border border-[var(--border)] px-2 py-1 font-semibold disabled:opacity-40">
        Save
      </button>
      {category.origin === "builtin" && category.overridden ? (
        <button type="button" data-testid={`category-reset-${category.id}`} onClick={() => reset.mutate(category.id, { onError: (err) => setError(describe(err, "Could not reset.")) })}
          className="rounded border border-[var(--border)] px-2 py-1">
          Reset to default
        </button>
      ) : null}
      {category.origin === "user" ? (
        <button type="button" data-testid={`category-delete-${category.id}`} disabled={usedBy > 0}
          onClick={() => remove.mutate(category.id, { onError: (err) => setError(describe(err, "Could not delete.")) })}
          className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-40">
          {usedBy > 0 ? `Delete (used by ${usedBy})` : "Delete"}
        </button>
      ) : (
        <span className="text-xs text-[var(--text-muted)]">built-in</span>
      )}
      {error ? <p role="alert" className="w-full text-xs text-[var(--state-warning)]">{error}</p> : null}
    </li>
  );
}

function AddCategoryRow() {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("#4589e5");
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCategory();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 text-sm">
      <input type="color" aria-label="New category colour" data-testid="category-add-color" value={color} onChange={(e) => setColor(e.target.value)} />
      <input type="text" aria-label="New category name" data-testid="category-add-label" placeholder="New category" maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--border-default)] px-2 py-1" />
      <button type="button" data-testid="category-add" disabled={!label.trim() || create.isPending}
        onClick={() => create.mutate({ label: label.trim(), color }, { onError: (err) => setError(describe(err, "Could not add the category.")), onSuccess: () => { setLabel(""); setError(null); } })}
        className="rounded border border-[var(--border)] px-2 py-1 font-semibold disabled:opacity-40">
        Add category
      </button>
      {error ? <p role="alert" className="w-full text-xs text-[var(--state-warning)]">{error}</p> : null}
    </div>
  );
}

export function CategoriesPanel({ categories, events }: { categories: EventCategory[]; events: MarketEvent[] }) {
  // Only the user's own events block a delete: file and rule events can only name built-ins.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) if (event.origin === "user") counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
    return counts;
  }, [events]);

  return (
    <section data-testid="categories-panel" className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h2 className="text-sm font-bold text-[var(--text-primary)]">Categories</h2>
      <ul className="mt-2">
        {categories.map((category) => (
          // Keyed on the saved values too, so a successful save or reset resets the row's local fields.
          <CategoryRow key={`${category.id}:${category.label}:${category.color}`} category={category} usedBy={usage.get(category.id) ?? 0} />
        ))}
      </ul>
      <AddCategoryRow />
    </section>
  );
}
