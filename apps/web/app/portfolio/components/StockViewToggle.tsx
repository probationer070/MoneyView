"use client";

import clsx from "clsx";
import { LayoutGrid, Table } from "lucide-react";
import { SEGMENT_CONTAINER, SEGMENT_SELECTED, SEGMENT_UNSELECTED } from "@/components/ui/ToggleGroup";
import { useT } from "@/lib/i18n/locale";

export type StocksView = "cards" | "table";

interface StockViewToggleProps {
  value: StocksView;
  onChange: (value: StocksView) => void;
}

/** Icon-only cards / table switch for the Stocks tab. The icons carry no text, so each button is named by aria-label. */
export function StockViewToggle({ value, onChange }: StockViewToggleProps) {
  const t = useT();
  const options = [
    { value: "cards" as const, label: t("portfolio.view.cards"), Icon: LayoutGrid },
    { value: "table" as const, label: t("portfolio.view.table"), Icon: Table },
  ];
  return (
    <div className={clsx(SEGMENT_CONTAINER, "shrink-0")} role="group" aria-label={t("portfolio.view.label")}>
      {options.map(({ value: optionValue, label, Icon }) => {
        const selected = value === optionValue;
        return (
          <button
            key={optionValue}
            type="button"
            aria-label={label}
            aria-pressed={selected}
            title={label}
            onClick={() => onChange(optionValue)}
            className={clsx(
              "inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-1)] transition-colors duration-[var(--duration-normal)]",
              selected ? SEGMENT_SELECTED : SEGMENT_UNSELECTED,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
