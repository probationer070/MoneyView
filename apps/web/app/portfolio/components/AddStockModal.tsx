"use client";

import { useRef } from "react";
import { ModalShell } from "@/components/ui/ModalShell";
import { useT } from "@/lib/i18n/locale";
import { StockSearchAdd, type SearchableCompany } from "./StockSearchAdd";

interface AddStockModalProps {
  open: boolean;
  onClose: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  results: SearchableCompany[];
  watchlistTickers: string[];
  onAdd: (company: SearchableCompany) => void;
  adding: boolean;
  formatSectorLabel: (value: string) => string;
}

export function AddStockModal({ open, onClose, ...search }: AddStockModalProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <ModalShell open={open} onClose={onClose} title={t("portfolio.addStock.title")} size="md" initialFocusRef={inputRef}>
      <StockSearchAdd
        search={search.search}
        onSearchChange={search.onSearchChange}
        results={search.results}
        watchlistTickers={search.watchlistTickers}
        onAdd={search.onAdd}
        adding={search.adding}
        formatSectorLabel={search.formatSectorLabel}
        inputRef={inputRef}
        labels={{
          search: t("portfolio.addStock.search"),
          placeholder: t("portfolio.addStock.placeholder"),
          ariaLabel: t("portfolio.addStock.title"),
          add: t("portfolio.addStock.add"),
          added: t("portfolio.addStock.added"),
          openDetail: "",
          empty: t("portfolio.addStock.empty"),
        }}
      />
    </ModalShell>
  );
}
