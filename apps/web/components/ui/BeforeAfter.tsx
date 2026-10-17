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
      <del key={previous} data-part="previous" className="mv-ba-old no-underline">
        {previous}
        <span data-part="strike" aria-hidden="true" className="mv-ba-strike" />
      </del>
      <span aria-hidden="true">→</span>
      <ins data-part="current" className="no-underline">{current}</ins>
    </span>
  );
}
