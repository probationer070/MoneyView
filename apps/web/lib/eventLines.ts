import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import type { EventCategory, MarketEvent } from "../../../packages/shared-types";

/**
 * Events plus categories become the lines a chart draws: only visible categories, each line in
 * its category's colour. Charts never see categories -- they draw whatever EventLineSpec[] they
 * are handed, so any caller can pass lines of its own.
 */
export function buildEventLines(events: readonly MarketEvent[], categories: readonly EventCategory[]): EventLineSpec[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const lines: EventLineSpec[] = [];
  for (const event of events) {
    const category = byId.get(event.category);
    // The server resolves every event's category, so a miss means the two responses disagree
    // (one is stale). Drawing it in a made-up colour would assert a category it does not have.
    if (!category || !category.visible) continue;
    lines.push({
      id: event.id,
      label: event.label,
      date: event.start_date,
      endDate: event.end_date,
      color: category.color,
      categoryLabel: category.label,
      note: event.note,
      source: event.source,
      origin: event.origin,
    });
  }
  return lines;
}

function sourceHost(source: string | null | undefined): string | null {
  if (!source) return null;
  try {
    return new URL(source).host;
  } catch {
    return null;
  }
}

/** The tooltip's provenance line. A user's own unsourced event must never read as a checked one. */
export function eventProvenance(event: EventLineSpec): string {
  const host = sourceHost(event.source);
  if (event.origin === "user") return host ? `Added by you · Source: ${host}` : "Added by you, no source";
  if (event.origin === "computed") return "Computed from cached prices, no source";
  return host ? `Source: ${host}` : "No source";
}
