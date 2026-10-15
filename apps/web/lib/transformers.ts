/**
 * Centralized Data Normalization Layer
 * Enforces strict formatting boundaries between generic Python API envelopes
 * and hyper-optimized charting/rendering libraries.
 */

import type {
    AttributionResult,
    AttributionEffects,
    SectorAttribution as SectorBreakdown,
} from "../../../packages/shared-types/generated/portfolio";
import { tokens } from "@/lib/tokens.generated";

export type { AttributionResult, AttributionEffects, SectorBreakdown };

// Basic API StockOHLCV typing
export interface RawOHLCV {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

// ------------------------------------------------------------------------
// TradingView Formatters
// ------------------------------------------------------------------------

export interface TVCandle {
    time: string;
    open: number;
    high: number;
    low: number;
    close: number;
}

export interface TVVolume {
    time: string;
    value: number;
    color: string;
}

/**
 * Transforms generic API OHLCV arrays into strict TradingView Candlestick series mapped arrays.
 * Strips out unused metrics to minimize WebGL canvas memory footprints.
 */
export function transformToTVCandles(data: RawOHLCV[]): TVCandle[] {
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    
    return data.map(item => ({
        time: item.date ?? "", 
        open: Number.isFinite(item.open) ? item.open : 0,
        high: Number.isFinite(item.high) ? item.high : 0,
        low: Number.isFinite(item.low) ? item.low : 0,
        close: Number.isFinite(item.close) ? item.close : 0,
    })).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()); 
}

const VOLUME_ALPHA = 0.4;

/** A canvas cannot resolve var(), so the token's hex is turned into rgba with the bar alpha here. */
function withAlpha(hex: string, alpha: number): string {
    const value = Number.parseInt(hex.slice(1), 16);
    // The rule reads rgba() as a raw colour. Here the channels come from a token at runtime,
    // so the alpha is the only value this function adds.
    // eslint-disable-next-line moneyview/no-raw-design-values -- rgba built from a token hex at runtime
    return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/**
 * Transforms generic API OHLCV arrays into TradingView Histogram metrics, logically
 * colorizing Red/Green volume bars based on close-open deltas.
 */
export function transformToTVVolume(data: RawOHLCV[]): TVVolume[] {
    if (!data || data.length === 0) return [];
    
    return data.map(item => {
        // Local market convention: red for price up, blue for price down.
        const isUp = item.close >= item.open;
        return {
            time: item.date,
            value: item.volume,
            color: withAlpha(isUp ? tokens.up._ : tokens.down._, VOLUME_ALPHA),
        };
    }).sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

/**
 * Sanitizes input text explicitly neutralizing raw HTML tags to prevent XSS.
 * Critical safety block before injecting tooltips into interactive TV canvases.
 */
export function sanitizeTooltip(input: string): string {
    if (!input) return "";
    return input.replace(/<\/?[^>]+(>|$)/g, ""); // Strip all standard HTML 
}

// ------------------------------------------------------------------------
// Portfolio Attribution Adapters (domain -> chart)
// ------------------------------------------------------------------------

export function toAllocationDonutData(data: AttributionResult): Array<{ name: string; value: number }> {
    if (!data?.sector_breakdowns?.length) return [];
    return data.sector_breakdowns.map((row) => ({
        name: row.sector,
        value: Math.max(0, row.portfolio_weight),
    }));
}

export function toAttributionWaterfallData(data: AttributionResult): Array<{ name: string; value: number; cumulative: number }> {
    if (!data) return [];
    const rows = [
        { name: "Allocation", value: data.effects.allocation },
        { name: "Selection", value: data.effects.selection },
        { name: "Interaction", value: data.effects.interaction },
        { name: "Active Return", value: data.active_return },
    ];
    let cumulative = 0;
    return rows.map((row) => {
        cumulative += row.value;
        return { ...row, cumulative };
    });
}
