"use client";

import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { type DcfResult, type DetailKey, moneyText, pct } from "./shared";

export function DcfCoreModulesGraph({
  sustainableGrowth,
  terminalValueShare,
  fcff,
  dcfResult,
  onOpenDetail,
}: {
  sustainableGrowth: number;
  terminalValueShare: number;
  fcff: number;
  dcfResult?: DcfResult;
  onOpenDetail: (key: DetailKey) => void;
}) {
  return (
    <div className="lg:col-span-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <button
        type="button"
        onClick={() => onOpenDetail("dcfCoreModules")}
        className="text-left text-sm font-bold text-[var(--text-primary)] underline decoration-dotted underline-offset-4 hover:text-[var(--surface)]"
      >
        <InfoTooltip
          label="DCF Core Modules"
          description="Sustainable growth is reinvestment rate times ROIC. Terminal value share estimates how much enterprise value comes from terminal assumptions."
        />
      </button>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <button
          type="button"
          onClick={() => onOpenDetail("sustainableGrowth")}
          className="rounded-[var(--radius)] p-2 text-left transition hover:bg-[var(--surface)]"
        >
          <div className="text-xs text-[var(--text-muted)]">
            <InfoTooltip
              label="Sustainable Growth"
              description="Reinvestment rate multiplied by ROIC. This estimates the internally supportable growth rate before requiring extra capital or margin improvement."
            />
          </div>
          <div className="text-2xl font-black">{pct(sustainableGrowth)}</div>
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail("terminalValueShare")}
          className="rounded-[var(--radius)] p-2 text-left transition hover:bg-[var(--surface)]"
        >
          <div className="text-xs text-[var(--text-muted)]">Terminal Value Share</div>
          <div className="text-2xl font-black">{pct(terminalValueShare)}</div>
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail("fcffMagnitude")}
          className="rounded-[var(--radius)] p-2 text-left transition hover:bg-[var(--surface)]"
        >
          <div className="text-xs text-[var(--text-muted)]">FCFF Magnitude</div>
          <div className="text-2xl font-black">{moneyText(fcff)}B</div>
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail("backendFairValue")}
          className="rounded-[var(--radius)] p-2 text-left transition hover:bg-[var(--surface)]"
        >
          <div className="text-xs text-[var(--text-muted)]">Intrinsic DCF Value</div>
          <div className="text-2xl font-black">
            {dcfResult ? moneyText(dcfResult.estimated_value) : "N/A"}
          </div>
        </button>
      </div>
    </div>
  );
}
