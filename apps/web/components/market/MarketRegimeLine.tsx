"use client";

import { RollingNumber } from "@/components/ui/RollingNumber";
import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { useMarketRegime } from "@/lib/useMarketRegime";
import { FigureText } from "./FigureText";
import { regimeView, withFigures, type RegimeTone } from "./marketModel";

export const TONE_CLASS: Record<RegimeTone, string> = {
  up: "text-[var(--up)]",
  down: "text-[var(--down)]",
  neutral: "text-[var(--ink)]",
};

/**
 * Spec §2.5: the regime in one line beside the title. The label, the equity breadth and the
 * cross-asset signal counts come from GET /api/v1/market/regime as sent; nothing is counted here.
 * The backend's English summary sentence is never rendered, not even as a title. The line keeps its
 * height while loading (min-h-6), so the tab bar does not move when the regime arrives.
 */
export function MarketRegimeLine() {
  const t = useT();
  const { locale } = useLocale();
  const view = regimeView(useMarketRegime());
  const integer = (value: number) => formatNumber(value, "integer", { locale });

  return (
    <p
      data-testid="market-regime"
      data-state={view.kind}
      className="type-small flex min-h-6 flex-wrap items-center gap-x-2 text-[var(--ink-secondary)]"
    >
      {view.kind === "ready" ? (
        <>
          <span data-part="label" data-tone={view.tone} className={TONE_CLASS[view.tone]}>{t(view.labelKey)}</span>
          <span aria-hidden="true">·</span>
          <span data-part="breadth">
            <FigureText
              parts={withFigures(t("market.regime.breadth"), { breadth: "breadth" })}
              nodes={{ breadth: <RollingNumber value={view.advancers} format={(n) => `${integer(n)}/${integer(view.indexCount)}`} enter /> }}
            />
          </span>
          <span aria-hidden="true">·</span>
          <span data-part="signals">
            <FigureText
              parts={withFigures(t("market.regime.signals"), { on: "on", off: "off" })}
              nodes={{
                on: <RollingNumber value={view.riskOn} format={integer} enter />,
                off: <RollingNumber value={view.riskOff} format={integer} enter />,
              }}
            />
          </span>
        </>
      ) : view.kind === "unknown" ? (
        <span>{t("market.regime.unknown")}</span>
      ) : view.kind === "error" ? (
        <span>{t("market.regime.error")}</span>
      ) : null}
    </p>
  );
}
