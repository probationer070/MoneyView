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
  md: "p-4",
  lg: "p-6",
};

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
        "rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-surface)]",
        paddingMap[padding],
        isInteractive && [
          "transition-shadow",
          "duration-[var(--duration-normal)]",
          "hover:shadow-[var(--shadow-card-hover)]",
        ],
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
    >
      {children}
    </Tag>
  );
}
