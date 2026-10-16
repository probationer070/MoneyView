import type { MarketSpread } from "../../../../packages/shared-types";
import type { MessageKey } from "@/lib/i18n/translate";
import { tabStateKey } from "@/lib/tabState";
import type { MarketRegimeState } from "@/lib/useMarketRegime";

/** One instrument card: GET /api/v1/market/indices (IndexQuote). `delta.delta_pct` is in percent (1.24 = +1.24%). */
export interface MarketIndexQuote {
  name: string;
  ticker: string;
  instrument_type?: string;
  last_close: number | null;
  delta: {
    delta_pct: number;
    delta_abs?: number | null;
  };
  sparkline: number[];
  /** Not sent by IndexQuote today, so cards show the "Snapshot" fallback (plan N8). */
  period?: string | null;
}

// Spec §2.1: the overview's two page tabs, in order.
export const MARKET_PAGE_TABS = ["instruments", "spreads"] as const;
export type MarketPageTab = (typeof MARKET_PAGE_TABS)[number];
/** sessionStorage key "moneyview.tab.market.pageTab"; useTabState stores the value as JSON. */
export const MARKET_PAGE_TAB_KEY = tabStateKey("market", "pageTab");

export const isMarketPageTab = (value: unknown): value is MarketPageTab =>
  typeof value === "string" && (MARKET_PAGE_TABS as readonly string[]).includes(value);

export type RegimeTone = "up" | "down" | "neutral";

// Spec §2.5: risk-on is the up colour, risk-off the down colour, mixed plain ink. "unknown" is not
// here on purpose: it has its own state and is never drawn as mixed.
const REGIME_LABELS = {
  risk_on: { key: "market.regime.riskOn", tone: "up" },
  mixed: { key: "market.regime.mixed", tone: "neutral" },
  risk_off: { key: "market.regime.riskOff", tone: "down" },
} as const satisfies Record<string, { key: MessageKey; tone: RegimeTone }>;

export type RegimeView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unknown" }
  | { kind: "ready"; labelKey: MessageKey; tone: RegimeTone; advancers: number; indexCount: number; riskOn: number; riskOff: number };

/**
 * What the header's regime line shows. The counts are the backend's, as sent: the frontend counts
 * nothing, because which tickers are equity indices (^VIX is not) is decided only in the backend.
 * Own keys only, so a label such as "constructor" reads as unknown instead of reaching Object.prototype.
 */
export function regimeView({ status, regime }: MarketRegimeState): RegimeView {
  if (status === "loading") return { kind: "loading" };
  if (status === "error") return { kind: "error" };
  if (regime === null || regime.equity_index_count <= 0 || !Object.hasOwn(REGIME_LABELS, regime.regime_label)) {
    return { kind: "unknown" };
  }
  const { key, tone } = REGIME_LABELS[regime.regime_label as keyof typeof REGIME_LABELS];
  return {
    kind: "ready",
    labelKey: key,
    tone,
    advancers: regime.equity_advancers,
    indexCount: regime.equity_index_count,
    riskOn: regime.risk_on_signals,
    riskOff: regime.risk_off_signals,
  };
}

export type FigurePart = { kind: "text" | "figure"; text: string };

/**
 * Splits a translated template on its {name} placeholders, so each figure can be set in mono
 * (DESIGN.md: a figure inside a sentence is wrapped in type-mono). The word order stays the
 * catalog's. A placeholder with no own value is kept as text, so a missing figure is visible.
 */
export function withFigures(template: string, figures: Record<string, string>): FigurePart[] {
  const parts: FigurePart[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{(\w+)\}/g)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: template.slice(last, at) });
    parts.push(Object.hasOwn(figures, match[1]) ? { kind: "figure", text: figures[match[1]] } : { kind: "text", text: match[0] });
    last = at + match[0].length;
  }
  if (last < template.length) parts.push({ kind: "text", text: template.slice(last) });
  return parts;
}

/** One spread on the first screen (spec §2.3): the tickers are always named, and a refused pair has no value. */
export interface SpreadFigure {
  id: string;
  label: string;
  /** "BOTZ/^GSPC": the proxy is named every time a figure is. */
  pair: string;
  /** The latest value, indexed to 100 at the window start; null when refused or not sent. */
  latest: number | null;
  refused: boolean;
}

export function spreadFigure(spread: MarketSpread): SpreadFigure {
  const refused = spread.refused_reason !== null;
  return {
    id: spread.id,
    label: spread.label,
    pair: `${spread.numerator}/${spread.denominator}`,
    latest: refused ? null : spread.latest,
    refused,
  };
}
