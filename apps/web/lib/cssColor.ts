/**
 * Turn a CSS colour expression into something a canvas can actually paint.
 *
 * `lightweight-charts` draws to a canvas, and a canvas cannot resolve custom properties:
 * assigning an invalid colour is silently ignored, leaving the previous value, which for
 * a fresh context is black. Every candlestick surface passed `var(--delta-up)` straight
 * through, so the candles rendered black -- while `detail/[ticker]` passed literal hex and
 * looked fine, which is why the symptom read as inconsistent rather than broken.
 *
 * Nothing here validates colours in general. It resolves `var(--name)` (with or without a
 * fallback) against the document, and passes anything else through untouched, because a
 * hex or rgb() string is already paintable.
 */

/** Matches `var(--name)` and `var(--name, fallback)`, capturing both parts. */
const VAR_PATTERN = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/;

export function resolveCssColor(value: string, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;

  const match = VAR_PATTERN.exec(trimmed);
  if (!match) return trimmed;

  const [, name, inlineFallback] = match;

  // Server-side there is no document to read, and the chart only mounts in the browser.
  // Returning the fallback keeps this callable from anywhere without a guard at each site.
  if (typeof window === "undefined" || typeof document === "undefined") {
    return (inlineFallback ?? fallback).trim();
  }

  let resolved = "";
  try {
    resolved = window
      .getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  } catch {
    // Some embedded contexts throw rather than return empty. Either way the answer is the
    // fallback, and a chart that fails to colour itself must never fail to render.
    resolved = "";
  }

  // An undefined custom property resolves to the empty string, not to an error -- which is
  // exactly how this defect stayed invisible. Treat empty as "not defined".
  if (resolved) return resolved;
  return (inlineFallback ?? fallback).trim();
}
