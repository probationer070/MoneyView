"use client";

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { X } from "lucide-react";

/**
 * How wide a panel opens, chosen by what its body actually needs to render.
 *
 * Every panel used to share one `max-w-[480px]` cap. Both table bodies declare
 * `min-w-[1120px]` (`PortfolioAllocationEditor.tsx:145`, `page.tsx:468`), so in a 480px
 * column they scrolled horizontally and showed under half their columns -- weights and
 * status were off-screen, and the controls were unreachable without scrolling first.
 *
 * The clamp leaves room for the 3.5rem rail plus a margin, so a wide panel never covers
 * the whole viewport on a smaller screen. Below `lg` every panel is full-width: a 1184px
 * slide-over on a narrow window would cover everything anyway, so it does so deliberately.
 *
 * Written as complete literal class strings because Tailwind scans for those; an
 * interpolated width would compile to nothing.
 */
const PANEL_WIDTHS = {
  /** Prose and a few figures. */
  narrow: "lg:w-[min(35rem,calc(100vw-4rem))]",
  /** Stacked sections, no wide table. */
  wide: "lg:w-[min(45rem,calc(100vw-4rem))]",
  /** A `min-w-[1120px]` table. */
  widest: "lg:w-[min(74rem,calc(100vw-4rem))]",
} as const;

export type PanelWidth = keyof typeof PANEL_WIDTHS;

interface SidePanelProps {
  open: boolean;
  title: string;
  /** Defaults to `wide`; pick `widest` for any body holding one of the 1120px tables. */
  width?: PanelWidth;
  /**
   * Explanatory copy for the title, shown as its tooltip. It lives here rather than in
   * each panel body because the header already renders the title: a body that repeated
   * it to host its own tooltip put the same words on screen twice in a 480px column.
   */
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function SidePanel({ open, title, width = "wide", description, onClose, children }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    },
    [onClose],
  );

  const handleDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const dialog = panelRef.current;
    if (!dialog) return;

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);

    if (focusableElements.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const firstFocusableElement = focusableElements[0];
    const lastFocusableElement = focusableElements[focusableElements.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey && activeElement === firstFocusableElement) {
      event.preventDefault();
      lastFocusableElement.focus();
      return;
    }

    if (!event.shiftKey && activeElement === lastFocusableElement) {
      event.preventDefault();
      firstFocusableElement.focus();
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      data-testid="portfolio-side-panel"
      className={clsx(
        "absolute inset-y-0 right-0 z-30 w-full overflow-y-auto",
        PANEL_WIDTHS[width],
        "border-l border-[var(--border)] bg-[var(--bg-surface)] shadow-lg",
        "focus-visible:outline-none",
      )}
    >
      <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">
          {description ? <InfoTooltip label={title} description={description} /> : title}
        </h2>
        <IconButton icon={<X className="h-4 w-4" />} label="Close panel" onClick={onClose} />
      </div>
      {/* space-y-6 is the page's section rhythm. Panel bodies are fragments of several
          sibling <section>s with no spacing of their own, so without it they butt
          together and the panel reads as one undifferentiated block.

          The control floor is here rather than in each body: these were laid out for a
          full-width section at `px-2 py-1 text-xs`, roughly 26px tall, which is under a
          comfortable click target once they are packed into a panel. Setting it once at
          the boundary keeps every panel consistent and needs no edit per component. */}
      <div
        className={clsx(
          "space-y-6 p-4",
          "[&_input]:min-h-9 [&_select]:min-h-9 [&_button]:min-h-9",
        )}
      >
        {children}
      </div>
    </div>
  );
}
