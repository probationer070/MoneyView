import type { FigurePart } from "./marketModel";

/** Renders withFigures() parts. Each figure is set in mono (DESIGN.md: figures inside a sentence). */
export function FigureText({ parts }: { parts: FigurePart[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <span key={index} className={part.kind === "figure" ? "type-mono" : undefined}>{part.text}</span>
      ))}
    </>
  );
}
