"use client";

import type { EventLineSpec } from "@/components/charts/primitives/EventLinesPrimitive";
import { eventProvenance } from "@/lib/eventLines";

const TOOLTIP_WIDTH = 256;
const GAP = 12;

/**
 * What the lines under the pointer are. Pointer-transparent, because it follows the pointer; the
 * source is shown as its host, and the Events page is where it can be followed.
 */
export function EventTooltip({ x, width, events }: { x: number; width: number; events: EventLineSpec[] }) {
  // Flip left near the right edge so it never overflows the chart.
  const left = x + GAP + TOOLTIP_WIDTH > width ? Math.max(0, x - GAP - TOOLTIP_WIDTH) : x + GAP;
  return (
    <div
      role="tooltip"
      data-testid="event-tooltip"
      className="pointer-events-none absolute top-2 z-10 flex flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] p-2 text-xs text-[var(--text-primary)] shadow-lg"
      style={{ width: TOOLTIP_WIDTH, left }}
    >
      {events.map((event) => (
        <div key={event.id} data-testid={`event-tooltip-item-${event.id}`}>
          <div className="flex items-center gap-2 font-bold">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
            {event.label}
          </div>
          <div className="text-[var(--text-secondary)]">
            {event.endDate ? `${event.date} – ${event.endDate}` : event.date}
            {event.categoryLabel ? ` · ${event.categoryLabel}` : ""}
          </div>
          {event.note ? <p className="mt-1">{event.note}</p> : null}
          <p className="mt-1 text-[var(--text-secondary)]">{eventProvenance(event)}</p>
        </div>
      ))}
    </div>
  );
}
