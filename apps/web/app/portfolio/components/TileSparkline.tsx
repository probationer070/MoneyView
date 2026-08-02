/**
 * A sparkline drawn as a single inline <svg>.
 *
 * StockTile renders this inside a <button>, which may hold phrasing content only, and the
 * shared recharts `Sparkline` cannot meet that: `ResponsiveContainer` and the chart wrapper
 * each render a <div> of their own, inside the library, so no prop on our side reaches them.
 * An <svg> is phrasing content, needs no ResizeObserver to size itself, and costs nothing to
 * mount once per tile. The shared component keeps its recharts implementation for the places
 * that render it in flow content.
 */
interface TileSparklineProps {
  data: number[];
  height?: number;
}

export function TileSparkline({ data, height = 40 }: TileSparklineProps) {
  const points = data.filter((value) => Number.isFinite(value));

  // One point is not a line. Hold the space anyway, so a tile without history is the same
  // height as its neighbours instead of jumping the grid.
  if (points.length < 2) {
    return <span className="block" style={{ height }} />;
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  // The same 10% headroom the shared Sparkline gives its domain, so the stroke is never
  // clipped at the box edge. A flat series has no range to pad, so pad it by a unit and let
  // it sit down the middle.
  const low = span === 0 ? min - 1 : min - span * 0.1;
  const high = span === 0 ? max + 1 : max + span * 0.1;

  const path = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = height - ((value - low) / (high - low)) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="block w-full"
      style={{ height }}
      // Decorative: the tile's aria-label already voices ticker, price and delta, and a
      // shape has nothing to add to that.
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2}
        // The viewBox is stretched to the tile width, which would stretch the stroke with
        // it and leave every tile a different line weight.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
