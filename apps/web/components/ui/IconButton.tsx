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
        "inline-flex items-center justify-center rounded-[var(--radius-md)] transition-colors duration-[var(--duration-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1",
        size === "sm" ? "h-7 w-7" : "h-8 w-8",
        variant === "ghost"
          ? "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)]"
          : "text-[var(--text-muted)] border border-[var(--border-default)] hover:bg-[var(--bg-subtle)]",
        disabled && "opacity-40 cursor-not-allowed pointer-events-none",
        className
      )}
    >
      {icon}
    </button>
  );
}
