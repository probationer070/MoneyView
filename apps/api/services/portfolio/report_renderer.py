from __future__ import annotations

import csv
from io import StringIO
from html import escape

from apps.api.models.schemas import AttributionResult, ReportExportFormatEnum, ReportExportResponse, ReportPayload


class ReportRenderer:
    """Formats canonical report payloads for export."""

    @staticmethod
    def build_markdown(result: AttributionResult) -> str:
        lines = [
            "# Portfolio Attribution Summary",
            "",
            f"- Portfolio Return: {result.totals.portfolio_return:.4%}",
            f"- Benchmark Return: {result.totals.benchmark_return:.4%}",
            f"- Active Return: {result.active_return:.4%}",
            "",
            "## Effects",
            f"- Allocation: {result.effects.allocation:.4%}",
            f"- Selection: {result.effects.selection:.4%}",
            f"- Interaction: {result.effects.interaction:.4%}",
            "",
            "## Risk",
            f"- Beta ({result.risk_metrics.beta_rolling_window}d): {result.risk_metrics.beta:.4f}",
            f"- VaR 95% 1d: {result.risk_metrics.var_95_1d:.4%}",
            f"- ES 95% 1d: {result.risk_metrics.es_95_1d:.4%}",
            "",
            "## Sector Breakdown",
        ]
        for sector in result.sector_breakdowns:
            lines.append(
                f"- {sector.sector}: active {sector.active_contribution:.4%} "
                f"(A {sector.allocation_effect:.4%}, S {sector.selection_effect:.4%}, I {sector.interaction_effect:.4%})"
            )
        return "\n".join(lines)

    @staticmethod
    def to_csv(report: ReportPayload) -> str:
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(
            [
                "sector",
                "portfolio_weight",
                "benchmark_weight",
                "allocation_effect",
                "selection_effect",
                "interaction_effect",
                "active_contribution",
            ]
        )
        for row in report.attribution.sector_breakdowns:
            writer.writerow(
                [
                    row.sector,
                    f"{row.portfolio_weight:.10f}",
                    f"{row.benchmark_weight:.10f}",
                    f"{row.allocation_effect:.10f}",
                    f"{row.selection_effect:.10f}",
                    f"{row.interaction_effect:.10f}",
                    f"{row.active_contribution:.10f}",
                ]
            )
        return output.getvalue().strip()

    @staticmethod
    def _effect_rows_html(report: ReportPayload) -> str:
        effect_rows = [
            ("Allocation", report.attribution.effects.allocation),
            ("Selection", report.attribution.effects.selection),
            ("Interaction", report.attribution.effects.interaction),
            ("Active Return", report.attribution.active_return),
        ]
        return "".join(
            [
                (
                    "<tr>"
                    f"<td>{escape(name)}</td>"
                    f"<td>{value:.2%}</td>"
                    f"<td>{value * 10000:.2f} bps</td>"
                    "</tr>"
                )
                for name, value in effect_rows
            ]
        )

    @staticmethod
    def _sector_rows_html(report: ReportPayload) -> str:
        return "".join(
            [
                (
                    "<tr>"
                    f"<td>{escape(row.sector)}</td>"
                    f"<td>{row.portfolio_weight:.2%}</td>"
                    f"<td>{row.benchmark_weight:.2%}</td>"
                    f"<td>{row.allocation_effect:.2%}</td>"
                    f"<td>{row.selection_effect:.2%}</td>"
                    f"<td>{row.interaction_effect:.2%}</td>"
                    f"<td>{row.active_contribution:.2%}</td>"
                    "</tr>"
                )
                for row in report.attribution.sector_breakdowns
            ]
        )

    def to_html(self, report: ReportPayload) -> str:
        portfolio_hash = escape(report.portfolio_hash)
        generated_at = escape(report.generated_at)
        benchmark = escape(report.attribution.metadata.benchmark)
        method = escape(report.attribution.metadata.method.value)
        summary = escape(report.executive_summary)
        effect_html = self._effect_rows_html(report)
        sector_rows = self._sector_rows_html(report)

        return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Portfolio Report {portfolio_hash}</title>
  <style>
    :root {{ --text: #111827; --muted: #4b5563; --border: #d1d5db; --surface: #f9fafb; --accent: #1d4ed8; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; background: white; line-height: 1.45; }}
    .page {{ max-width: 1000px; margin: 0 auto; padding: 24px; }}
    .header {{ border-bottom: 2px solid var(--border); padding-bottom: 12px; margin-bottom: 20px; }}
    h1 {{ margin: 0; font-size: 24px; color: var(--accent); }}
    .meta {{ margin-top: 8px; color: var(--muted); font-size: 12px; }}
    .summary {{ background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 12px; margin-bottom: 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 18px; }}
    .metric {{ border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: white; }}
    .metric .label {{ color: var(--muted); font-size: 12px; }}
    .metric .value {{ margin-top: 4px; font-size: 18px; font-weight: 700; }}
    h2 {{ margin: 16px 0 8px 0; font-size: 16px; }}
    table {{ width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 12px; background: white; }}
    th, td {{ border: 1px solid var(--border); padding: 7px 8px; text-align: left; vertical-align: top; word-wrap: break-word; }}
    thead th {{ background: #f3f4f6; font-weight: 700; }}
    .section {{ margin-bottom: 16px; }}
    .no-break {{ break-inside: avoid; page-break-inside: avoid; }}
    @page {{ size: A4; margin: 14mm; }}
    @media print {{
      body {{ background: white; }}
      .page {{ max-width: none; margin: 0; padding: 0; }}
      .section, tr {{ break-inside: avoid; page-break-inside: avoid; }}
      thead {{ display: table-header-group; }}
      tfoot {{ display: table-footer-group; }}
    }}
  </style>
</head>
<body>
  <div class="page">
    <header class="header">
      <h1>Portfolio Attribution Report</h1>
      <div class="meta">
        <div>Portfolio Hash: {portfolio_hash}</div>
        <div>Generated (UTC): {generated_at}</div>
        <div>Benchmark: {benchmark} | Method: {method}</div>
      </div>
    </header>
    <section class="summary section no-break"><strong>Executive Summary</strong><div>{summary}</div></section>
    <section class="grid section no-break">
      <article class="metric"><div class="label">Portfolio Return</div><div class="value">{report.attribution.totals.portfolio_return:.2%}</div></article>
      <article class="metric"><div class="label">Benchmark Return</div><div class="value">{report.attribution.totals.benchmark_return:.2%}</div></article>
      <article class="metric"><div class="label">Active Return</div><div class="value">{report.attribution.active_return:.2%}</div></article>
      <article class="metric"><div class="label">Beta ({report.attribution.risk_metrics.beta_rolling_window}d)</div><div class="value">{report.attribution.risk_metrics.beta:.3f}</div></article>
    </section>
    <section class="section no-break">
      <h2>Effect Reconciliation</h2>
      <table><thead><tr><th>Effect</th><th>Percent</th><th>Basis Points</th></tr></thead><tbody>{effect_html}</tbody></table>
    </section>
    <section class="section">
      <h2>Sector Attribution Breakdown</h2>
      <table>
        <thead><tr><th>Sector</th><th>Portfolio W</th><th>Benchmark W</th><th>Allocation</th><th>Selection</th><th>Interaction</th><th>Active</th></tr></thead>
        <tbody>{sector_rows}</tbody>
      </table>
    </section>
  </div>
</body>
</html>"""

    def build_export(self, report: ReportPayload, fmt: ReportExportFormatEnum) -> ReportExportResponse:
        base_name = f"portfolio-report-{report.portfolio_hash}"
        if fmt == ReportExportFormatEnum.json:
            return ReportExportResponse(format=fmt, content_type="application/json", filename=f"{base_name}.json", content=report.model_dump_json(indent=2))
        if fmt == ReportExportFormatEnum.markdown:
            return ReportExportResponse(format=fmt, content_type="text/markdown", filename=f"{base_name}.md", content=report.markdown_content)
        if fmt == ReportExportFormatEnum.csv:
            return ReportExportResponse(format=fmt, content_type="text/csv", filename=f"{base_name}.csv", content=self.to_csv(report))
        return ReportExportResponse(format=fmt, content_type="text/html", filename=f"{base_name}.html", content=self.to_html(report))
