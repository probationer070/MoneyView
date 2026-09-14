"use client";

/**
 * Shared markup for the "Market events" button that appears beside every chart surface that
 * can overlay dated event lines. Each caller owns its own `showEvents` state and its own
 * conditional rendering (`lines.length > 0 ? ... : null`) -- this component stays a plain,
 * stateless button so it does not dictate when a surface has anything to toggle.
 */
export function EventsToggle({
  pressed,
  onToggle,
  testId,
}: {
  pressed: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={pressed}
      data-testid={testId}
      className={`rounded-[var(--radius-sm)] border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] ${
        pressed
          ? "border-[var(--state-warning)] text-[var(--state-warning)]"
          : "border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      }`}
    >
      Market events
    </button>
  );
}
