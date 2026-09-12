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
  /** ISO `YYYY-MM-DD`. */
  date: string;
}

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
 * Exported and pure so this is unit-testable without a canvas.
 */
export function eventCoordinate(
  date: string,
  barTimes: readonly string[],
  timeToCoordinate: (time: string) => number | null,
): number | null {
  if (barTimes.length === 0) return null;

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

class EventLinesRenderer implements IPrimitivePaneRenderer {
  public constructor(
    private readonly xs: readonly number[],
    private readonly color: string,
    private readonly alpha: number,
    private readonly lineWidth: number,
  ) {}

  public draw(target: RenderTarget): void {
    if (this.xs.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      ctx.save();
      // globalAlpha rather than an rgba() string: the colour arrives already resolved from a
      // CSS custom property, and re-parsing it into components to add an alpha channel would
      // mean handling hex, rgb() and named forms. Compositing is the same either way.
      ctx.globalAlpha = this.alpha;
      ctx.fillStyle = this.color;
      const width = Math.max(1, Math.round(this.lineWidth * scope.horizontalPixelRatio));
      for (const x of this.xs) {
        const centre = Math.round(x * scope.horizontalPixelRatio);
        ctx.fillRect(centre - Math.floor(width / 2), 0, width, scope.bitmapSize.height);
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
  /** Already resolved to something a canvas can paint -- see `resolveCssColor`. */
  color: string;
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

  public buildRenderer(): IPrimitivePaneRenderer | null {
    if (!this.options.visible || !this.chart) return null;
    const timeScale = this.chart.timeScale();
    const toCoordinate = (time: string) => timeScale.timeToCoordinate(time as Time);

    const xs: number[] = [];
    for (const event of this.options.events) {
      const x = eventCoordinate(event.date, this.options.barTimes, toCoordinate);
      if (x !== null) xs.push(x);
    }
    if (xs.length === 0) return null;
    return new EventLinesRenderer(xs, this.options.color, this.options.alpha, this.options.lineWidth);
  }
}
