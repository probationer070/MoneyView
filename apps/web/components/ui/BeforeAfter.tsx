import type { ReactNode } from "react";

interface BeforeAfterProps {
  /** The text shown before the change; null when there was none. */
  previous: string | null;
  current: ReactNode;
}

// previous -> current. The old value is struck through (a drawn line, not text-decoration, so it can
// animate) and the arrow keeps the order readable without colour. Keyed on the old text so each new
// change replays the fade and the draw.
export function BeforeAfter({ previous, current }: BeforeAfterProps) {
  if (previous === null) return <>{current}</>;
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span key={previous} data-part="previous" className="mv-ba-old">
        {previous}
        <span data-part="strike" aria-hidden="true" className="mv-ba-strike" />
      </span>
      <span aria-hidden="true">→</span>
      <span data-part="current">{current}</span>
    </span>
  );
}
