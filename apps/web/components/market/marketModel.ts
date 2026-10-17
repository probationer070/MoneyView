import type { MarketSpread } from "../../../../packages/shared-types";
import type { MessageKey } from "@/lib/i18n/translate";
import { formatNumber, type FormatLocale } from "@/lib/format";
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
  /** The one-month change, sent alongside the daily delta (spec §2.2). */
  month_delta?: { delta_pct: number; delta_abs?: number | null } | null;
}

/** A card's change line: a percent, a basis-point move for a rate, or nothing to show. */
export type ChangeFigure = { kind: "pct"; pct: number } | { kind: "bp"; bp: number } | { kind: "missing" };

/**
 * Spec §2.2: a rate moves in basis points (delta_abs is in percentage points, so 0.1 = 10bp); every
 * other instrument moves in percent. A rate with no absolute change is missing, not a percent.
 */
export function changeFigure(
  delta: { delta_pct: number; delta_abs?: number | null } | null | undefined,
  instrumentType: string | undefined,
): ChangeFigure {
  if (delta === null || delta === undefined) return { kind: "missing" };
  if (instrumentType === "rate") {
    if (typeof delta.delta_abs !== "number" || !Number.isFinite(delta.delta_abs)) return { kind: "missing" };
    // Round half away from zero: plain Math.round sends 0.5 to +1 but -0.5 to 0, so +0.005 and -0.005 would not mirror.
    const scaled = delta.delta_abs * 100;
    const bp = Math.sign(scaled) * Math.round(Math.abs(scaled));
    return { kind: "bp", bp: bp === 0 ? 0 : bp };
  }
  return Number.isFinite(delta.delta_pct) ? { kind: "pct", pct: delta.delta_pct } : { kind: "missing" };
}

/** A card's headline value. A rate's last close is a yield in percent points: 4.25 reads "4.25%" (formatNumber's percent takes a fraction). */
export function instrumentValueText(
  quote: { instrument_type?: string; last_close: number | null },
  locale: FormatLocale,
): string {
  return quote.instrument_type === "rate" && typeof quote.last_close === "number"
    ? formatNumber(quote.last_close / 100, "percent", { digits: 2, locale })
    : formatNumber(quote.last_close, "price", { digits: 1, locale });
}

/** "+10bp", "-3bp", "0bp". No locale grouping: a basis-point move is a small whole number. */
export function formatBp(bp: number): string {
  if (bp > 0) return `+${bp}bp`;
  return `${bp}bp`;
}

// Spec §1.1: each overview ticker's display name is a catalog key, so Korean is not the API's English name.
const INSTRUMENT_NAME_KEYS = {
  "^GSPC": "market.names.sp500",
  "^DJI": "market.names.dow",
  "^IXIC": "market.names.nasdaq",
  "^KS200": "market.names.kospi200",
  SOXX: "market.names.semis",
  SKYY: "market.names.cloud",
  BOTZ: "market.names.ai",
  "^TNX": "market.names.us10y",
  "GC=F": "market.names.gold",
  "CL=F": "market.names.wti",
  "NG=F": "market.names.natgas",
  "KRW=X": "market.names.usdkrw",
  "BTC-USD": "market.names.bitcoin",
  "^VIX": "market.names.vix",
} as const satisfies Record<string, MessageKey>;

/** The catalog key for a ticker's name, or null for a ticker not in the overview (the caller shows the API name). */
export function instrumentNameKey(ticker: string): MessageKey | null {
  return Object.hasOwn(INSTRUMENT_NAME_KEYS, ticker) ? INSTRUMENT_NAME_KEYS[ticker as keyof typeof INSTRUMENT_NAME_KEYS] : null;
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
