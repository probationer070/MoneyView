"use client";

import { isCollapsedNode, type CollapsedNode, type SpanNode } from "@/lib/devMonitor";

function Row({ node, rootTotalMs, depth }: { node: SpanNode; rootTotalMs: number; depth: number }) {
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
      <div className="flex items-center gap-2 text-xs py-0.5">
        <span
          className="truncate text-[var(--text-primary)]"
          style={{ paddingLeft: `${depth * 12}px`, width: "300px" }}
          title={node.operation}
        >
          {node.operation}
          {node.ticker ? ` ${node.ticker}` : ""}
          {node.clock_skew ? (
            <span title="clock skew: bounds clamped to parent" className="text-[var(--text-muted)]"> ~</span>
          ) : null}
          {node.orphaned ? (
            <span title="orphaned: parent span evicted" className="text-[var(--text-muted)]"> ?</span>
          ) : null}
        </span>
        <span className="relative flex-1 h-3 bg-[var(--bg-canvas)] overflow-hidden">
          <span
            className="absolute h-3 bg-[var(--text-muted)] opacity-60"
            style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
          />
        </span>
        <span className="tabular-nums text-[var(--text-muted)] w-20 text-right">
          {total.toFixed(1)} ms
        </span>
        <span className="tabular-nums text-[var(--text-muted)] w-20 text-right">
          self {(node.self_ms ?? 0).toFixed(1)}
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
  return (
    <div
      className="text-xs py-0.5 text-[var(--text-muted)]"
      style={{ paddingLeft: `${depth * 12}px` }}
    >
      ⋯ {node.collapsed_count} spans collapsed · {node.total_ms.toFixed(1)} ms ({node.deepest_scope})
    </div>
  );
}

export function SpanWaterfall({ root, totalMs }: { root: SpanNode; totalMs: number }) {
  return <div className="font-mono">{<Row node={root} rootTotalMs={totalMs} depth={0} />}</div>;
}
