"use client";

import { Fragment, type ReactNode } from "react";
import clsx from "clsx";
import { DeltaBadge } from "@/components/ui/DeltaBadge";
import { FigureText } from "@/components/market/FigureText";
import { withFigures } from "@/components/market/marketModel";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { useRiskLatest } from "@/lib/useRisk";
import type { RiskLatest, SurgeThemeOut } from "../../../../packages/shared-types";

export type StripState = "loading" | "error" | "pending" | "risk" | "surge" | "neutral";

/** Risk UI spec §2: risk is the down family, surge the up family, everything else the plain strip. */
const FAMILY_CLASS: Record<StripState, string> = {
  risk: "border-[var(--down)] bg-[var(--down-soft)]",
  surge: "border-[var(--up)] bg-[var(--up-soft)]",
  neutral: "border-[var(--line)] bg-[var(--surface-raised)]",
  pending: "border-[var(--line)] bg-[var(--surface-raised)]",
  loading: "border-[var(--line)] bg-[var(--surface-raised)]",
  error: "border-[var(--line)] bg-[var(--surface-raised)]",
};

const BACKFILL_COMPLETE = new Set<RiskLatest["backfill"]>(["done", "degraded"]);

/** Spec §2 priority, top first: an open alert, the surge banner, then the plain strip. Pending covers no evaluation yet and an unfinished backfill. */
export function stripState(latest: RiskLatest): Exclude<StripState, "loading" | "error"> {
  if (latest.as_of === null || !BACKFILL_COMPLETE.has(latest.backfill)) return "pending";
  if (latest.alert) return "risk";
  if (latest.surge?.banner) return "surge";
  return "neutral";
}

/** The themes the banner is about: those whose event started on a banner day; all open ones if none did. */
function bannerThemes(themes: SurgeThemeOut[]): SurgeThemeOut[] {
  const shown = themes.filter((theme) => theme.shown);
  return shown.length > 0 ? shown : themes;
}

/**
 * The always-on signal line at the top of "/" (risk UI spec §2). One row high at every width: overflow
 * ends in an ellipsis. The whole line is a button that opens the signal panel (Enter and Space are native).
 * All values come from GET /api/v1/risk/latest as sent.
 */
export function SignalStrip({ onOpen, expanded = false }: { onOpen: () => void; expanded?: boolean }) {
  const t = useT();
  const { locale } = useLocale();
  const query = useRiskLatest();
  const latest = query.data ?? null;
  const state: StripState = query.isError ? "error" : latest === null ? "loading" : stripState(latest);
  const integer = (value: number) => formatNumber(value, "integer", { locale });
  const sentence = (template: string, figures: Record<string, string>) => <FigureText parts={withFigures(template, figures)} />;

  const parts: ReactNode[] = [];
  let chip: ReactNode = null;
  if (state === "loading") parts.push(t("risk.strip.loading"));
  else if (state === "error") parts.push(t("risk.strip.error"));
  else if (latest && state === "pending") {
    parts.push(t(latest.backfill === "pending" || latest.backfill === "running" ? "risk.strip.computing" : "risk.strip.preparing"));
  } else if (latest) {
    const ratio = `${integer(latest.warnings_on)}/${integer(latest.warnings_total)}`;
    const surgeThemes = latest.surge ? bannerThemes(latest.surge.themes) : [];
    if (state === "risk" && latest.alert) {
      const alert = latest.alert;
      const primary = alert.themes.find((stint) => stint.theme === alert.outcome.primary_theme);
      const name = primary ? primary.label[locale] : alert.outcome.primary_theme;
      parts.push(
        <span key="title" data-part="title" className="text-[var(--down)]">{t("risk.strip.riskTitle")}</span>,
        <span key="themes" data-part="themes">{sentence(t("risk.strip.themes", { name }), { count: integer(alert.trigger_themes.length) })}</span>,
        <span key="since" data-part="since">{sentence(t("risk.strip.since"), { date: alert.start_date })}</span>,
        <span key="warnings" data-part="warnings">{sentence(t("risk.strip.warnings"), { ratio })}</span>,
      );
      if (latest.surge?.banner) {
        chip = (
          <span data-part="surge-chip" className="shrink-0 rounded-[var(--radius-2)] bg-[var(--up-soft)] px-2 text-[var(--up)]">
            {sentence(t("risk.strip.surgeChip"), { count: integer(surgeThemes.length) })}
          </span>
        );
      }
    } else if (state === "surge" && latest.surge) {
      parts.push(
        <span key="title" data-part="title" className="text-[var(--up)]">{t("risk.strip.surgeTitle")}</span>,
        <span key="themes" data-part="themes">{surgeThemes.map((theme) => theme.label[locale]).join(", ")}</span>,
      );
      if (latest.surge.banner_since) {
        parts.push(<span key="since" data-part="since">{sentence(t("risk.strip.since"), { date: latest.surge.banner_since })}</span>);
      }
    } else {
      parts.push(<span key="warnings" data-part="warnings">{sentence(t("risk.strip.warnings"), { ratio })}</span>);
      const top = latest.movers?.items[0];
      if (top) {
        parts.push(
          <span key="mover" data-part="mover">
            {t("risk.strip.topMover", { name: top.name })} <DeltaBadge value={top.return_pct} />
          </span>,
        );
      }
      if (latest.surge) {
        parts.push(<span key="surge" data-part="surge">{sentence(t("risk.strip.surgeThemes"), { count: integer(latest.surge.themes.length) })}</span>);
      }
    }
  }

  return (
    <button
      type="button"
      data-testid="signal-strip"
      data-state={state}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onOpen}
      className={clsx(
        "type-small relative flex h-6 w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border px-3 text-left text-[var(--ink)]",
        FAMILY_CLASS[state],
      )}
    >
      <span data-part="text" className="min-w-0 flex-1 truncate">
        {parts.map((part, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden="true">{" · "}</span>}
            {part}
          </Fragment>
        ))}
      </span>
      {chip}
    </button>
  );
}
