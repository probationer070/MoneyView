import type { Page } from "@playwright/test";

/** Bitmap columns where `withLine` carries more ink than `without`: the event lines and nothing else. */
export function addedColumns(withLine: { ink: number[] }, without: { ink: number[] }): number[] {
  return withLine.ink.flatMap((value, x) => (value > (without.ink[x] ?? 0) ? [x] : []));
}

/** Group sorted columns into runs; a gap wider than 3px starts a new run (a separate line). */
export function columnRuns(columns: number[]): number[][] {
  const runs: number[][] = [];
  for (const column of columns) {
    const last = runs[runs.length - 1];
    if (last && column - last[last.length - 1] <= 3) last.push(column);
    else runs.push([column]);
  }
  return runs;
}

/**
 * The page point at a bitmap column of the widest canvas (the price pane), halfway down it.
 *
 * Scrolls the pane into view first: `page.mouse.move` dispatches a real OS-level event at
 * page coordinates, which does nothing if the target lies outside the current viewport (unlike
 * a locator action such as `.click()`, which auto-scrolls). A chart inside a tall scrollable
 * modal is routinely below the fold at the modal's initial scroll position.
 */
export async function pagePointForColumn(page: Page, selector: string, column: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ sel, col }) => {
    const canvases = Array.from(document.querySelectorAll(`${sel} canvas`)) as HTMLCanvasElement[];
    const pane = canvases.reduce((widest, canvas) => (canvas.width > widest.width ? canvas : widest));
    pane.scrollIntoView({ block: "center" });
    const rect = pane.getBoundingClientRect();
    return { x: rect.left + col / (pane.width / rect.width), y: rect.top + rect.height / 2 };
  }, { sel: selector, col: column });
}

/**
 * The colour a line paints in one column: the most common RGB among pixels whose alpha is the
 * line's own (drawn at 0.55 over a transparent background, so about 140). Candles are opaque and
 * grid lines far fainter, so neither lands in that band.
 */
export async function lineColorAt(page: Page, selector: string, column: number): Promise<string | null> {
  return page.evaluate(({ sel, col }) => {
    const counts = new Map<string, number>();
    for (const canvas of Array.from(document.querySelectorAll(`${sel} canvas`)) as HTMLCanvasElement[]) {
      if (col >= canvas.width || canvas.height === 0) continue;
      const context = canvas.getContext("2d");
      if (!context) continue;
      const data = context.getImageData(col, 0, 1, canvas.height).data;
      for (let y = 0; y < canvas.height; y += 1) {
        const alpha = data[y * 4 + 3];
        if (alpha < 110 || alpha > 170) continue;
        const key = [data[y * 4], data[y * 4 + 1], data[y * 4 + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    return best ? `#${best.toUpperCase()}` : null;
  }, { sel: selector, col: column });
}

/** Largest per-channel difference between two #RRGGBB colours. */
export function colorDistance(a: string, b: string): number {
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [x, y] = [channels(a), channels(b)];
  return Math.max(...x.map((value, i) => Math.abs(value - y[i])));
}
