import type { ReactNode } from "react";
import type { FigurePart } from "./marketModel";

/** Renders withFigures() parts. Each figure is set in mono (DESIGN.md: figures inside a sentence). */
/** `nodes` swaps a figure for a node (a RollingNumber), keyed by the figure's text; give such figures distinct text. */
export function FigureText({ parts, nodes }: { parts: FigurePart[]; nodes?: Record<string, ReactNode> }) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.kind === "figure" ? "type-mono" : undefined}>{part.kind === "figure" ? (nodes?.[part.text] ?? part.text) : part.text}</span>
      ))}
    </>
  );
}
