"use client";

import React, { useEffect, useRef } from "react";
import { createChart, IChartApi, ISeriesApi, ColorType, CrosshairMode, CandlestickSeries, HistogramSeries } from "lightweight-charts";
import { TVCandle, TVVolume, sanitizeTooltip } from "@/lib/transformers";

interface TVChartProps {
    data: TVCandle[];
    volumeData?: TVVolume[];
    height?: number;
    colorAccent?: string;
    upColor?: string;
    downColor?: string;
    tickerName?: string;
}

const TVChart: React.FC<TVChartProps> = ({
    data,
    volumeData,
    height = 500,
    colorAccent = "#EF5350",
    upColor,
    downColor = "#4589E5",
    tickerName = "Overview"
}) => {
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
    const safeTickerName = sanitizeTooltip(tickerName);

    useEffect(() => {
        if (!chartContainerRef.current) return;

        // 1. Initialize Chart
        const chart = createChart(chartContainerRef.current, {
            height: height,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#9DA5A2",
            },
            grid: {
                vertLines: { color: "rgba(100, 100, 100, 0.1)" },
                horzLines: { color: "rgba(100, 100, 100, 0.1)" },
            },
            crosshair: {
                mode: CrosshairMode.Normal,
            },
            rightPriceScale: {
                borderColor: "rgba(100, 100, 100, 0.2)",
            },
            timeScale: {
                borderColor: "rgba(100, 100, 100, 0.2)",
            },
        });

        // 2. Candlestick Series setup (v5 API Migration)
        const candleSeries = chart.addSeries(CandlestickSeries, {
            upColor: upColor ?? colorAccent,
            downColor,
            borderVisible: false,
            wickUpColor: upColor ?? colorAccent,
            wickDownColor: downColor,
        });

        // 3. Volume Histogram Series setup (v5 API Migration)
        const volumeSeries = chart.addSeries(HistogramSeries, {
            color: colorAccent,
            priceFormat: {
                type: "volume",
            },
            priceScaleId: "", // Sets as overlay
        });
        
        // Scale overlay margins
        chart.priceScale("").applyOptions({
            scaleMargins: {
                top: 0.8, 
                bottom: 0,
            },
        });

        chartRef.current = chart;
        candleSeriesRef.current = candleSeries;
        volumeSeriesRef.current = volumeSeries;

        // Dynamic Resize Observer with requestAnimationFrame Throttling (P1 Risk Block)
        let animationFrameId: number;
        const resizeObserver = new ResizeObserver((entries) => {
            if (entries.length === 0 || entries[0].target !== chartContainerRef.current) return;
            const newRect = entries[0].contentRect;
            
            cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(() => {
                 chart.applyOptions({ width: newRect.width });
            });
        });

        resizeObserver.observe(chartContainerRef.current);

        // Cleanup instance securely preventing silent canvas WebGL memory leak
        return () => {
            resizeObserver.disconnect();
            cancelAnimationFrame(animationFrameId);
            chart.remove();
        };
    }, [colorAccent, downColor, height, upColor]); // Explicit rigid dependency bounds

    // ----------------------------------------------------
    // Execute Data Updates seamlessly off main render
    // ----------------------------------------------------
    useEffect(() => {
        if (candleSeriesRef.current && data?.length) {
            candleSeriesRef.current.setData(data);
        }
        if (volumeSeriesRef.current && volumeData?.length) {
            volumeSeriesRef.current.setData(volumeData);
        }
        
        if (chartRef.current) {
            // Auto fit all updated data smoothly
            chartRef.current.timeScale().fitContent();
        }
    }, [data, volumeData]); // Only recompute on strict data matrix swaps

    return (
        <div 
            ref={chartContainerRef} 
            aria-label={`${safeTickerName} price chart`}
            className="w-full relative rounded-lg border border-[var(--border)] bg-[var(--text-primary)]"
            style={{ minHeight: height }}
        />
    );
};

// React.memo aggressively blocks DOM repaints during generic page layout shifts 
// or unrelated DCF Slider parameter toggles (Step B).
export default React.memo(TVChart, (prevProps, nextProps) => {
    // Only repaint if raw OHLCV fundamentally shifts.
    return prevProps.data === nextProps.data && prevProps.volumeData === nextProps.volumeData;
});
