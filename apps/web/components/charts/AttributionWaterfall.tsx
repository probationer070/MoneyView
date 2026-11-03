"use client";

import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartPanelFrame } from "@/components/charts/ChartPanelFrame";
import { useLocale, useT } from "@/lib/i18n/locale";
import { formatNumber } from "@/lib/format";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { ResponsiveChart } from "@/components/ui/ResponsiveChart";
import { GRID_STYLE, fmtPctTick, withAxisProps, withCategoryAxisProps, withTooltipProps } from "@/lib/chartConfig";

type Translate = ReturnType<typeof useT>;

interface AttributionWaterfallProps {
  data: Array<{ name: string; value: number }>;
  sectorBreakdowns?: Array<{
    sector: string;
    allocation_effect: number;
    selection_effect: number;
    interaction_effect: number;
    active_contribution: number;
  }>;
}

function percentText(value: number) {
  return formatNumber(value, "percent", { digits: 2 });
}

function topSectorDriver(
  sectorBreakdowns: NonNullable<AttributionWaterfallProps["sectorBreakdowns"]>,
  key: "allocation_effect" | "selection_effect" | "interaction_effect" | "active_contribution",
  t: Translate,
) {
  const top = sectorBreakdowns
    .filter((row) => Number.isFinite(row[key]))
    .sort((a, b) => Math.abs(b[key]) - Math.abs(a[key]))[0];
  if (!top || Math.abs(top[key]) < 0.00005) return t("attribution.waterfall.driver.none");
  return t("attribution.waterfall.driver.top", { sector: top.sector, value: percentText(top[key]) });
}

export function AttributionWaterfall({ data, sectorBreakdowns = [] }: AttributionWaterfallProps) {
  const { locale } = useLocale();
  const t = useT();
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const formatted = data.map((row) => ({
    ...row,
    percentage: row.value * 100,
  }));

  const effectDetails = useMemo(() => {
    const values = Object.fromEntries(data.map((row) => [row.name, row.value]));
    return [
      {
        name: t("attribution.waterfall.effects.allocation.name"),
        value: values.Allocation ?? 0,
        represents: t("attribution.waterfall.effects.allocation.represents"),
        calculation: t("attribution.waterfall.effects.allocation.calculation"),
        driver: topSectorDriver(sectorBreakdowns, "allocation_effect", t),
      },
      {
        name: t("attribution.waterfall.effects.selection.name"),
        value: values.Selection ?? 0,
        represents: t("attribution.waterfall.effects.selection.represents"),
        calculation: t("attribution.waterfall.effects.selection.calculation"),
        driver: topSectorDriver(sectorBreakdowns, "selection_effect", t),
      },
      {
        name: t("attribution.waterfall.effects.interaction.name"),
        value: values.Interaction ?? 0,
        represents: t("attribution.waterfall.effects.interaction.represents"),
        calculation: t("attribution.waterfall.effects.interaction.calculation"),
        driver: topSectorDriver(sectorBreakdowns, "interaction_effect", t),
      },
      {
        name: t("attribution.waterfall.effects.activeReturn.name"),
        value: values["Active Return"] ?? 0,
        represents: t("attribution.waterfall.effects.activeReturn.represents"),
        calculation: t("attribution.waterfall.effects.activeReturn.calculation"),
        driver: topSectorDriver(sectorBreakdowns, "active_contribution", t),
      },
    ];
  }, [data, sectorBreakdowns, t]);

  useEffect(() => {
    if (!isDetailOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDetailOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isDetailOpen]);

  return (
    <>
      <ChartPanelFrame
        empty={formatted.length === 0}
        emptyTitle={t("attribution.waterfall.emptyTitle")}
        emptyDescription={t("attribution.waterfall.emptyDescription")}
        className="min-h-[320px] min-w-0 bg-[var(--surface-raised)]"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="type-body text-[var(--ink)]">
            <InfoTooltip
              label={t("attribution.waterfall.tooltipLabel")}
              description={t("attribution.waterfall.tooltipDescription")}
            />
          </h3>
          <button
            type="button"
            onClick={() => setIsDetailOpen(true)}
            className="rounded-[var(--radius-1)] border border-[var(--line)] px-2 py-1 type-small text-[var(--ink-muted)] transition hover:border-[var(--brand)] hover:text-[var(--ink)]"
          >
            {t("attribution.waterfall.details")}
          </button>
        </div>
        <div className="h-[220px] min-h-[220px]">
          <ResponsiveChart className="h-full w-full" minWidth={1} minHeight={1}>
            <BarChart data={formatted}>
              <CartesianGrid {...GRID_STYLE} vertical={false} />
              <XAxis dataKey="name" {...withCategoryAxisProps()} />
              <YAxis {...withAxisProps({ tickFormatter: (value: number | string) => fmtPctTick(Number(value), 0) })} />
              <Tooltip
                {...withTooltipProps()}
                formatter={(value) => formatNumber(Number(value ?? 0) / 100, "percent", { digits: 2, locale })}
              />
              <Bar
                dataKey="percentage"
                fill="var(--brand)"
              />
            </BarChart>
          </ResponsiveChart>
        </div>
      </ChartPanelFrame>
      {isDetailOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay-scrim)] p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("attribution.waterfall.dialogLabel")}
          onMouseDown={() => setIsDetailOpen(false)}
        >
          <div
            className="max-h-[88vh] w-full max-w-3xl overflow-y-auto border border-[var(--line)] bg-[var(--surface-raised)] p-5"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4">
              <div>
                <h2 className="type-panel-title text-[var(--ink)]">{t("attribution.waterfall.methodologyTitle")}</h2>
                <p className="mt-1 type-body text-[var(--ink-muted)]">
                  {t("attribution.waterfall.methodologySubtitle")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDetailOpen(false)}
                className="rounded-[var(--radius-1)] border border-[var(--line)] px-3 py-1 type-body text-[var(--ink-muted)] hover:text-[var(--ink)]"
              >
                {t("attribution.waterfall.close")}
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {effectDetails.map((effect) => (
                <section key={effect.name} className="border border-[var(--line)] p-4">
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                    <h3 className="type-body text-[var(--ink)]">{effect.name}</h3>
                    <div className={`type-body tabular-nums ${effect.value >= 0 ? "text-[var(--up)]" : "text-[var(--down)]"}`}>
                      {percentText(effect.value)}
                    </div>
                  </div>
                  <p className="mt-2 type-body text-[var(--ink)]">{effect.represents}</p>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">{t("attribution.waterfall.calculationLabel")}</span>{" "}
                    {effect.calculation}
                  </p>
                  <p className="mt-2 type-small text-[var(--ink-muted)]">
                    <span className="text-[var(--ink)]">{t("attribution.waterfall.largestDriverLabel")}</span>{" "}
                    {effect.driver}
                  </p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
