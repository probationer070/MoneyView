"use client";

import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useCallback, useId, useRef } from "react";
import { X } from "lucide-react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";

type ModalSize = "md" | "lg" | "xl" | "full";

interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  size?: ModalSize;
  headerRightContent?: ReactNode;
  children: ReactNode;
}

const maxWidthMap: Record<ModalSize, string> = {
  md:   "max-w-[640px]",
  lg:   "max-w-[840px]",
  xl:   "max-w-[1080px]",
  full: "max-w-[calc(100vw-48px)]",
};

export function ModalShell({
  open, onClose, title, subtitle, size = "lg", headerRightContent, children,
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const subtitleId = useId();

  // The listener must not depend on onClose's identity. Every caller passes an inline
  // arrow, so a [onClose] dependency re-ran this effect on every render; when another
  // document-level Escape handler (a side panel) closes above us, React flushes that
  // discrete update mid-dispatch and our removeEventListener + addEventListener lands
  // inside the DOM's dispatch. A listener removed during dispatch is skipped and one
  // added during dispatch is not in the snapshot, so the modal never saw that keypress.
  // Reading onClose from a ref keeps registration tied to `open` alone.
  // ERROR-LOG.md 2026-08-02.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCloseRef.current();
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    previouslyFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    if (dialog) {
      const focusableElements = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const firstFocusableElement = focusableElements[0];
      if (firstFocusableElement) {
        firstFocusableElement.focus();
      } else {
        dialog.focus();
      }
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
      previouslyFocusedElementRef.current?.focus();
    };
  }, [open, handleEscape]);

  const handleDialogKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
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

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-2 sm:items-center sm:p-4 lg:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity duration-[var(--duration-slow)]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        className={clsx(
          "relative z-10 flex w-full min-h-0 flex-col",
          "bg-[var(--bg-elevated)] rounded-[var(--radius-lg)]",
          "shadow-[var(--shadow-modal)]",
          "max-h-[calc(100dvh-48px)] sm:max-h-[calc(100dvh-96px)]",
          maxWidthMap[size],
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--border-soft)] shrink-0">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[length:var(--type-section-title)] font-semibold text-[var(--text-primary)] leading-snug"
            >
              {title}
            </h2>
            {subtitle && (
              <p id={subtitleId} className="mt-0.5 text-[length:var(--type-helper)] text-[var(--text-muted)]">{subtitle}</p>
            )}
          </div>
          {headerRightContent && (
            <div className="ml-auto mr-4 self-center text-right shrink-0">
              {headerRightContent}
            </div>
          )}
          <IconButton
            icon={<X className="h-4 w-4" />}
            onClick={onClose}
            label="Close modal"
            size="sm"
            className="shrink-0 mt-0.5"
          />
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
