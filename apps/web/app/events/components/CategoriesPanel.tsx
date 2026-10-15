"use client";

import { useMemo, useState } from "react";
import { fieldInputClass } from "@/components/ui/InlineField";
import { formatNumber } from "@/lib/format";
import { tokens } from "@/lib/tokens.generated";
import { useLocale, useT } from "@/lib/i18n/locale";
import { EventApiError } from "@/lib/marketEventsApi";
import { useCreateCategory, useDeleteCategory, usePatchCategory, useResetCategory, useSetCategoriesVisible } from "@/lib/useEventMutations";
import type { EventCategory, MarketEvent } from "@/lib/useMarketEvents";
import type { EventCategoryPatch } from "../../../../../packages/shared-types";

function CategoryRow({ category, usedBy }: { category: EventCategory; usedBy: number }) {
  const t = useT();
  const { locale } = useLocale();
  const [label, setLabel] = useState(category.label);
  const [color, setColor] = useState(category.color.toLowerCase());
  const [error, setError] = useState<string | null>(null);
  const patch = usePatchCategory();
  const reset = useResetCategory();
  const remove = useDeleteCategory();
  const setVisible = useSetCategoriesVisible();
  const dirty = label.trim() !== category.label || color.toLowerCase() !== category.color.toLowerCase();
  const describe = (err: unknown, fallback: string) => (err instanceof EventApiError ? err.detail : fallback);

  return (
    <li data-testid={`category-row-${category.id}`} className="flex flex-wrap items-center gap-2 border-t border-[var(--grid)] py-2 type-body">
      <input type="checkbox" aria-label={t("events.categories.showOnCharts", { label: category.label })} checked={category.visible}
        onChange={(e) => setVisible.mutate([{ id: category.id, visible: e.target.checked }])} />
      {/* A native colour input yields #rrggbb, the one colour form the server accepts. */}
      <input type="color" aria-label={t("events.categories.colour", { label: category.label })} data-testid={`category-color-${category.id}`} value={color} onChange={(e) => setColor(e.target.value)} />
      <div className="min-w-[10rem] flex-1">
        <input type="text" aria-label={t("events.categories.name", { label: category.label })} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)}
          className={fieldInputClass} />
      </div>
      <button type="button" data-testid={`category-save-${category.id}`} disabled={!dirty || patch.isPending}
        onClick={() => {
          const patchBody: EventCategoryPatch = {};
          if (label.trim() !== category.label) patchBody.label = label.trim();
          if (color.toLowerCase() !== category.color.toLowerCase()) patchBody.color = color;
          patch.mutate({ id: category.id, patch: patchBody }, { onError: (err) => setError(describe(err, t("events.categories.saveFailed"))), onSuccess: () => setError(null) });
        }}
        className="type-label rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-1 disabled:opacity-40">
        {t("events.categories.save")}
      </button>
      {category.origin === "builtin" && category.overridden ? (
        <button type="button" data-testid={`category-reset-${category.id}`} onClick={() => reset.mutate(category.id, { onError: (err) => setError(describe(err, t("events.categories.resetFailed"))) })}
          className="type-label rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-1">
          {t("events.categories.resetDefault")}
        </button>
      ) : null}
      {category.origin === "user" ? (
        <button type="button" data-testid={`category-delete-${category.id}`} disabled={usedBy > 0}
          onClick={() => remove.mutate(category.id, { onError: (err) => setError(describe(err, t("events.categories.deleteFailed"))) })}
          className="type-label rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-1 disabled:opacity-40">
          {usedBy > 0 ? t("events.categories.deleteUsed", { count: formatNumber(usedBy, "integer", { locale }) }) : t("events.categories.delete")}
        </button>
      ) : (
        <span className="type-caption text-[var(--ink-muted)]">{t("events.categories.builtIn")}</span>
      )}
      {error ? <p role="alert" className="w-full type-caption text-[var(--status-warning-ink)]">{error}</p> : null}
    </li>
  );
}

function AddCategoryRow() {
  const t = useT();
  const [label, setLabel] = useState("");
  const [color, setColor] = useState<string>(tokens.chart["2"]);
  const [error, setError] = useState<string | null>(null);
  const create = useCreateCategory();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-[var(--grid)] pt-3 type-body">
      <input type="color" aria-label={t("events.categories.newColour")} data-testid="category-add-color" value={color} onChange={(e) => setColor(e.target.value)} />
      <div className="min-w-[10rem] flex-1">
        <input type="text" aria-label={t("events.categories.newName")} data-testid="category-add-label" placeholder={t("events.categories.newPlaceholder")} maxLength={120} value={label} onChange={(e) => setLabel(e.target.value)}
          className={fieldInputClass} />
      </div>
      <button type="button" data-testid="category-add" disabled={!label.trim() || create.isPending}
        onClick={() => create.mutate({ label: label.trim(), color }, { onError: (err) => setError(err instanceof EventApiError ? err.detail : t("events.categories.addFailed")), onSuccess: () => { setLabel(""); setError(null); } })}
        className="type-label rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-1 disabled:opacity-40">
        {t("events.categories.add")}
      </button>
      {error ? <p role="alert" className="w-full type-caption text-[var(--status-warning-ink)]">{error}</p> : null}
    </div>
  );
}

export function CategoriesPanel({ categories, events }: { categories: EventCategory[]; events: MarketEvent[] }) {
  const t = useT();
  // Only the user's own events block a delete: file and rule events can only name built-ins.
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const event of events) if (event.origin === "user") counts.set(event.category, (counts.get(event.category) ?? 0) + 1);
    return counts;
  }, [events]);

  return (
    <section data-testid="categories-panel" className="border border-[var(--line)] bg-[var(--surface-raised)] p-5">
      <h2 className="type-panel-title text-[var(--ink)]">{t("events.categoriesTitle")}</h2>
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
