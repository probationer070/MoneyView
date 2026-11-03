import { useQuery } from "@tanstack/react-query";
import { CHART_COLORS } from "@/lib/chartConfig";
import { formatWire, labelForInput, metaForInput } from "../caseFields";
import { casesApi, retryUnlessRefused } from "../casesApi";
import { useLocale, useT } from "@/lib/i18n/locale";
import { fmtPerShare, fmtSigned } from "../format";
import { QueryStatus, Section } from "./Section";

// Half a cent per share: tolerance for float rounding across 2^n engine runs, far below any
// difference a reader would act on.
const SUM_TOLERANCE = 0.005;

export function WhyItMovedSection({ caseId }: { caseId: number }) {
  const { locale } = useLocale();
  const t = useT();
  const query = useQuery({
    queryKey: ["case-diff", caseId],
    queryFn: () => casesApi.diff(caseId),
    refetchOnWindowFocus: false,
    retry: retryUnlessRefused,
  });
  const diff = query.data;
  const largest = diff ? Math.max(...diff.contributions.map((c) => Math.abs(c.contribution)), 1e-9) : 1;
  const sum = diff ? diff.contributions.reduce((total, c) => total + c.contribution, 0) : 0;

  return (
    <Section title={t("cases.why.title")} testId="case-why">
      <QueryStatus query={query} what={t("cases.status.whatAttribution")} testId="case-why" />
      {diff && (
        <>
          <p data-testid="why-headline" className="type-body tabular-nums text-[var(--ink)]">
            {t("cases.why.headline", {
              before: fmtPerShare(diff.parent_value_per_share_diluted, locale),
              after: fmtPerShare(diff.case_value_per_share_diluted, locale),
              diff: fmtSigned(diff.total_difference),
            })}
          </p>
          <p className="mt-1 type-small text-[var(--ink-muted)]">
            {t("cases.why.method")}
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {diff.contributions.map((c, i) => {
              const meta = metaForInput(c.input);
              const range = meta ? `${formatWire(meta, c.from, t)} → ${formatWire(meta, c.to, t)}` : `${c.from} → ${c.to}`;
              const width = `${(Math.abs(c.contribution) / largest) * 50}%`;
              const positive = c.contribution >= 0;
              return (
                <li key={c.input} data-testid={`why-bar-${i}`} className="type-body">
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--ink)]">{labelForInput(c.input, t)} <span className="text-[var(--ink-muted)]">{range}</span></span>
                    <span className="tabular-nums">{fmtSigned(c.contribution)}</span>
                  </div>
                  {/* Diverging from the centre: left of centre is a negative contribution. */}
                  <div className="relative mt-1 h-2 bg-[var(--surface)]">
                    <div
                      className="absolute top-0 h-2"
                      style={{
                        width,
                        left: positive ? "50%" : undefined,
                        right: positive ? undefined : "50%",
                        background: positive ? CHART_COLORS.positive : CHART_COLORS.negative,
                      }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
          {Math.abs(sum - diff.total_difference) <= SUM_TOLERANCE ? (
            <p data-testid="why-sum" className="mt-3 type-small text-[var(--ink-muted)]">
              {t("cases.why.sumOk", { sum: fmtSigned(sum) })}
            </p>
          ) : (
            <p role="alert" className="mt-3 type-small text-[var(--status-error-ink)]">
              {t("cases.why.sumMismatch", { sum: fmtSigned(sum), total: fmtSigned(diff.total_difference) })}
            </p>
          )}
        </>
      )}
    </Section>
  );
}
