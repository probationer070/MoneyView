"use client";

import { useT } from "@/lib/i18n/locale";
import { ExportMenu, type ExportItem } from "@/components/ui/ExportMenu";

interface ExportButtonProps {
  /** Header cells, already in the active locale. */
  columns: string[];
  /** One entry per holding shown, cells formatted exactly as the table prints them. */
  rows: string[][];
  title: string;
}

function downloadBlob(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// RFC 4180: quote a cell holding a comma, quote or line break; double the quotes inside it.
function csvCell(value: string) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function ExportButton({ columns, rows, title }: ExportButtonProps) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);

  function exportCsv() {
    const lines = [columns, ...rows].map((line) => line.map(csvCell).join(","));
    // The BOM is what makes Excel read the file as UTF-8, so Korean names survive.
    downloadBlob(`moneyview-holdings-${today}.csv`, "text/csv;charset=utf-8", `﻿${lines.join("\r\n")}\r\n`);
  }

  function exportPdf() {
    const head = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
    const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} ${today}</title>`
      + `<style>table{border-collapse:collapse}th,td{border:1px solid;padding:4px 8px;text-align:left}</style></head>`
      + `<body><h1>${escapeHtml(title)}</h1><p>${today}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
    const popup = window.open("", "_blank", "width=1200,height=900");
    if (popup) {
      popup.document.write(html);
      popup.document.close();
      popup.focus();
      popup.print();
    }
  }

  if (rows.length === 0) {
    return (
      <button
        className="whitespace-nowrap px-3 py-2 type-body rounded-[var(--radius-1)] border border-[var(--line)] text-[var(--on-brand)] bg-[var(--brand)]"
        disabled
      >
        {t("common.exportDisabled")}
      </button>
    );
  }

  const exportItems: ExportItem[] = [
    { key: "pdf", label: t("common.printPdf"), onSelect: exportPdf },
    { key: "csv", label: "CSV", onSelect: exportCsv, separatorBefore: true },
  ];

  return (
    <ExportMenu
      items={exportItems}
      label={t("common.export")}
      testIdPrefix="portfolio-export"
      triggerClassName="inline-flex items-center gap-2 whitespace-nowrap px-3 py-2 type-body rounded-[var(--radius-1)] border border-[var(--line)] bg-[var(--surface-raised)] hover:bg-[var(--surface)]"
    />
  );
}
