"use client";

import { useMemo, useState } from "react";
import { fetchApi } from "@/lib/api";
import type { ReportExportFormatEnum, ReportExportResponse } from "../../../../packages/shared-types/generated/portfolio";

interface ExportButtonProps {
  tickers: string[];
  weights: number[];
  benchmark?: string;
  period?: "1w" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
  currency?: string;
  dateFrom?: string;
  asOfDate?: string;
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


export function ExportButton({
  tickers,
  weights,
  benchmark = "^GSPC",
  period = "5y",
  currency = "USD",
  dateFrom = "",
  asOfDate = "",
}: ExportButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const canExport = useMemo(() => tickers.length > 0 && weights.length > 0, [tickers, weights]);

  const requestBody = useMemo(
    () => ({
      tickers,
      weights,
      filters: {
        period,
        benchmark,
        currency,
        date_from: dateFrom || null,
        date_to: asOfDate || null,
      },
      report_options: {
        formats: ["html", "pdf", "markdown", "csv", "json"],
        include_risk_metrics: true,
        include_sector_table: true,
        include_methodology: true,
      },
      attribution_method: "brinson_fachler_arithmetic",
      allow_synthetic_fallback: true,
      allow_benchmark_proxy: true,
      version: "phase5-v1",
    }),
    [asOfDate, benchmark, currency, dateFrom, period, tickers, weights]
  );

  async function fetchExport(format: ReportExportFormatEnum): Promise<ReportExportResponse> {
    return fetchApi<ReportExportResponse>("/report/export", {
      method: "POST",
      body: JSON.stringify({
        request: requestBody,
        format,
      }),
    });
  }

  async function exportJson() {
    if (!canExport) return;
    setIsLoading(true);
    try {
      const exported = await fetchExport("json");
      downloadBlob(exported.filename, exported.content_type, exported.content);
    } finally {
      setIsLoading(false);
    }
  }

  async function exportMarkdown() {
    if (!canExport) return;
    setIsLoading(true);
    try {
      const exported = await fetchExport("markdown");
      downloadBlob(exported.filename, exported.content_type, exported.content);
    } finally {
      setIsLoading(false);
    }
  }

  async function exportCsv() {
    if (!canExport) return;
    setIsLoading(true);
    try {
      const exported = await fetchExport("csv");
      downloadBlob(exported.filename, exported.content_type, exported.content);
    } finally {
      setIsLoading(false);
    }
  }

  async function exportPdf() {
    if (!canExport) return;
    setIsLoading(true);
    try {
      const exported = await fetchExport("pdf");
      const html = exported.content;
      const popup = window.open("", "_blank", "width=1200,height=900");
      if (popup) {
        popup.document.write(html);
        popup.document.close();
        popup.focus();
        popup.print();
      }
    } finally {
      setIsLoading(false);
    }
  }

  if (!canExport) {
    return (
      <button
        className="px-3 py-2 text-sm rounded-md border border-[var(--border)] text-[var(--text-muted)] bg-[var(--surface)]"
        disabled
      >
        Export Disabled
      </button>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={exportJson}
        disabled={isLoading}
        className="px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)]"
      >
        Export JSON
      </button>
      <button
        onClick={exportCsv}
        disabled={isLoading}
        className="px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)]"
      >
        Export CSV
      </button>
      <button
        onClick={exportMarkdown}
        disabled={isLoading}
        className="px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-subtle)]"
      >
        Export Markdown
      </button>
      <button
        onClick={exportPdf}
        disabled={isLoading}
        className="px-3 py-2 text-sm rounded-md border border-[var(--border)] bg-[var(--surface)] text-white hover:opacity-90"
      >
        Print PDF
      </button>
    </div>
  );
}
