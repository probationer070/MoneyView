"use client";

import React, { useState, useEffect } from "react";

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
  // Pydantic strict-boundaries mapped seamlessly into native React bounds.
  const [wacc, setWacc] = useState(initialWacc);       // 1 - 50%
  const [margin, setMargin] = useState(initialMargin); // -100 - 100%
  const [growth, setGrowth] = useState(initialGrowth); // -99 - 200%

  useEffect(() => {
    // Triggers local UI state up to parent wrapper (which will handle Debouncing)
    onChange({ wacc, margin, growth });
  }, [wacc, margin, growth, onChange]);

  return (
    <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-6">
      <h2 className="mb-4 text-[length:var(--type-section-title)] font-bold text-[var(--text-primary)]">Interactive DCF Scenarios</h2>
      <div className="space-y-6">

        {/* WACC Control */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[length:var(--type-label)] font-semibold text-[var(--text-muted)]">Discount Rate (WACC)</span>
            <span className="text-[length:var(--type-label)] font-black text-[var(--text-primary)]">{wacc.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="1"
            max="50"
            step="0.5"
            value={wacc}
            onChange={(e) => setWacc(parseFloat(e.target.value))}
            className="w-full accent-[var(--surface)] h-2 bg-[var(--surface-muted)] rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Operating Margin */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[length:var(--type-label)] font-semibold text-[var(--text-muted)]">Target Operating Margin</span>
            <span className="text-[length:var(--type-label)] font-black text-[var(--text-primary)]">{margin.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="-100"
            max="100"
            step="1"
            value={margin}
            onChange={(e) => setMargin(parseFloat(e.target.value))}
            className="w-full accent-[var(--surface)] h-2 bg-[var(--surface-muted)] rounded-lg appearance-none cursor-pointer"
          />
        </div>

        {/* Target Growth */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <span className="text-[length:var(--type-label)] font-semibold text-[var(--text-muted)]">Terminal Rev Growth</span>
            <span className="text-[length:var(--type-label)] font-black text-[var(--text-primary)]">{growth.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="-50"
            max="100"
            step="1"
            value={growth}
            onChange={(e) => setGrowth(parseFloat(e.target.value))}
            className="w-full accent-[var(--surface)] h-2 bg-[var(--surface-muted)] rounded-lg appearance-none cursor-pointer"
          />
        </div>

      </div>
    </div>
  );
};
