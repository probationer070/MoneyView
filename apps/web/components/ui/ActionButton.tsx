"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

type ActionVariant = "primary" | "secondary" | "danger";
type ActionSize = "sm" | "md";

interface ActionButtonProps {
  label: string;
  onClick: () => void;
  variant?: ActionVariant;
  size?: ActionSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  type?: "button" | "submit" | "reset";
  className?: string;
}

const variantStyles: Record<ActionVariant, string> = {
  primary:   "bg-[var(--state-info)] text-white hover:opacity-90 border border-transparent",
  secondary: "bg-transparent text-[var(--text-primary)] border border-[var(--border-default)] hover:bg-[var(--bg-subtle)]",
  danger:    "bg-[var(--state-error)] text-white hover:opacity-90 border border-transparent",
};

const sizeStyles: Record<ActionSize, string> = {
  sm: "h-8 px-3 text-[length:var(--type-helper)] gap-1.5",
  md: "h-9 px-4 text-[length:var(--type-label)] gap-2",
};

export function ActionButton({
  label, onClick, variant = "secondary", size = "md",
  loading = false, disabled = false, icon, type = "button", className,
}: ActionButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={clsx(
        "inline-flex items-center justify-center font-medium rounded-[var(--radius-md)]",
        "transition-all duration-[var(--duration-fast)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-info)] focus-visible:ring-offset-1",
        variantStyles[variant], sizeStyles[size],
        isDisabled && "opacity-50 cursor-not-allowed pointer-events-none",
        className
      )}
    >
      {loading
        ? <span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
        : icon && <span className="shrink-0">{icon}</span>}
      {label}
    </button>
  );
}
