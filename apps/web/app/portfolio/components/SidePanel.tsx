"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import { IconButton } from "@/components/ui/IconButton";
import { X } from "lucide-react";

interface SidePanelProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export function SidePanel({ open, title, onClose, children }: SidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
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
      data-testid="portfolio-side-panel"
      className={clsx(
        "absolute inset-y-0 right-0 z-30 w-full max-w-[480px] overflow-y-auto",
        "border-l border-[var(--border)] bg-[var(--bg-surface)] shadow-lg",
        "focus-visible:outline-none",
      )}
    >
      <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{title}</h2>
        <IconButton icon={<X className="h-4 w-4" />} label="Close panel" onClick={onClose} />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}
