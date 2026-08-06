"use client";

import { useCallback, useEffect, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { X } from "lucide-react";

interface SidePanelProps {
  open: boolean;
  title: string;
  /**
   * Explanatory copy for the title, shown as its tooltip. It lives here rather than in
   * each panel body because the header already renders the title: a body that repeated
   * it to host its own tooltip put the same words on screen twice in a 480px column.
   */
  description?: string;
  onClose: () => void;
  children: ReactNode;
}

export function SidePanel({ open, title, description, onClose, children }: SidePanelProps) {
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
        "absolute inset-y-0 right-0 z-30 w-full max-w-[480px] overflow-y-auto",
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
          together and the panel reads as one undifferentiated block. */}
      <div className="space-y-6 p-4">{children}</div>
    </div>
  );
}
