"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

interface IconButtonProps {
  icon: ReactNode;
  onClick: () => void;
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "outlined";
  disabled?: boolean;
  className?: string;
}

export function IconButton({
  icon, onClick, label, size = "md", variant = "ghost", disabled = false, className,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={clsx(
        "inline-flex items-center justify-center rounded-[var(--radius-1)] transition-colors duration-[var(--duration-fast)]",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        variant === "ghost"
          ? "text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--surface)]"
          : "text-[var(--ink-muted)] border border-[var(--line)] hover:bg-[var(--surface)]",
        disabled && "opacity-40 cursor-not-allowed pointer-events-none",
        className
      )}
    >
      {icon}
    </button>
  );
}
