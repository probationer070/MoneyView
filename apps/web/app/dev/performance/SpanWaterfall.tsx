"use client";

import { formatNumber } from "@/lib/format";
import { useLocale, useT } from "@/lib/i18n/locale";
import { isCollapsedNode, type CollapsedNode, type SpanNode } from "@/lib/devMonitor";

function Row({ node, rootTotalMs, depth }: { node: SpanNode; rootTotalMs: number; depth: number }) {
  const t = useT();
  const { locale } = useLocale();
  const total = node.total_ms ?? 0;
  const offsetPct = rootTotalMs > 0 ? Math.min(100, Math.max(0, (node.offset_ms / rootTotalMs) * 100)) : 0;
  const rawWidthPct = rootTotalMs > 0 ? Math.max(0.5, (total / rootTotalMs) * 100) : 0;
  // A child's offset is clamped to its parent, but its duration is not (see
  // `_assign_offsets` in apps/api/services/perf_analysis.py): a child can
  // legitimately outlast its parent window. Cap the rendered width so the
  // bar never bleeds past the end of its track.
  const widthPct = Math.min(rawWidthPct, Math.max(0, 100 - offsetPct));

  return (
    <div>
      <div className="type-mono flex items-center gap-2 py-0.5">
        <span
          className="truncate text-[var(--ink)]"
          style={{ paddingLeft: `${depth * 12}px`, width: "300px" }}
          title={node.operation}
        >
          {node.operation}
          {node.ticker ? ` ${node.ticker}` : ""}
          {node.clock_skew ? (
            <span title={t("devPerformance.clockSkew")} className="text-[var(--ink-muted)]"> ~</span>
          ) : null}
          {node.orphaned ? (
            <span title={t("devPerformance.orphaned")} className="text-[var(--ink-muted)]"> ?</span>
          ) : null}
        </span>
        <span className="relative flex-1 h-3 bg-[var(--surface)] overflow-hidden">
          <span
            className="absolute h-3 bg-[var(--ink-muted)] opacity-60"
            style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
          />
        </span>
        <span className="text-right w-20 tabular-nums text-[var(--ink-muted)]">
          {formatNumber(total, "price", { digits: 1, locale })} ms
        </span>
        <span className="text-right w-20 tabular-nums text-[var(--ink-muted)]">
          {t("devPerformance.selfMs", { ms: formatNumber(node.self_ms ?? 0, "price", { digits: 1, locale }) })}
        </span>
      </div>
      {node.children.map((child, index) =>
        isCollapsedNode(child) ? (
          <Collapsed key={`collapsed-${index}`} node={child} depth={depth + 1} />
        ) : (
          <Row key={child.id} node={child} rootTotalMs={rootTotalMs} depth={depth + 1} />
        )
      )}
    </div>
  );
}

function Collapsed({ node, depth }: { node: CollapsedNode; depth: number }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div
      className="type-mono py-0.5 text-[var(--ink-muted)]"
      style={{ paddingLeft: `${depth * 12}px` }}
    >
      {t("devPerformance.collapsed", {
        count: formatNumber(node.collapsed_count, "integer", { locale }),
        ms: formatNumber(node.total_ms, "price", { digits: 1, locale }),
        scope: node.deepest_scope,
      })}
    </div>
  );
}

export function SpanWaterfall({ root, totalMs }: { root: SpanNode; totalMs: number }) {
  return <div>{<Row node={root} rootTotalMs={totalMs} depth={0} />}</div>;
}
