import type {
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  IChartApi,
  PaneAttachedParameter,
  PrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";

/**
 * The canvas target the library hands a renderer.
 *
 * Derived from the interface rather than imported: the concrete type lives in
 * `fancy-canvas`, which lightweight-charts does not re-export and which is only a
 * transitive dependency here -- importing it directly would depend on hoisting.
 */
type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

export interface EventLineSpec {
  id: string;
  label: string;
  /** ISO `YYYY-MM-DD`: where the line is drawn. */
  date: string;
  /** `#RRGGBB`, from the event's category. */
  color: string;
  endDate?: string | null;
  note?: string;
  categoryLabel?: string;
  source?: string | null;
  origin?: "builtin" | "rule" | "user" | "computed";
}

/** One drawn x position and every event on it. `colors` holds each distinct colour once, in event order. */
export interface PlacedEventLine {
  x: number;
  events: EventLineSpec[];
  colors: string[];
}

/** What the pointer is over: the anchoring line's x, the chart width for flipping, and the events. */
export interface EventHit {
  x: number;
  width: number;
  events: EventLineSpec[];
}

/** What one bar of the chart spans, which decides the bar an event belongs to. */
export type EventGranularity = "day" | "month";

/**
 * Where an event's line belongs on the x axis, given the bars actually loaded.
 *
 * `timeToCoordinate` answers only for times that have a bar. An event on a day the market
 * was shut returns null from it -- and the most interesting events are precisely the ones
 * that happen at the weekend, because the reaction is then compressed into the next open.
 * The U.S. strikes on Iran began Saturday 28 Feb 2026; the `^GSPC` series runs Fri 27 Feb
 * straight to Mon 2 Mar. A naive implementation draws nothing at all for it.
 *
 * So: an exact bar is used when there is one, and otherwise the line is placed midway
 * between the bars that bracket the date -- visually inside the closed-market gap, which is
 * what actually happened. An event outside the loaded range is not drawn, rather than being
 * clamped to an edge where it would assert a date the chart is not showing.
 *
 * Monthly bars need their own rule. Each one is dated by its month's FIRST trading day, so the
 * day rule would bracket a mid-month event between two months' candles, and would treat any
 * event in the newest month after its first day as beyond the loaded range and draw nothing.
 * With `granularity` "month" the line sits on the bar for the event's month.
 *
 * Exported and pure so this is unit-testable without a canvas.
 */
export function eventCoordinate(
  date: string,
  barTimes: readonly string[],
  timeToCoordinate: (time: string) => number | null,
  granularity: EventGranularity = "day",
): number | null {
  if (barTimes.length === 0) return null;

  if (granularity === "month") {
    const month = date.slice(0, 7);
    const bar = barTimes.find((time) => time.slice(0, 7) === month);
    return bar === undefined ? null : timeToCoordinate(bar);
  }

  // Bars arrive sorted; a binary search is not worth it for a few thousand.
  let before: string | null = null;
  let after: string | null = null;
  for (const time of barTimes) {
    if (time === date) {
      return timeToCoordinate(time);
    }
    if (time < date) before = time;
    if (time > date) {
      after = time;
      break;
    }
  }

  // Outside the loaded range on either side: the chart is not showing this period.
  if (before === null || after === null) return null;

  const left = timeToCoordinate(before);
  const right = timeToCoordinate(after);
  if (left === null || right === null) return null;
  return (left + right) / 2;
}

/**
 * Place every event, grouping events that land on the same pixel into one line. Two categories on
 * one date -- or on one monthly candle -- then draw as adjacent stripes instead of one hiding the other.
 */
export function placeEventLines(
  events: readonly EventLineSpec[],
  barTimes: readonly string[],
  timeToCoordinate: (time: string) => number | null,
  granularity: EventGranularity,
): PlacedEventLine[] {
  const byPixel = new Map<number, PlacedEventLine>();
  for (const event of events) {
    const x = eventCoordinate(event.date, barTimes, timeToCoordinate, granularity);
    if (x === null) continue;
    const key = Math.round(x);
    const placed = byPixel.get(key) ?? { x, events: [], colors: [] };
    placed.events.push(event);
    if (!placed.colors.includes(event.color)) placed.colors.push(event.color);
    byPixel.set(key, placed);
  }
  return [...byPixel.values()].sort((a, b) => a.x - b.x);
}

/**
 * The events under the pointer: every line within `tolerancePx`, nearest first, anchored at the
 * nearest line so the tooltip sits on it rather than chasing the pointer.
 */
export function eventsNearX(
  x: number,
  placed: readonly PlacedEventLine[],
  tolerancePx = 6,
): { x: number; events: EventLineSpec[] } | null {
  const hits = placed
    .filter((line) => Math.abs(line.x - x) <= tolerancePx)
    .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x));
  if (hits.length === 0) return null;
  return { x: hits[0].x, events: hits.flatMap((line) => line.events) };
}

class EventLinesRenderer implements IPrimitivePaneRenderer {
  public constructor(
    private readonly lines: readonly PlacedEventLine[],
    private readonly alpha: number,
    private readonly lineWidth: number,
  ) {}

  public draw(target: RenderTarget): void {
    if (this.lines.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      ctx.globalAlpha = this.alpha;
      const width = Math.max(1, Math.round(this.lineWidth * scope.horizontalPixelRatio));
      for (const line of this.lines) {
        const left = Math.round(line.x * scope.horizontalPixelRatio) - Math.floor(width / 2);
        // Each further colour is a stripe immediately to the right, so every category stays visible.
        line.colors.forEach((color, index) => {
          ctx.fillStyle = color;
          ctx.fillRect(left + index * width, 0, width, scope.bitmapSize.height);
        });
      }
      ctx.restore();
    });
  }
}

class EventLinesPaneView implements IPanePrimitivePaneView {
  public constructor(private readonly source: EventLinesPrimitive) {}

  // Behind the candles. A marker that obscures the price it exists to contextualise is
  // worse than no marker.
  public zOrder(): PrimitivePaneViewZOrder {
    return "bottom";
  }

  public renderer(): IPrimitivePaneRenderer | null {
    return this.source.buildRenderer();
  }
}

export interface EventLinesOptions {
  events: readonly EventLineSpec[];
  barTimes: readonly string[];
  granularity: EventGranularity;
  alpha: number;
  lineWidth: number;
  visible: boolean;
}

/**
 * Draws a vertical line for each market event across the full height of the pane.
 *
 * Attached to the pane rather than to a series so the line spans the whole plot including
 * the volume overlay, and so it survives the series being re-created.
 */
export class EventLinesPrimitive implements IPanePrimitive<Time> {
  private readonly views: readonly IPanePrimitivePaneView[];
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;

  public constructor(private options: EventLinesOptions) {
    this.views = [new EventLinesPaneView(this)];
  }

  public attached(param: PaneAttachedParameter<Time>): void {
    this.chart = param.chart as IChartApi;
    this.requestUpdate = param.requestUpdate;
  }

  public detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  public paneViews(): readonly IPanePrimitivePaneView[] {
    return this.views;
  }

  /** Replace the inputs and ask the chart to repaint. */
  public update(next: Partial<EventLinesOptions>): void {
    this.options = { ...this.options, ...next };
    this.requestUpdate?.();
  }

  /** The lines as currently placed. Also read by TVChart's hover handler, so both agree on x. */
  public placedLines(): PlacedEventLine[] {
    if (!this.options.visible || !this.chart) return [];
    const timeScale = this.chart.timeScale();
    return placeEventLines(
      this.options.events,
      this.options.barTimes,
      (time) => timeScale.timeToCoordinate(time as Time),
      this.options.granularity,
    );
  }

  public buildRenderer(): IPrimitivePaneRenderer | null {
    const lines = this.placedLines();
    if (lines.length === 0) return null;
    return new EventLinesRenderer(lines, this.options.alpha, this.options.lineWidth);
  }
}
