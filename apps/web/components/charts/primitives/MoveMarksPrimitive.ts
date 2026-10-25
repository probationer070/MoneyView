import type {
  IPanePrimitive,
  IPanePrimitivePaneView,
  IPrimitivePaneRenderer,
  IChartApi,
  ISeriesApi,
  PaneAttachedParameter,
  PrimitivePaneViewZOrder,
  Time,
} from "lightweight-charts";

type RenderTarget = Parameters<IPrimitivePaneRenderer["draw"]>[0];

/** One mark: a hollow circle (price test only) or a filled one (price and volume), above an up day and below a down day. */
export interface ChartMarker {
  date: string;
  shape: "hollow" | "filled";
  up: boolean;
}

/** date -> the bar's high and low, which the marks sit outside of. */
export type MarkExtents = Record<string, { high: number; low: number }>;

interface PlacedMark { x: number; y: number; marker: ChartMarker }

const RADIUS = 5;
const OFFSET = 10;
const STROKE = 2;
const HIT_PX = 9;

class MoveMarksRenderer implements IPrimitivePaneRenderer {
  public constructor(private readonly marks: readonly PlacedMark[], private readonly upColour: string, private readonly downColour: string) {}

  public draw(target: RenderTarget): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      ctx.save();
      ctx.lineWidth = STROKE * ratio;
      for (const { x, y, marker } of this.marks) {
        const colour = marker.up ? this.upColour : this.downColour;
        ctx.beginPath();
        ctx.arc(x * ratio, y * scope.verticalPixelRatio, RADIUS * ratio, 0, Math.PI * 2);
        if (marker.shape === "filled") {
          ctx.fillStyle = colour;
          ctx.fill();
        } else {
          ctx.strokeStyle = colour;
          ctx.stroke();
        }
      }
      ctx.restore();
    });
  }
}

class MoveMarksPaneView implements IPanePrimitivePaneView {
  public constructor(private readonly source: MoveMarksPrimitive) {}

  public zOrder(): PrimitivePaneViewZOrder {
    return "top";
  }

  public renderer(): IPrimitivePaneRenderer | null {
    return this.source.buildRenderer();
  }
}

/**
 * Draws the big-move marks. A pane primitive fed through `update`, so a threshold change repaints
 * without rebuilding the chart. lightweight-charts' own series markers have no hollow circle, and
 * the hollow/filled pair is what tells the two kinds of mark apart without colour.
 */
export class MoveMarksPrimitive implements IPanePrimitive<Time> {
  private readonly views: readonly IPanePrimitivePaneView[];
  private chart: IChartApi | null = null;
  private requestUpdate: (() => void) | null = null;
  private markers: readonly ChartMarker[] = [];
  private extents: MarkExtents = {};

  public constructor(
    private readonly series: () => ISeriesApi<"Candlestick"> | null,
    private readonly upColour: string,
    private readonly downColour: string,
  ) {
    this.views = [new MoveMarksPaneView(this)];
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

  public update(markers: readonly ChartMarker[], extents: MarkExtents): void {
    this.markers = markers;
    this.extents = extents;
    this.requestUpdate?.();
  }

  private placed(): PlacedMark[] {
    const series = this.series();
    if (!this.chart || !series) return [];
    const timeScale = this.chart.timeScale();
    const result: PlacedMark[] = [];
    for (const marker of this.markers) {
      const extent = this.extents[marker.date];
      if (!extent) continue;
      const x = timeScale.timeToCoordinate(marker.date as Time);
      const edge = series.priceToCoordinate(marker.up ? extent.high : extent.low);
      if (x === null || edge === null) continue;
      result.push({ x, y: marker.up ? edge - OFFSET : edge + OFFSET, marker });
    }
    return result;
  }

  /** The mark under a pointer position, if any. */
  public hit(x: number, y: number): ChartMarker | null {
    let best: { distance: number; marker: ChartMarker } | null = null;
    for (const mark of this.placed()) {
      const distance = Math.hypot(mark.x - x, mark.y - y);
      if (distance <= HIT_PX && (best === null || distance < best.distance)) best = { distance, marker: mark.marker };
    }
    return best?.marker ?? null;
  }

  public buildRenderer(): IPrimitivePaneRenderer | null {
    const marks = this.placed();
    return marks.length === 0 ? null : new MoveMarksRenderer(marks, this.upColour, this.downColour);
  }
}
