"use client";

import type { CorrelationInput, CorrelationResult } from "../lib/types";
import { AlertTriangle, Loader2, Play } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { CHART_INITIAL_DIMENSION, MetricCard, numberText, pct } from "./shared";

type Props = {
  correlationInput: CorrelationInput;
  correlationResult: CorrelationResult | null;
  correlationStatus: "idle" | "loading" | "error" | "cancelled";
  correlationProgress: number;
  updateCorrelation: <K extends keyof CorrelationInput>(key: K, value: CorrelationInput[K]) => void;
  updateCorrelationAsset: (assetIndex: number, field: "name" | "expectedReturn" | "volatility", value: string | number) => void;
  updateCorrelationCell: (rowIndex: number, columnIndex: number, value: number) => void;
  runCorrelationSimulation: () => void;
};

export function CorrelationModelSection({
  correlationInput,
  correlationResult,
  correlationStatus,
  correlationProgress,
  updateCorrelation,
  updateCorrelationAsset,
  updateCorrelationCell,
  runCorrelationSimulation,
}: Props) {
  return (
    <div className="space-y-6">
      {correlationStatus === "loading" && (
        <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-sm font-bold text-[var(--text-primary)]">
            <span>Correlation worker progress</span>
            <span>{correlationProgress}%</span>
          </div>
          <div className="mt-3 h-3 rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-[var(--accent)] transition-all" style={{ width: `${correlationProgress}%` }} />
          </div>
        </div>
      )}

      {correlationStatus === "error" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
          <AlertTriangle className="h-4 w-4" />
          Correlation engine failed.
        </div>
      )}

      {correlationStatus === "cancelled" && (
        <div className="flex items-center gap-2 rounded-[var(--radius)] border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-700">
          <AlertTriangle className="h-4 w-4" />
          Correlation simulation cancelled.
        </div>
      )}

      {/* Three-column layout: inputs, analysis visuals, portfolio metrics */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(340px,0.95fr)_minmax(0,1.45fr)_minmax(260px,0.8fr)]">
        <aside className="space-y-6">
          {/* Left panel: asset assumptions, correlation matrix, and run action */}
          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-lg font-black text-[var(--text-primary)]">Multi-Asset Setup</h2>
            <div className="mt-3 grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-xs font-bold uppercase tracking-wide text-[var(--text-muted)]">
              <div>Asset</div>
              <div>Mu (%)</div>
              <div>Sigma (%)</div>
            </div>
            <div className="mt-4 space-y-3">
              {correlationInput.assets.map((asset, assetIndex) => (
                <div key={`setup-${assetIndex}`} className="grid grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                  <div className="text-sm font-black text-[var(--text-primary)]">{asset.name}</div>
                  <input type="number" value={asset.expectedReturn} onChange={(event) => updateCorrelationAsset(assetIndex, "expectedReturn", Number(event.target.value))} className="rounded border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" aria-label={`${asset.name} mu`} />
                  <input type="number" value={asset.volatility} onChange={(event) => updateCorrelationAsset(assetIndex, "volatility", Number(event.target.value))} className="rounded border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none" aria-label={`${asset.name} sigma`} />
                </div>
              ))}
            </div>

            <div className="mt-6">
              <h3 className="text-sm font-black text-[var(--text-primary)]">Correlation Matrix rho</h3>
              <div className="mt-3 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="bg-[var(--surface)] text-center">
                      <th className="p-3" />
                      {correlationInput.assets.map((asset) => (
                        <th key={`matrix-head-${asset.name}`} className="p-3 font-black text-[var(--text-primary)]">
                          {asset.name.replace("Asset ", "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {correlationInput.assets.map((assetY, rowIndex) => (
                      <tr key={`matrix-row-${assetY.name}`} className="border-t border-[var(--border)]">
                        <td className="p-3 text-center font-black text-[var(--text-primary)]">{assetY.name.replace("Asset ", "")}</td>
                        {correlationInput.assets.map((assetX, columnIndex) => {
                          const value = correlationInput.correlationMatrix[rowIndex][columnIndex];
                          if (rowIndex === columnIndex) {
                            return <td key={`matrix-cell-${assetY.name}-${assetX.name}`} className="bg-emerald-100 p-3 text-center font-black text-emerald-800">1.00</td>;
                          }
                          if (rowIndex < columnIndex) {
                            return (
                              <td key={`matrix-cell-${assetY.name}-${assetX.name}`} className="p-2">
                                <input
                                  type="number"
                                  min={-1}
                                  max={1}
                                  step={0.05}
                                  value={value}
                                  onChange={(event) => updateCorrelationCell(rowIndex, columnIndex, Number(event.target.value))}
                                  className="w-full rounded border border-[var(--border)] px-2 py-2 text-center text-sm text-[var(--text-primary)] outline-none"
                                />
                              </td>
                            );
                          }
                          return <td key={`matrix-cell-${assetY.name}-${assetX.name}`} className="bg-slate-50 p-3 text-center font-bold text-[var(--text-primary)]">{value.toFixed(2)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between text-sm font-black text-[var(--text-primary)]">
                <span>Number of Simulations</span>
                <span>{correlationInput.simulationCount.toLocaleString()}</span>
              </div>
              <input type="range" min={500} max={5000} step={100} value={correlationInput.simulationCount} onChange={(event) => updateCorrelation("simulationCount", Number(event.target.value))} className="w-full accent-[var(--accent)]" />
              <button type="button" onClick={runCorrelationSimulation} disabled={correlationStatus === "loading"} className="inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60">
                {correlationStatus === "loading" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Correlation Analysis
              </button>
            </div>
          </section>
        </aside>

        <div className="space-y-6">
          {!correlationResult ? (
            <div className="rounded-[var(--radius)] border border-dashed border-[var(--border)] bg-white p-10 text-center text-sm text-[var(--text-muted)]">
              Run the portfolio correlation engine to generate efficient frontier, correlation matrix, and sensitivity diagnostics.
            </div>
          ) : (
            <>
              {/* Middle panel: efficient frontier */}
              <section className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black text-[var(--text-primary)]">Efficient Frontier</h2>
                <p className="text-xs text-[var(--text-muted)]">Scatter plot of 400 random portfolios. Purple points show sampled portfolios and the brightest green point marks the highest Sharpe ratio.</p>
                <div className="mt-4 h-80">
                  <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                    <ScatterChart>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="risk" name="Risk sigma" tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
                      <YAxis dataKey="return" name="Return mu" tickFormatter={(value) => `${Number(value).toFixed(0)}%`} />
                      <ZAxis dataKey="sharpe" range={[30, 180]} />
                      <Tooltip
                        formatter={(value, name) => {
                          if (name === "risk" || name === "return") return `${Number(value).toFixed(2)}%`;
                          return Number(value).toFixed(4);
                        }}
                        labelFormatter={() => "Portfolio"}
                      />
                      <Scatter data={correlationResult.efficient_frontier.filter((point) => !point.is_optimal)} fill="#7c3aed" />
                      <Scatter data={correlationResult.efficient_frontier.filter((point) => point.is_optimal)} fill="#22c55e" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Middle panel: sensitivity analysis and full heatmap */}
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-black text-[var(--text-primary)]">Spearman rho Sensitivity</h2>
                  <p className="text-xs text-[var(--text-muted)]">Rank correlation between each asset return and the portfolio return, with positive exposures in green and negative exposures in red.</p>
                  <div className="mt-4 h-80">
                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                      <BarChart data={correlationResult.spearman_sensitivity} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" domain={[-1, 1]} />
                        <YAxis type="category" dataKey="asset" width={70} />
                        <Tooltip />
                        <Bar dataKey="spearman_rho_sensitivity">
                          {correlationResult.spearman_sensitivity.map((row) => {
                            const value = Number(row.spearman_rho_sensitivity);
                            const alpha = Math.min(Math.abs(value), 1);
                            const fill = value >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
                            return <Cell key={`spearman-${row.asset}`} fill={fill} />;
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
                  <h2 className="text-lg font-black text-[var(--text-primary)]">Correlation Coefficient Heatmap</h2>
                  <div className="mt-4 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
                    <table className="w-full table-fixed text-sm">
                      <thead>
                        <tr className="bg-[var(--surface)] text-center">
                          <th className="p-3"> </th>
                          {correlationResult.assets.map((asset) => <th key={asset} className="p-3">{asset.replace("Asset ", "")}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {correlationResult.assets.map((assetY) => (
                          <tr key={assetY} className="border-t border-[var(--border)]">
                            <td className="p-3 text-center font-bold text-[var(--text-primary)]">{assetY.replace("Asset ", "")}</td>
                            {correlationResult.assets.map((assetX) => {
                              const cell = correlationResult.heatmap.find((entry) => entry.asset_x === assetX && entry.asset_y === assetY);
                              const value = cell?.correlation ?? 0;
                              const alpha = Math.min(Math.abs(value), 1);
                              const isDiagonal = assetX === assetY;
                              return (
                                <td
                                  key={`${assetY}-${assetX}`}
                                  className="p-3 text-center font-bold text-[var(--text-primary)]"
                                  style={{ backgroundColor: isDiagonal ? "rgba(22, 163, 74, 1)" : value >= 0 ? `rgba(96, 202, 173, ${alpha})` : `rgba(239, 68, 68, ${alpha})` }}
                                >
                                  {value.toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="space-y-6">
          {!correlationResult ? null : (
            /* Right panel: optimal portfolio outcome metrics */
            <section className="grid grid-cols-1 gap-4">
              <MetricCard label="Optimal Portfolio Mu" value={pct(correlationResult.optimal_summary.optimal_return)} detail="Annual expected return of the highest-Sharpe portfolio" />
              <MetricCard label="Portfolio Sigma" value={pct(correlationResult.optimal_summary.optimal_volatility)} detail="Actual portfolio volatility after applying correlations" />
              <MetricCard label="Diversification Effect" value={`${correlationResult.optimal_summary.diversification_effect.toFixed(2)}%pt`} detail="Reduction versus the simple average of individual asset volatilities" />
              <MetricCard label="Optimal Sharpe" value={numberText(correlationResult.optimal_summary.optimal_sharpe)} detail="Highest Sharpe ratio among 400 randomly generated portfolios" />
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
