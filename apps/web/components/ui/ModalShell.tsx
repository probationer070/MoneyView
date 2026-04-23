"use client";

import type { ReactNode } from "react";
import { useEffect, useCallback } from "react";
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
  const handleEscape = useCallback(
    (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); },
    [onClose]
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lg:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity duration-[var(--duration-slow)]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={clsx(
          "relative z-10 w-full flex flex-col",
          "bg-[var(--bg-elevated)] rounded-[var(--radius-lg)]",
          "shadow-[var(--shadow-modal)]",
          "max-h-[calc(100vh-48px)]",
          maxWidthMap[size],
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--border-soft)] shrink-0">
          <div className="min-w-0">
            <h2
              id="modal-title"
              className="text-[17px] font-semibold text-[var(--text-primary)] leading-snug"
            >
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{subtitle}</p>
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
