import { BilingualLabel } from "@/components/ui/BilingualLabel";
import type { LabelKey } from "@/lib/i18n/labels";

interface EyebrowProps {
  label: LabelKey;
  /** Section number, shown as [01] in brand text. */
  index?: number;
  /** A value after the label, such as a record id. */
  suffix?: string;
}

/** The small mono label above a title: "[01] 시장 MARKET" (redesign Eyebrow, without the slash). */
export function Eyebrow({ label, index, suffix }: EyebrowProps) {
  return (
    <div className="type-caption inline-flex items-baseline gap-2 uppercase text-[var(--ink-muted)]">
      {index !== undefined && <span className="text-[var(--brand-text)]">{`[${String(index).padStart(2, "0")}]`}</span>}
      <BilingualLabel k={label} />
      {suffix !== undefined && <span>{suffix}</span>}
    </div>
  );
}
