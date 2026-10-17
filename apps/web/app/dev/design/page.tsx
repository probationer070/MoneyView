"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { BeforeAfter } from "@/components/ui/BeforeAfter";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { DenseTable } from "@/components/ui/DenseTable";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { RollingNumber } from "@/components/ui/RollingNumber";
import { Sparkline } from "@/components/ui/Sparkline";
import { ToggleGroup } from "@/components/ui/ToggleGroup";
import { formatNumber } from "@/lib/format";

// Component gallery: the deterministic surface for component tests and visual review
// (design-system plan, Tasks 7-8). Sample values are constants.
const ROWS = [
  { name: "삼성전자", price: "71,200", change: 1.24 },
  { name: "SK하이닉스", price: "182,500", change: -0.87 },
];
const RANGES = [{ value: "1M", label: "1M" }, { value: "3M", label: "3M" }, { value: "1Y", label: "1Y" }];
const SPARK = [3, 4, 3.5, 5, 4.8, 6];
const noop = () => {};
// Motion bench (motion-system plan, Task 2): a fixed value sequence so tests know every string.
const BENCH_PRICE = [71200.5, 72350.75, 69980.25, 105000];
const BENCH_PCT = [1.24, -0.87, 12.5, -3.4];
const price = (n: number) => formatNumber(n, "price");
const pct = (n: number) => formatNumber(n / 100, "percent", { signed: true });

export default function DesignGalleryPage() {
  const [range, setRange] = useState("3M");
  const [step, setStep] = useState(0);
  const [missing, setMissing] = useState(false);
  const [tick, setTick] = useState(0);
  const priceNow = BENCH_PRICE[step % BENCH_PRICE.length];
  const previousPrice = step > 0 ? price(BENCH_PRICE[(step - 1) % BENCH_PRICE.length]) : null;
  return (
    <div className="flex flex-col gap-8 p-6">
      <section data-testid="gallery-eyebrow"><Eyebrow index={1} label="market" /></section>
      <section data-testid="gallery-buttons" className="flex gap-3">
        <ActionButton label="Primary" variant="primary" onClick={noop} />
        <ActionButton label="Secondary" onClick={noop} />
        <ActionButton label="Small" size="sm" onClick={noop} />
        <ActionButton label="Disabled" disabled onClick={noop} />
      </section>
      <section data-testid="gallery-deltas" className="flex gap-3">
        <DeltaBadge value={1.24} />
        <DeltaBadge value={-3.4} />
        <DeltaBadge value={-0.04} />
        <DeltaBadge value={null} />
        <DeltaBadge value={-0.05} />
        <DeltaBadge value={0.05} />
      </section>
      <Card>
        <div data-testid="gallery-card-body"><KPIBlock label="KOSPI" value="2,847.31" delta={1.24} size="lg" /></div>
      </Card>
      <section data-testid="gallery-toggle">
        <ToggleGroup options={RANGES} value={range} onChange={setRange} ariaLabel="Range" />
      </section>
      <section data-testid="gallery-motion" data-tick={tick} className="flex flex-col gap-3">
        <div className="flex gap-3">
          <span data-testid="motion-next"><ActionButton label="Next value" size="sm" onClick={() => { setMissing(false); setStep((s) => s + 1); }} /></span>
          <span data-testid="motion-same"><ActionButton label="Set same value" size="sm" onClick={() => setTick((t) => t + 1)} /></span>
          <span data-testid="motion-missing"><ActionButton label="Missing" size="sm" onClick={() => setMissing(true)} /></span>
        </div>
        <div className="type-mono flex gap-6">
          <RollingNumber testId="motion-roll-price" value={missing ? null : priceNow} format={price} />
          <RollingNumber testId="motion-roll-enter" value={BENCH_PRICE[0]} format={price} enter />
          <RollingNumber testId="motion-roll-pct" value={missing ? null : BENCH_PCT[step % BENCH_PCT.length]} format={pct} />
          <span data-testid="motion-delta"><DeltaBadge animate value={missing ? null : BENCH_PCT[step % BENCH_PCT.length]} /></span>
          <span data-testid="motion-before-after"><BeforeAfter previous={previousPrice} current={price(priceNow)} /></span>
        </div>
      </section>
      <section className="w-48"><Sparkline data={SPARK} /></section>
      <section data-testid="motion-spark-draw" className="w-48"><Sparkline data={SPARK} draw /></section>
      <section data-testid="gallery-table">
        <DenseTable
          columns={[
            { key: "name", label: "name" },
            { key: "price", label: "price", align: "right" },
            { key: "change", label: "change", align: "right", render: (v) => <DeltaBadge value={v as number} /> },
          ]}
          data={ROWS}
        />
      </section>
    </div>
  );
}
