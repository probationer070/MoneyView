"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { fetchApi } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";
import { InfoTooltip } from "@/components/ui/InfoTooltip";

interface CorporateCompany {
  ticker: string;
  name: string;
  sector?: string;
  source?: string;
  preset?: {
    growth: number;
    roic: number;
    wacc: number;
    debtRatio: number;
    unleveredBeta: number;
  };
}

const COMPANIES: CorporateCompany[] = [
  { ticker: "AAPL", name: "Apple", preset: { growth: 6, roic: 18, wacc: 10, debtRatio: 18, unleveredBeta: 1.05 } },
  { ticker: "MSFT", name: "Microsoft", preset: { growth: 7, roic: 22, wacc: 9, debtRatio: 15, unleveredBeta: 0.95 } },
  { ticker: "NVDA", name: "Nvidia", preset: { growth: 16, roic: 32, wacc: 12, debtRatio: 10, unleveredBeta: 1.55 } },
  { ticker: "TSLA", name: "Tesla", preset: { growth: 12, roic: 13, wacc: 13, debtRatio: 22, unleveredBeta: 1.7 } },
  { ticker: "AMZN", name: "Amazon", preset: { growth: 9, roic: 12, wacc: 10.5, debtRatio: 24, unleveredBeta: 1.15 } },
  { ticker: "GOOGL", name: "Alphabet", preset: { growth: 8, roic: 20, wacc: 9.5, debtRatio: 8, unleveredBeta: 1.0 } },
  { ticker: "META", name: "Meta Platforms", preset: { growth: 10, roic: 24, wacc: 10.25, debtRatio: 12, unleveredBeta: 1.2 } },
  { ticker: "NFLX", name: "Netflix", preset: { growth: 8, roic: 16, wacc: 11, debtRatio: 26, unleveredBeta: 1.25 } },
  { ticker: "AMD", name: "AMD", preset: { growth: 11, roic: 11, wacc: 12, debtRatio: 18, unleveredBeta: 1.45 } },
  { ticker: "AVGO", name: "Broadcom", preset: { growth: 8, roic: 21, wacc: 10.75, debtRatio: 35, unleveredBeta: 1.1 } },
  { ticker: "JPM", name: "JPMorgan Chase", preset: { growth: 4, roic: 10, wacc: 8.75, debtRatio: 42, unleveredBeta: 0.9 } },
  { ticker: "V", name: "Visa", preset: { growth: 7, roic: 28, wacc: 8.5, debtRatio: 16, unleveredBeta: 0.85 } },
  { ticker: "UNH", name: "UnitedHealth", preset: { growth: 6, roic: 15, wacc: 8.75, debtRatio: 28, unleveredBeta: 0.8 } },
  { ticker: "XOM", name: "Exxon Mobil", preset: { growth: 3, roic: 12, wacc: 9.25, debtRatio: 20, unleveredBeta: 0.95 } },
  { ticker: "LEU", name: "Centrus Energy", preset: { growth: 14, roic: 14, wacc: 14, debtRatio: 30, unleveredBeta: 1.8 } },
];
const TAX_RATE = 0.25;
const RISK_FREE_RATE = 4.2;
const ERP = 5.0;
const CHART_INITIAL_DIMENSION = { width: 1, height: 1 };

interface CorporateAssumptions {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debtRatio: number;
  unleveredBeta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  marketShare: number;
  governance: number;
  esgPenalty: number;
}

interface DCFResult {
  estimated_value: number;
  current_price: number;
  upside_pct: number;
  wacc_used: number;
  margin_used: number;
  growth_used: number;
  status: string;
}

interface CorporateMetricsApi {
  ticker: string;
  growth: number;
  roic: number;
  wacc: number;
  debt_ratio: number;
  unlevered_beta: number;
  crp: number;
  reinvestment: number;
  fcff: number;
  innovation: number;
  market_share: number;
  governance: number;
  esg_penalty: number;
}

type CalculationDetailKey = "realtime" | "growth" | "spread" | "bottomUpKe";

interface CalculationRow {
  label: string;
  value: string;
  source: string;
}

interface CalculationDetail {
  title: string;
  summary: CalculationRow[];
  components: CalculationRow[];
  formula: string;
  result: string;
  sourcing: CalculationRow[];
}

const initialAssumptions: CorporateAssumptions = {
  ticker: "AAPL",
  growth: 6,
  roic: 18,
  wacc: 10,
  debtRatio: 18,
  unleveredBeta: 1.05,
  crp: 1.1,
  reinvestment: 34,
  fcff: 92,
  innovation: 82,
  marketShare: 64,
  governance: 74,
  esgPenalty: 22,
};

const STORAGE_KEY = "moneyview:corporate-assumptions:v2";

function mergeCompanies(apiCompanies: CorporateCompany[] = []) {
  const byTicker = new Map<string, CorporateCompany>();
  for (const company of COMPANIES) {
    byTicker.set(company.ticker, company);
  }
  for (const company of apiCompanies) {
    const ticker = company.ticker.toUpperCase();
    byTicker.set(ticker, {
      ...byTicker.get(ticker),
      ...company,
      ticker,
    });
  }
  return Array.from(byTicker.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function companyForTicker(ticker: string, companies: CorporateCompany[] = COMPANIES) {
  return companies.find((company) => company.ticker === ticker) ?? { ticker, name: ticker, source: "manual" };
}

function stableSeed(value: string) {
  return Array.from(value).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function generatedDefaultsFor(company: CorporateCompany | undefined, ticker: string) {
  if (company?.preset) return company.preset;

  const sector = company?.sector?.toLowerCase() ?? "";
  const seed = stableSeed(`${ticker}:${sector}`);
  let growth = 5 + (seed % 9);
  let roic = 10 + (seed % 18);
  let wacc = 8 + (seed % 18) * 0.25;
  let debtRatio = 12 + (seed % 36);
  let unleveredBeta = 0.8 + (seed % 13) * 0.07;

  if (["semiconductor", "software", "cloud", "ai", "technology"].some((term) => sector.includes(term))) {
    growth += 2;
    roic += 3;
    unleveredBeta += 0.15;
  } else if (["energy", "oil", "gas", "nuclear"].some((term) => sector.includes(term))) {
    growth -= 1.5;
    debtRatio += 5;
    wacc += 0.5;
  } else if (["financial", "bank", "insurance"].some((term) => sector.includes(term))) {
    roic -= 2;
    debtRatio += 10;
    unleveredBeta -= 0.05;
  } else if (["utility", "water", "electric"].some((term) => sector.includes(term))) {
    growth -= 2;
    debtRatio += 14;
    unleveredBeta -= 0.15;
  }

  return {
    growth: Number(Math.max(growth, 1).toFixed(2)),
    roic: Number(Math.max(roic, 5).toFixed(2)),
    wacc: Number(Math.max(wacc, 6).toFixed(2)),
    debtRatio: Number(Math.min(Math.max(debtRatio, 5), 70).toFixed(2)),
    unleveredBeta: Number(Math.min(Math.max(unleveredBeta, 0.55), 2.4).toFixed(2)),
  };
}

function defaultAssumptionsFor(ticker: string, companies: CorporateCompany[] = COMPANIES): CorporateAssumptions {
  const company = companies.find((entry) => entry.ticker === ticker);
  const seed = stableSeed(`${ticker}:${company?.sector ?? ""}`);
  return {
    ...initialAssumptions,
    ticker,
    ...generatedDefaultsFor(company, ticker),
    crp: Number((0.6 + (seed % 12) * 0.1).toFixed(2)),
    reinvestment: Number((24 + (seed % 36)).toFixed(2)),
    fcff: Number((45 + (seed % 140)).toFixed(2)),
    innovation: Number((48 + (seed % 45)).toFixed(2)),
    marketShare: Number((28 + (seed % 52)).toFixed(2)),
    governance: Number((52 + (seed % 38)).toFixed(2)),
    esgPenalty: Number((8 + (seed % 32)).toFixed(2)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function numberText(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2);
}

function fromApiMetrics(metrics: CorporateMetricsApi): CorporateAssumptions {
  return {
    ticker: metrics.ticker,
    growth: metrics.growth,
    roic: metrics.roic,
    wacc: metrics.wacc,
    debtRatio: metrics.debt_ratio,
    unleveredBeta: metrics.unlevered_beta,
    crp: metrics.crp,
    reinvestment: metrics.reinvestment,
    fcff: metrics.fcff,
    innovation: metrics.innovation,
    marketShare: metrics.market_share,
    governance: metrics.governance,
    esgPenalty: metrics.esg_penalty,
  };
}

function toApiMetrics(assumptions: CorporateAssumptions): CorporateMetricsApi {
  return {
    ticker: assumptions.ticker,
    growth: assumptions.growth,
    roic: assumptions.roic,
    wacc: assumptions.wacc,
    debt_ratio: assumptions.debtRatio,
    unlevered_beta: assumptions.unleveredBeta,
    crp: assumptions.crp,
    reinvestment: assumptions.reinvestment,
    fcff: assumptions.fcff,
    innovation: assumptions.innovation,
    market_share: assumptions.marketShare,
    governance: assumptions.governance,
    esg_penalty: assumptions.esgPenalty,
  };
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = "%",
  description,
  onDetailClick,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  description?: string;
  onDetailClick?: () => void;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-[var(--text-muted)]">
          {onDetailClick ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                onDetailClick();
              }}
              className="text-left underline decoration-dotted underline-offset-4 hover:text-[var(--text-primary)]"
            >
              {description ? <InfoTooltip label={label} description={description} /> : label}
            </button>
          ) : description ? (
            <InfoTooltip label={label} description={description} />
          ) : (
            label
          )}
        </span>
        <span className="text-[var(--text-primary)]">
          {value.toFixed(step < 1 ? 2 : 1)}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--accent)]"
      />
    </label>
  );
}

function CalculationDetailModal({
  detail,
  onClose,
}: {
  detail: CalculationDetail;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const renderRows = (rows: CalculationRow[]) => (
    <tbody>
      {rows.map((row) => (
        <tr key={`${row.label}-${row.source}`} className="border-t border-[var(--border)]">
          <td className="px-3 py-2 font-semibold text-[var(--text-primary)]">{row.label}</td>
          <td className="px-3 py-2 tabular-nums text-[var(--text-primary)]">{row.value}</td>
          <td className="px-3 py-2 text-[var(--text-muted)]">{row.source}</td>
        </tr>
      ))}
    </tbody>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-[var(--radius)] bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 flex items-start justify-between border-b border-[var(--border)] bg-white p-5">
          <div>
            <h2 className="text-xl font-black text-[var(--text-primary)]">{detail.title}</h2>
            <p className="mt-1 text-sm text-[var(--text-muted)]">Calculation transparency and data lineage</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            Close
          </button>
        </div>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Summary Table</h3>
            <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Data Point</th>
                    <th className="px-3 py-2">Value</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                {renderRows(detail.summary)}
              </table>
            </div>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Component Breakdown</h3>
            <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Component</th>
                    <th className="px-3 py-2">Assigned Value</th>
                    <th className="px-3 py-2">Basis</th>
                  </tr>
                </thead>
                {renderRows(detail.components)}
              </table>
            </div>
          </section>

          <section className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4">
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Calculation Formula</h3>
            <p className="mt-2 font-mono text-sm text-[var(--text-primary)]">{detail.formula}</p>
            <p className="mt-3 text-sm font-bold text-[var(--accent)]">Result: {detail.result}</p>
          </section>

          <section>
            <h3 className="text-sm font-bold text-[var(--text-primary)]">Data Sourcing</h3>
            <div className="mt-2 overflow-hidden rounded-[var(--radius)] border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[var(--surface)] text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Current Value</th>
                    <th className="px-3 py-2">Origin</th>
                  </tr>
                </thead>
                {renderRows(detail.sourcing)}
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default function CorporateAnalysisPage() {
  const queryClient = useQueryClient();
  const hydratingTickerRef = useRef<string | null>(initialAssumptions.ticker);
  const [assumptions, setAssumptions] = useState<CorporateAssumptions>(() => {
    if (typeof window === "undefined") return initialAssumptions;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return defaultAssumptionsFor(initialAssumptions.ticker);
      const byTicker = JSON.parse(stored) as Record<string, CorporateAssumptions>;
      return byTicker[initialAssumptions.ticker] ?? defaultAssumptionsFor(initialAssumptions.ticker);
    } catch {
      return defaultAssumptionsFor(initialAssumptions.ticker);
    }
  });
  const [companySearch, setCompanySearch] = useState("");
  const [newCompanyName, setNewCompanyName] = useState("");
  const [newCompanySymbol, setNewCompanySymbol] = useState("");
  const [activeCalculation, setActiveCalculation] = useState<CalculationDetailKey | null>(null);
  const debounced = useDebounce(assumptions, 250);

  const companiesQuery = useQuery<CorporateCompany[]>({
    queryKey: ["corporate-companies"],
    queryFn: () => fetchApi<CorporateCompany[]>("/corporate/companies"),
    staleTime: 30_000,
  });

  const companies = useMemo(() => mergeCompanies(companiesQuery.data), [companiesQuery.data]);
  const activeCompany = companyForTicker(assumptions.ticker, companies);
  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    if (!query) return companies;
    const startsWith = companies.filter((company) => company.name.toLowerCase().startsWith(query));
    return startsWith.length > 0
      ? startsWith
      : companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companies, companySearch]);

  useEffect(() => {
    const ticker = assumptions.ticker;
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${ticker}`)
      .then((metrics) => {
        setAssumptions((current) => (
          current.ticker === ticker ? fromApiMetrics(metrics) : current
        ));
      })
      .catch(() => {
        // Local storage remains the fallback when backend hydration is unavailable.
      })
      .finally(() => {
        if (hydratingTickerRef.current === ticker) {
          hydratingTickerRef.current = null;
        }
      });
    // Initial backend hydration only. Ticker switching uses selectTicker().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const byTicker = stored ? (JSON.parse(stored) as Record<string, CorporateAssumptions>) : {};
      byTicker[assumptions.ticker] = assumptions;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byTicker));
    } catch {
      // Browser storage is optional; realtime calculations still work without it.
    }
  }, [assumptions]);

  useEffect(() => {
    if (hydratingTickerRef.current === debounced.ticker) return;
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${debounced.ticker}`, {
      method: "PUT",
      body: JSON.stringify(toApiMetrics(debounced)),
    }).catch(() => {
      // Local storage preserves ticker state if the backend is temporarily unavailable.
    });
  }, [debounced]);

  const update = <K extends keyof CorporateAssumptions>(key: K, value: CorporateAssumptions[K]) => {
    setAssumptions((current) => ({ ...current, [key]: value }));
  };

  const selectTicker = (ticker: string) => {
    hydratingTickerRef.current = ticker;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      const byTicker = stored ? (JSON.parse(stored) as Record<string, CorporateAssumptions>) : {};
      setAssumptions(byTicker[ticker] ?? defaultAssumptionsFor(ticker, companies));
    } catch {
      setAssumptions(defaultAssumptionsFor(ticker, companies));
    }
    fetchApi<CorporateMetricsApi>(`/corporate/metrics/${ticker}`)
      .then((metrics) => {
        setAssumptions((current) => (
          current.ticker === ticker ? fromApiMetrics(metrics) : current
        ));
      })
      .catch(() => {
        // Keep local state when backend persistence cannot be read.
      })
      .finally(() => {
        if (hydratingTickerRef.current === ticker) {
          hydratingTickerRef.current = null;
        }
      });
  };

  const addCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ticker = newCompanySymbol.trim().toUpperCase();
    const name = newCompanyName.trim();
    if (!ticker || !name) return;

    const saved = await fetchApi<CorporateCompany>("/corporate/companies", {
      method: "POST",
      body: JSON.stringify({ ticker, name, source: "manual" }),
    });
    queryClient.setQueryData<CorporateCompany[]>(["corporate-companies"], (current = []) => {
      const next = current.filter((company) => company.ticker.toUpperCase() !== saved.ticker.toUpperCase());
      return [...next, saved];
    });
    setNewCompanyName("");
    setNewCompanySymbol("");
    setCompanySearch(saved.name);
    selectTicker(saved.ticker.toUpperCase());
  };

  const derived = useMemo(() => {
    const debtToEquity = assumptions.debtRatio / Math.max(100 - assumptions.debtRatio, 1);
    const leveredBeta = assumptions.unleveredBeta * (1 + (1 - TAX_RATE) * debtToEquity);
    const bottomUpKe = RISK_FREE_RATE + leveredBeta * ERP + assumptions.crp;
    const spread = assumptions.roic - assumptions.wacc;
    const sustainableGrowth = (assumptions.reinvestment / 100) * assumptions.roic;
    const terminalValueShare = clamp(62 + assumptions.growth * 1.8 - assumptions.wacc * 1.2, 20, 88);
    const successProbability = clamp(55 + spread * 2.3 + assumptions.growth - assumptions.esgPenalty * 0.25, 5, 95);
    const agencyRisk = clamp(100 - assumptions.governance + assumptions.esgPenalty, 0, 100);
    const lifeCyclePosition = clamp(35 + assumptions.growth * 2.5 - assumptions.debtRatio * 0.3, 0, 100);
    const healthScore = clamp(
      (assumptions.growth * 2 + assumptions.marketShare + assumptions.innovation + assumptions.governance + (100 - agencyRisk)) / 5,
      0,
      100,
    );

    return {
      debtToEquity,
      leveredBeta,
      bottomUpKe,
      spread,
      sustainableGrowth,
      terminalValueShare,
      successProbability,
      agencyRisk,
      lifeCyclePosition,
      healthScore,
    };
  }, [assumptions]);

  const dcfQuery = useQuery<DCFResult>({
    queryKey: [
      "corporate-dcf",
      debounced.ticker,
      debounced.growth,
      debounced.wacc,
      debounced.roic,
      debounced.debtRatio,
      debounced.unleveredBeta,
      debounced.crp,
      debounced.reinvestment,
      debounced.fcff,
      debounced.esgPenalty,
    ],
    queryFn: ({ signal }) =>
      fetchApi<DCFResult>(`/corporate/dcf/${debounced.ticker}`, {
        method: "POST",
        signal,
        body: JSON.stringify({
          revenue_growth_rate: debounced.growth / 100,
          operating_margin: clamp(debounced.roic / 100, -1, 1),
          wacc: debounced.wacc / 100,
          tax_rate: TAX_RATE,
          terminal_growth_rate: clamp(debounced.growth / 100, -0.1, 0.1),
          fcff: debounced.fcff,
          esg_penalty: debounced.esgPenalty,
          reinvestment: debounced.reinvestment,
          unlevered_beta: debounced.unleveredBeta,
          debt_ratio: debounced.debtRatio,
        }),
      }),
    placeholderData: (previous) => previous,
    staleTime: 0,
  });

  const healthRadar = [
    { subject: "Growth", score: clamp(assumptions.growth * 7, 0, 100), peer: 58 },
    { subject: "Market Share", score: assumptions.marketShare, peer: 62 },
    { subject: "Innovation", score: assumptions.innovation, peer: 66 },
    { subject: "Life Cycle", score: derived.lifeCyclePosition, peer: 60 },
    { subject: "Governance", score: assumptions.governance, peer: 65 },
    { subject: "Agency Risk", score: 100 - derived.agencyRisk, peer: 62 },
  ];

  const hurdleBars = [
    { name: "Risk-free", value: RISK_FREE_RATE, fill: "#9DA5A2" },
    { name: "Beta x ERP", value: derived.leveredBeta * ERP, fill: "#60CAAD" },
    { name: "CRP", value: assumptions.crp, fill: "#444444" },
  ];

  const regionalMinard = [
    { region: "US", erp: 5.0, crp: 0.6, revenue: 46 },
    { region: "EU", erp: 5.4, crp: 0.9, revenue: 22 },
    { region: "KR", erp: 6.2, crp: 1.3, revenue: 12 },
    { region: "EM", erp: 7.1, crp: assumptions.crp + 1.4, revenue: 20 },
  ];

  const betaTreemapProxy = [
    { name: "Industry", beta: assumptions.unleveredBeta, size: 42 },
    { name: "Operating", beta: clamp(0.75 + assumptions.reinvestment / 100, 0.6, 1.8), size: 28 },
    { name: "Financial", beta: derived.leveredBeta, size: 30 },
  ];

  const waccCurve = Array.from({ length: 10 }, (_, idx) => {
    const debt = idx * 10;
    const curve = assumptions.wacc - 2.4 * (debt / 45) + 3.2 * Math.pow(debt / 70, 2);
    return { debt, wacc: Number(curve.toFixed(2)) };
  });

  const companyName = activeCompany.name;

  const valueMatrix = [
    {
      name: companyName,
      growth: assumptions.growth,
      spread: derived.spread,
      efficiency: clamp(assumptions.fcff / 1.6, 10, 100),
      fcff: assumptions.fcff,
    },
    { name: "Peer A", growth: 4.2, spread: 3.4, efficiency: 56, fcff: 70 },
    { name: "Peer B", growth: 8.5, spread: -1.8, efficiency: 44, fcff: 42 },
    { name: "Peer C", growth: 2.1, spread: 7.2, efficiency: 68, fcff: 60 },
  ];

  const riskReturn = [
    { risk: "Inflation", npv: derived.spread * 12 - 18, success: derived.successProbability - 12, fail: 100 - derived.successProbability + 12 },
    { risk: "FX", npv: derived.spread * 10 - 6, success: derived.successProbability - 5, fail: 100 - derived.successProbability + 5 },
    { risk: "Demand", npv: derived.spread * 9 + assumptions.growth, success: derived.successProbability, fail: 100 - derived.successProbability },
    { risk: "Margin", npv: derived.spread * 11 + assumptions.roic, success: derived.successProbability + 4, fail: 96 - derived.successProbability },
  ];

  const sourceLabel = activeCompany.source === "manual"
    ? "Manual Assumption / User-added company"
    : activeCompany.source === "portfolio"
      ? "Portfolio watchlist + ticker-specific SQLite metrics"
      : "Built-in company preset + ticker-specific SQLite metrics";

  const calculationDetails = useMemo<Record<CalculationDetailKey, CalculationDetail>>(() => ({
    realtime: {
      title: `${companyName} Realtime Assumptions`,
      summary: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: sourceLabel },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: sourceLabel },
        { label: "Country Risk Premium", value: pct(assumptions.crp), source: sourceLabel },
        { label: "FCFF", value: `$${numberText(assumptions.fcff)}B`, source: sourceLabel },
      ],
      components: [
        { label: "Ticker mapping", value: companyName, source: "Corporate company registry" },
        { label: "Primary storage key", value: assumptions.ticker, source: "Internal market-data identifier" },
        { label: "Persistence layer", value: "corporate_metrics", source: "SQLite" },
        { label: "Frontend cache", value: STORAGE_KEY, source: "Browser localStorage fallback" },
      ],
      formula: "Active assumptions = backend corporate_metrics[ticker] -> browser fallback -> generated company/sector default",
      result: `${companyName} loaded with WACC ${pct(assumptions.wacc)}, ROIC ${pct(assumptions.roic)}, beta ${numberText(assumptions.unleveredBeta)}`,
      sourcing: [
        { label: "Company Name", value: companyName, source: "Corporate company registry / Portfolio watchlist" },
        { label: "Financial assumptions", value: "Ticker-specific row", source: "SQLite corporate_metrics" },
        { label: "Generated defaults", value: "Deterministic company/sector model", source: "Used only when no specific metric row exists" },
        { label: "Market price for DCF", value: dcfQuery.data ? `$${numberText(dcfQuery.data.current_price)}` : "Loading", source: "Yahoo Finance / local OHLCV cache" },
      ],
    },
    growth: {
      title: `${companyName} Growth Rate`,
      summary: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: sourceLabel },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: sourceLabel },
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "Sustainable Growth", value: pct(derived.sustainableGrowth), source: "Realtime calculation" },
      ],
      components: [
        { label: "User growth input", value: pct(assumptions.growth), source: "Realtime Assumptions control" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Ticker-specific assumption" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Ticker-specific assumption" },
      ],
      formula: `Sustainable Growth = Reinvestment Rate x ROIC = ${pct(assumptions.reinvestment)} x ${pct(assumptions.roic)} / 100`,
      result: pct(derived.sustainableGrowth),
      sourcing: [
        { label: "Growth Rate", value: pct(assumptions.growth), source: "Manual Assumption / SQLite corporate_metrics" },
        { label: "Reinvestment Rate", value: pct(assumptions.reinvestment), source: "Manual Assumption / SQLite corporate_metrics" },
        { label: "ROIC", value: pct(assumptions.roic), source: "Manual Assumption / SQLite corporate_metrics" },
      ],
    },
    spread: {
      title: `${companyName} ROIC - WACC Spread`,
      summary: [
        { label: "ROIC", value: pct(assumptions.roic), source: sourceLabel },
        { label: "WACC", value: pct(assumptions.wacc), source: sourceLabel },
        { label: "Spread", value: pct(derived.spread), source: "Realtime calculation" },
        { label: "Status", value: derived.spread >= 0 ? "Value creation" : "Value destruction", source: "ROIC > WACC rule" },
      ],
      components: [
        { label: "Return on Invested Capital", value: pct(assumptions.roic), source: "Ticker-specific corporate metric" },
        { label: "Weighted Average Cost of Capital", value: pct(assumptions.wacc), source: "Ticker-specific corporate metric" },
      ],
      formula: `ROIC - WACC = ${pct(assumptions.roic)} - ${pct(assumptions.wacc)}`,
      result: pct(derived.spread),
      sourcing: [
        { label: "ROIC", value: pct(assumptions.roic), source: "Manual Assumption / SQLite corporate_metrics" },
        { label: "WACC", value: pct(assumptions.wacc), source: "Manual Assumption / SQLite corporate_metrics" },
        { label: "Benchmark", value: "Positive spread", source: "Corporate finance value-creation rule" },
      ],
    },
    bottomUpKe: {
      title: `${companyName} Bottom-up Ke`,
      summary: [
        { label: "Risk-free Rate", value: pct(RISK_FREE_RATE), source: "Manual macro assumption" },
        { label: "Levered Beta", value: numberText(derived.leveredBeta), source: "Hamada formula" },
        { label: "Equity Risk Premium", value: pct(ERP), source: "Manual market assumption" },
        { label: "Country Risk Premium", value: pct(assumptions.crp), source: sourceLabel },
        { label: "Bottom-up Ke", value: pct(derived.bottomUpKe), source: "Realtime calculation" },
      ],
      components: [
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Ticker-specific corporate metric" },
        { label: "Debt / Equity", value: numberText(derived.debtToEquity), source: `Debt Ratio ${pct(assumptions.debtRatio)} / Equity Ratio ${pct(100 - assumptions.debtRatio)}` },
        { label: "Tax Shield", value: pct((1 - TAX_RATE) * 100), source: `1 - tax rate ${pct(TAX_RATE * 100)}` },
        { label: "Levered Beta", value: numberText(derived.leveredBeta), source: "betaU x [1 + (1 - tax) x D/E]" },
      ],
      formula: `Ke = ${pct(RISK_FREE_RATE)} + ${numberText(derived.leveredBeta)} x ${pct(ERP)} + ${pct(assumptions.crp)}`,
      result: pct(derived.bottomUpKe),
      sourcing: [
        { label: "Risk-free Rate", value: pct(RISK_FREE_RATE), source: "Manual macro assumption" },
        { label: "ERP", value: pct(ERP), source: "Manual market assumption" },
        { label: "CRP", value: pct(assumptions.crp), source: "Manual Assumption / SQLite corporate_metrics" },
        { label: "Debt Ratio", value: pct(assumptions.debtRatio), source: "Manual Assumption / SQLite corporate_metrics" },
        { label: "Unlevered Beta", value: numberText(assumptions.unleveredBeta), source: "Manual Assumption / SQLite corporate_metrics" },
      ],
    },
  }), [assumptions, companyName, dcfQuery.data, derived, sourceLabel]);

  const activeCalculationDetail = activeCalculation ? calculationDetails[activeCalculation] : null;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
            Corporate Analysis
          </h1>
          <p className="text-[var(--text-muted)] mt-1">
            {companyName}: life cycle, hurdle rate, bottom-up beta, DCF, and project risk
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex min-w-72 flex-col gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <label htmlFor="company-search">Company Search</label>
            <input
              id="company-search"
              value={companySearch}
              onChange={(event) => setCompanySearch(event.target.value)}
              placeholder="Type a company name"
              className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-3 py-2 text-sm"
            />
            <div className="max-h-28 overflow-auto rounded-[var(--radius)] border border-[var(--border)] bg-white p-1 shadow-sm">
              {filteredCompanies.map((company) => (
                <button
                  key={company.ticker}
                  type="button"
                  onClick={() => {
                    setCompanySearch(company.name);
                    selectTicker(company.ticker);
                  }}
                  className={`block w-full rounded px-3 py-2 text-left text-sm transition hover:bg-[var(--surface)] ${
                    company.ticker === assumptions.ticker ? "bg-[var(--surface)] font-bold text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                  }`}
                >
                  {company.name}
                </button>
              ))}
              {filteredCompanies.length === 0 && (
                <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No saved companies match that name.</div>
              )}
            </div>
          </div>
          <form onSubmit={addCompany} className="grid min-w-72 grid-cols-2 gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-3 text-sm shadow-sm">
            <div className="col-span-2 text-xs font-semibold text-[var(--text-muted)]">Add Company</div>
            <input
              value={newCompanyName}
              onChange={(event) => setNewCompanyName(event.target.value)}
              placeholder="Company name"
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
            />
            <input
              value={newCompanySymbol}
              onChange={(event) => setNewCompanySymbol(event.target.value)}
              placeholder="Symbol"
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2"
            />
            <button
              type="submit"
              className="col-span-2 rounded-[var(--radius)] bg-[var(--accent)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              disabled={!newCompanyName.trim() || !newCompanySymbol.trim()}
            >
              Add for Analysis
            </button>
          </form>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white px-4 py-3 text-sm shadow-sm">
            <div className="text-xs text-[var(--text-muted)]">Backend DCF</div>
            <div className="font-bold text-[var(--text-primary)]">
              {dcfQuery.data ? `$${dcfQuery.data.estimated_value.toLocaleString()}` : "Calculating"}
              {dcfQuery.isFetching ? " ..." : ""}
            </div>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-6">
        <div className="xl:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveCalculation("realtime")}
            className="mb-4 text-left text-sm font-bold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 hover:text-[var(--accent)]"
          >
            <InfoTooltip
              label="Realtime Assumptions"
              description="Ticker-level inputs are saved independently in browser storage. WACC, ROIC, debt ratio, and beta update all visualizations immediately."
            />
          </button>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-1">
            <RangeControl label="Growth Rate" description="Expected long-run revenue growth used in DCF and value-driver positioning." value={assumptions.growth} min={-5} max={20} step={0.5} onDetailClick={() => setActiveCalculation("growth")} onChange={(value) => update("growth", value)} />
            <RangeControl label="ROIC" description="Return on invested capital. ROIC above WACC indicates value creation." value={assumptions.roic} min={-5} max={45} step={0.5} onChange={(value) => update("roic", value)} />
            <RangeControl label="WACC" description="Weighted average cost of capital used as the discount-rate hurdle." value={assumptions.wacc} min={2} max={24} step={0.25} onChange={(value) => update("wacc", value)} />
            <RangeControl label="Debt Ratio" description="Market-value debt weight used to approximate D/E in the Hamada levered beta formula." value={assumptions.debtRatio} min={0} max={90} step={1} onChange={(value) => update("debtRatio", value)} />
            <RangeControl label="Unlevered Beta" description="Industry/business risk before financial leverage. Levered beta adjusts this for debt." value={assumptions.unleveredBeta} min={0.4} max={2.5} step={0.05} suffix="" onChange={(value) => update("unleveredBeta", value)} />
            <RangeControl label="Country Risk Premium" description="Additional premium for geographic or sovereign risk exposure." value={assumptions.crp} min={0} max={8} step={0.1} onChange={(value) => update("crp", value)} />
            <RangeControl label="Reinvestment Rate" description="Share of after-tax operating income reinvested to support growth. Sustainable growth equals this rate times ROIC." value={assumptions.reinvestment} min={0} max={90} step={1} onChange={(value) => update("reinvestment", value)} />
            <RangeControl label="Innovation Index" description="Qualitative product and technology momentum score used in the company health radar." value={assumptions.innovation} min={0} max={100} step={1} onChange={(value) => update("innovation", value)} />
            <RangeControl label="Governance Quality" description="Proxy for ownership alignment, voting structure, disclosure quality, and management accountability." value={assumptions.governance} min={0} max={100} step={1} onChange={(value) => update("governance", value)} />
            <RangeControl label="ESG / Agency Penalty" description="Penalty score for agency costs, governance friction, and ESG-related execution risk." value={assumptions.esgPenalty} min={0} max={100} step={1} onChange={(value) => update("esgPenalty", value)} />
          </div>
        </div>

        <div className="xl:col-span-4 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <button
            type="button"
            onClick={() => setActiveCalculation("spread")}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--accent)]"
          >
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="ROIC - WACC"
                description={`Spread between return on invested capital and WACC. Basis: ${pct(assumptions.roic)} ROIC - ${pct(assumptions.wacc)} WACC = ${pct(derived.spread)}. Positive is good because returns exceed the hurdle rate; current status is ${derived.spread >= 0 ? "Good, value creation" : "Bad, value destruction"}.`}
              />
            </div>
            <div className={`mt-1 text-3xl font-black ${derived.spread >= 0 ? "text-[var(--accent)]" : "text-[var(--delta-down)]"}`}>
              {pct(derived.spread)}
            </div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">
              {derived.spread >= 0 ? "Value creation" : "Value destruction"}
            </div>
          </button>
          <button
            type="button"
            onClick={() => setActiveCalculation("bottomUpKe")}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 text-left shadow-sm transition hover:border-[var(--accent)]"
          >
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="Bottom-up Ke"
                description={`Cost of equity estimate. Basis: risk-free rate ${pct(RISK_FREE_RATE)} + levered beta ${derived.leveredBeta.toFixed(2)} x ERP ${pct(ERP)} + CRP ${pct(assumptions.crp)} = ${pct(derived.bottomUpKe)}. Lower is generally better, but it must still reflect real risk.`}
              />
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--text-primary)]">{pct(derived.bottomUpKe)}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">rf + beta x ERP + CRP</div>
          </button>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="Levered Beta"
                description={`Equity risk after financial leverage. Basis: betaU ${assumptions.unleveredBeta.toFixed(2)} x [1 + (1 - ${pct(TAX_RATE * 100)}) x D/E ${derived.debtToEquity.toFixed(2)}] = ${derived.leveredBeta.toFixed(2)}. Around 1.0 tracks market risk; above 1.3 is higher-risk.`}
              />
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--text-primary)]">{derived.leveredBeta.toFixed(2)}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">Hamada adjusted</div>
          </div>
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              <InfoTooltip
                label="Success Probability"
                description={`Scenario score from spread, growth, and agency/ESG penalty. Current basis: spread ${pct(derived.spread)}, growth ${pct(assumptions.growth)}, penalty ${assumptions.esgPenalty.toFixed(0)}. Above 60% is good; current status is ${derived.successProbability >= 60 ? "Good" : "Weak"}.`}
              />
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--accent)]">{pct(derived.successProbability)}</div>
            <div className="mt-2 text-xs text-[var(--text-muted)]">Risk-return scenario</div>
          </div>

          <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                <InfoTooltip
                  label="Company Status Diagnosis"
                  description="Radar axes combine growth speed, market share, innovation, life-cycle position, governance, and agency risk into a single company health view."
                />
              </h2>
              <div
                className="h-14 w-14 rounded-full border-4 flex items-center justify-center text-sm font-black"
                style={{
                  borderColor: derived.agencyRisk > 55 ? "var(--delta-down)" : "var(--accent)",
                  backgroundColor: derived.healthScore > 65 ? "rgba(96,202,173,0.12)" : "rgba(157,165,162,0.14)",
                }}
              >
                {derived.healthScore.toFixed(0)}
              </div>
            </div>
            <div className="h-72 min-h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <RadarChart data={healthRadar}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name={companyName} dataKey="score" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.45} />
                  <Radar name="Peer" dataKey="peer" stroke="var(--text-muted)" fill="var(--text-muted)" fillOpacity={0.16} />
                  <Tooltip />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="Hurdle Rate Decomposition"
                description="Cost of equity is estimated as risk-free rate plus levered beta times equity risk premium plus country risk premium."
              />
            </h2>
            <div className="h-72 min-h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <ComposedChart data={regionalMinard} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="region" tick={{ fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fill: "var(--text-muted)" }} />
                  <ZAxis dataKey="revenue" range={[80, 520]} />
                  <Tooltip />
                  <Bar dataKey="crp" name="CRP" fill="#444444" radius={[4, 4, 0, 0]} />
                  <Line dataKey="erp" name="ERP" stroke="var(--accent)" strokeWidth={3} dot={{ r: 4 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-[var(--text-muted)]">
              {hurdleBars.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.fill }} />
                  {item.name}: {pct(item.value)}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="Bottom-up Beta + WACC U-Curve"
                description="Levered beta uses the Hamada formula. The WACC curve shows how capital structure changes the discount-rate tradeoff."
              />
            </h2>
            <div className="grid h-72 min-h-72 min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <BarChart data={betaTreemapProxy}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                  <YAxis tick={{ fill: "var(--text-muted)" }} />
                  <Tooltip />
                  <Bar dataKey="beta" name="Beta" radius={[4, 4, 0, 0]}>
                    {betaTreemapProxy.map((entry) => (
                      <Cell key={entry.name} fill={entry.beta > 1.3 ? "#444444" : "#60CAAD"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <LineChart data={waccCurve}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="debt" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                  <YAxis tick={{ fill: "var(--text-muted)" }} />
                  <Tooltip formatter={(value) => pct(Number(value))} />
                  <Line type="monotone" dataKey="wacc" stroke="var(--accent)" strokeWidth={3} dot={false} />
                  <ReferenceLine x={assumptions.debtRatio} stroke="#444444" strokeDasharray="4 4" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="4-Quadrant Value Driver Matrix"
                description="X-axis is growth. Y-axis is ROIC minus WACC. Bubble size approximates FCFF magnitude, highlighting value creation or destruction."
              />
            </h2>
            <div className="h-72 min-h-72 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis type="number" dataKey="growth" name="Growth" tick={{ fill: "var(--text-muted)" }} />
                  <YAxis type="number" dataKey="spread" name="ROIC - WACC" tick={{ fill: "var(--text-muted)" }} />
                  <ZAxis type="number" dataKey="fcff" range={[90, 520]} name="FCFF" />
                  <ReferenceLine y={0} stroke="#444444" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter data={valueMatrix} name="Capital efficiency">
                    {valueMatrix.map((entry) => (
                      <Cell key={entry.name} fill={entry.name === companyName ? "var(--accent)" : "#9DA5A2"} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-4 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:justify-between">
              <h2 className="text-sm font-bold text-[var(--text-primary)]">
                <InfoTooltip
                  label="Risk-Return Minard Chart"
                  description="NPV path is plotted across risk variables. Stroke thickness represents success probability, with the area layer indicating failure probability."
                />
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                Line thickness proxy: success probability. Area: failure distribution.
              </p>
            </div>
            <div className="h-80 min-h-80 min-w-0">
              <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={CHART_INITIAL_DIMENSION}>
                <AreaChart data={riskReturn} margin={{ top: 20, right: 24, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="risk" tick={{ fill: "var(--text-muted)" }} />
                  <YAxis tick={{ fill: "var(--text-muted)" }} />
                  <Tooltip />
                  <ReferenceLine y={0} stroke="#444444" />
                  <Area type="monotone" dataKey="fail" name="Failure probability" stroke="#9DA5A2" fill="#9DA5A2" fillOpacity={0.22} />
                  <Line type="monotone" dataKey="npv" name="NPV path" stroke={derived.spread >= 0 ? "var(--accent)" : "var(--delta-down)"} strokeWidth={Math.max(2, derived.successProbability / 18)} dot={{ r: 4 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-4 rounded-[var(--radius)] border border-[var(--border)] bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-[var(--text-primary)]">
              <InfoTooltip
                label="DCF Core Modules"
                description="Sustainable growth is reinvestment rate times ROIC. Terminal value share estimates how much enterprise value comes from terminal assumptions."
              />
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              <div>
                <div className="text-xs text-[var(--text-muted)]">Sustainable Growth</div>
                <div className="text-2xl font-black">{pct(derived.sustainableGrowth)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Terminal Value Share</div>
                <div className="text-2xl font-black">{pct(derived.terminalValueShare)}</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">FCFF Magnitude</div>
                <div className="text-2xl font-black">${assumptions.fcff.toFixed(0)}B</div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-muted)]">Backend Fair Value</div>
                <div className="text-2xl font-black">
                  {dcfQuery.data ? `$${dcfQuery.data.estimated_value.toFixed(2)}` : "N/A"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {activeCalculationDetail && (
        <CalculationDetailModal
          detail={activeCalculationDetail}
          onClose={() => setActiveCalculation(null)}
        />
      )}
    </div>
  );
}
