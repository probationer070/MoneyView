"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Card } from "@/components/ui/Card";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { DenseTable } from "@/components/ui/DenseTable";
import { Eyebrow } from "@/components/ui/Eyebrow";
import { KPIBlock } from "@/components/ui/KPIBlock";
import { Sparkline } from "@/components/ui/Sparkline";
import { ToggleGroup } from "@/components/ui/ToggleGroup";

// Component gallery: the deterministic surface for component tests and visual review
// (design-system plan, Tasks 7-8). Sample values are constants.
const ROWS = [
  { name: "삼성전자", price: "71,200", change: 1.24 },
  { name: "SK하이닉스", price: "182,500", change: -0.87 },
];
const RANGES = [{ value: "1M", label: "1M" }, { value: "3M", label: "3M" }, { value: "1Y", label: "1Y" }];
const SPARK = [3, 4, 3.5, 5, 4.8, 6];
const noop = () => {};

export default function DesignGalleryPage() {
  const [range, setRange] = useState("3M");
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
      <section className="w-48"><Sparkline data={SPARK} /></section>
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
