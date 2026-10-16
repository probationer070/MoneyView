import type { ReactNode } from "react";
import clsx from "clsx";

type CardPadding = "sm" | "md" | "lg";

interface CardProps {
  children: ReactNode;
  padding?: CardPadding;
  hoverable?: boolean;
  onClick?: () => void;
  className?: string;
  as?: "div" | "article" | "section";
}

const paddingMap: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-5",
  lg: "p-6",
};

const TICK = "pointer-events-none absolute h-[var(--component-tick-size)] w-[var(--component-tick-size)] border-[var(--ink-muted)]";
// The redesign's panel signature: a 1px hairline frame with 8px corner ticks laid over it.
const TICKS = ["-left-px -top-px border-l border-t", "-right-px -top-px border-r border-t", "-bottom-px -left-px border-b border-l", "-bottom-px -right-px border-b border-r"];

export function Card({
  children,
  padding = "md",
  hoverable = false,
  onClick,
  className,
  as: Tag = "div",
}: CardProps) {
  const isInteractive = hoverable || Boolean(onClick);

  return (
    <Tag
      className={clsx(
        "relative border border-[var(--line)] bg-[var(--surface-raised)]",
        paddingMap[padding],
        isInteractive && "transition-colors duration-[var(--duration-normal)] hover:border-[var(--line-strong)]",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {TICKS.map((position) => <i key={position} aria-hidden="true" className={clsx(TICK, position)} />)}
      {children}
    </Tag>
  );
}
