import { useQuery } from "@tanstack/react-query";
import { CHART_COLORS } from "@/lib/chartConfig";
import { formatWire, labelForInput, metaForInput } from "../caseFields";
import { casesApi, retryUnlessRefused } from "../casesApi";
import { fmtPerShare, fmtSigned } from "../format";
import { QueryStatus, Section } from "./Section";

// Half a cent per share: tolerance for float rounding across 2^n engine runs, far below any
// difference a reader would act on.
const SUM_TOLERANCE = 0.005;

export function WhyItMovedSection({ caseId }: { caseId: number }) {
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
    <Section title="Why it moved" testId="case-why">
      <QueryStatus query={query} what="the attribution" testId="case-why" />
      {diff && (
        <>
          <p data-testid="why-headline" className="text-sm font-medium tabular-nums text-[var(--text-primary)]">
            {fmtPerShare(diff.parent_value_per_share_diluted)} → {fmtPerShare(diff.case_value_per_share_diluted)} ({fmtSigned(diff.total_difference)} per share)
          </p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Shapley attribution of value per share (diluted): exact, and independent of the order the changes are listed.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {diff.contributions.map((c, i) => {
              const meta = metaForInput(c.input);
              const range = meta ? `${formatWire(meta, c.from)} → ${formatWire(meta, c.to)}` : `${c.from} → ${c.to}`;
              const width = `${(Math.abs(c.contribution) / largest) * 50}%`;
              const positive = c.contribution >= 0;
              return (
                <li key={c.input} data-testid={`why-bar-${i}`} className="text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--text-primary)]">{labelForInput(c.input)} <span className="text-[var(--text-muted)]">{range}</span></span>
                    <span className="tabular-nums">{fmtSigned(c.contribution)}</span>
                  </div>
                  {/* Diverging from the centre: left of centre is a negative contribution. */}
                  <div className="relative mt-1 h-2 rounded bg-[var(--surface)]">
                    <div
                      className="absolute top-0 h-2 rounded"
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
            <p data-testid="why-sum" className="mt-3 text-xs text-[var(--text-muted)]">
              Contributions sum to {fmtSigned(sum)}, the whole difference.
            </p>
          ) : (
            <p role="alert" className="mt-3 text-xs text-[var(--chart-negative)]">
              Contributions sum to {fmtSigned(sum)} and do not add up to the difference of {fmtSigned(diff.total_difference)}.
            </p>
          )}
        </>
      )}
    </Section>
  );
}
