"use client";

import { useEffect, useState } from "react";

export type OdometerCell = { from: string; to: string; delayIndex: number };

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Cells for an odometer roll from `from` to `to`, aligned on the right.
 * The shorter side pads on the left with "" cells. A null `from` (no previous value)
 * shows the target text with every digit at "0". delayIndex is 0 at the rightmost cell.
 */
export function odometerPlan(from: string | null, to: string): OdometerCell[] {
  const toChars = Array.from(to);
  const fromChars = from === null ? toChars.map((ch) => (/\d/.test(ch) ? "0" : ch)) : Array.from(from);
  const length = Math.max(toChars.length, fromChars.length);
  const fromCells = [...Array<string>(length - fromChars.length).fill(""), ...fromChars];
  const toCells = [...Array<string>(length - toChars.length).fill(""), ...toChars];
  return toCells.map((cell, index) => ({
    from: fromCells[index],
    to: cell,
    delayIndex: length - 1 - index,
  }));
}

/** True on the server and on the first client render, so animation never starts before the preference is known. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  return reduced;
}
