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
  primary: "border-[var(--brand)] bg-[var(--brand)] text-[var(--on-brand)] hover:border-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--bg)]",
  secondary: "border-[var(--line-strong)] bg-transparent text-[var(--ink)] hover:border-[var(--brand)] hover:text-[var(--brand-text)]",
  danger: "border-[var(--status-error-border)] bg-transparent text-[var(--status-error-ink)] hover:bg-[var(--status-error-surface)]",
};
const DISABLED = "cursor-not-allowed pointer-events-none border-[var(--grid)] bg-transparent text-[var(--ink-disabled)]";

const sizeStyles: Record<ActionSize, string> = {
  sm: "type-caption h-[var(--component-button-height-sm)] px-3 gap-1.5",
  md: "type-mono h-[var(--component-button-height-md)] px-5 gap-2",
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
        "inline-flex items-center justify-center rounded-[var(--radius-1)] border uppercase",
        "transition-colors duration-[var(--duration-normal)]",
        isDisabled ? DISABLED : variantStyles[variant],
        sizeStyles[size],
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
