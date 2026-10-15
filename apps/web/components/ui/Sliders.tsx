"use client";

import React, { useState, useEffect } from "react";
import { useLocale } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";

interface SlidersProps {
  initialWacc?: number;
  initialMargin?: number;
  initialGrowth?: number;
  onChange: (values: { wacc: number; margin: number; growth: number }) => void;
}

export const Sliders: React.FC<SlidersProps> = ({
  initialWacc = 10,
  initialMargin = 15,
  initialGrowth = 5,
  onChange,
}) => {
  const { locale } = useLocale();
  // Pydantic strict-boundaries mapped seamlessly into native React bounds.
  const [wacc, setWacc] = useState(initialWacc);       // 1 - 50%
  const [margin, setMargin] = useState(initialMargin); // -100 - 100%
  const [growth, setGrowth] = useState(initialGrowth); // -99 - 200%

  useEffect(() => {
    // Triggers local UI state up to parent wrapper (which will handle Debouncing)
    onChange({ wacc, margin, growth });
  }, [wacc, margin, growth, onChange]);

  return (
    <div className="border border-[var(--line)] bg-[var(--surface-raised)] p-6">
      <h2 className="mb-4 type-panel-title text-[var(--ink)]">Interactive DCF Scenarios</h2>
      <div className="space-y-6">

        {/* WACC Control */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="type-small text-[var(--ink-muted)]">Discount Rate (WACC)</span>
            <span className="type-mono text-[var(--ink)]">{formatNumber(wacc / 100, "percent", { locale })}</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            step="0.5"
            value={wacc}
            onChange={(e) => setWacc(parseFloat(e.target.value))}
            className="w-full accent-[var(--brand)] h-2 rounded-[var(--radius-1)] bg-[var(--surface)] appearance-none cursor-pointer"
          />
        </div>

        {/* Operating Margin */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="type-small text-[var(--ink-muted)]">Target Operating Margin</span>
            <span className="type-mono text-[var(--ink)]">{formatNumber(margin / 100, "percent", { locale })}</span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            step="1"
            value={margin}
            onChange={(e) => setMargin(parseFloat(e.target.value))}
            className="w-full accent-[var(--brand)] h-2 rounded-[var(--radius-1)] bg-[var(--surface)] appearance-none cursor-pointer"
          />
        </div>

        {/* Target Growth */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="type-small text-[var(--ink-muted)]">Terminal Rev Growth</span>
            <span className="type-mono text-[var(--ink)]">{formatNumber(growth / 100, "percent", { locale })}</span>
          </div>
          <input
            type="range"
            min="-50"
            max="100"
            step="1"
            value={growth}
            onChange={(e) => setGrowth(parseFloat(e.target.value))}
            className="w-full accent-[var(--brand)] h-2 rounded-[var(--radius-1)] bg-[var(--surface)] appearance-none cursor-pointer"
          />
        </div>

      </div>
    </div>
  );
};
