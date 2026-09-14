import type { Page } from "@playwright/test";

/** Ink per x column across every canvas inside `selector`, in bitmap pixels. */
export async function inkProfile(page: Page, selector: string): Promise<{ ink: number[]; height: number }> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (!container) return { ink: [], height: 0 };
    const canvases = Array.from(container.querySelectorAll("canvas")) as HTMLCanvasElement[];
    const width = canvases.reduce((max, canvas) => Math.max(max, canvas.width), 0);
    const height = canvases.reduce((max, canvas) => Math.max(max, canvas.height), 0);
    const ink = new Array<number>(width).fill(0);
    for (const canvas of canvases) {
      const ctx = canvas.getContext("2d");
      if (!ctx || canvas.width === 0) continue;
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          if (image.data[(y * canvas.width + x) * 4 + 3] > 0) ink[x] += 1;
        }
      }
    }
    return { ink, height };
  }, selector);
}

/** Sample only once the canvas has stopped changing, so no reading is mid-animation. */
export async function stableInkProfile(page: Page, selector: string): Promise<{ ink: number[]; height: number }> {
  let previous = await inkProfile(page, selector);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(250);
    const current = await inkProfile(page, selector);
    if (current.ink.length > 0 && JSON.stringify(current.ink) === JSON.stringify(previous.ink)) {
      return current;
    }
    previous = current;
  }
  return previous;
}
