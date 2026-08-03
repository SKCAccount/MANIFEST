/**
 * The same show, year over year.
 *
 * One measure across a handful of editions, so it is one series and every
 * column takes the same colour. Colouring the columns by their own value would
 * spend the identity channel re-encoding what the height already says, and a
 * single series needs no legend — the caption names it.
 *
 * SVG here, unlike the stage bar, because a column chart wants a coordinate
 * system: a baseline to grow from, caps to label, and a fixed aspect that does
 * not care how wide the card is. The viewBox scales the whole thing intact
 * rather than stretching the geometry.
 */

const COLUMN = 22; // ≤ 24px: the band keeps its air rather than being filled
const GAP = 14;
const STEP = COLUMN + GAP;
const PLOT_HEIGHT = 64;
const CAP_BAND = 14; // room for the value above each column
const AXIS_BAND = 16; // room for the year beneath it — sized in, not clipped

export type SeriesPoint = {
  label: string;
  value: number;
  /** Rendered on the cap. Falls back to the raw value. */
  display?: string;
  /** Marks an edition whose figure is not yet comparable. */
  provisional?: boolean;
};

export function SeriesChart({ points, caption }: { points: SeriesPoint[]; caption: string }) {
  if (points.length === 0) return null;

  const width = points.length * STEP - GAP;
  const height = CAP_BAND + PLOT_HEIGHT + AXIS_BAND;

  // Scaled against the largest column rather than a rounded axis maximum: with
  // every column directly labelled there is no axis to read, so a tick scale
  // would be ink carrying nothing.
  const peak = Math.max(...points.map((point) => point.value), 1);

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMinYMid meet"
        role="img"
        aria-label={`${caption}. ${points.map((p) => `${p.label}: ${p.display ?? p.value}`).join('. ')}`}
      >
        {points.map((point, index) => {
          const columnHeight = Math.max((point.value / peak) * PLOT_HEIGHT, point.value > 0 ? 2 : 0);
          const x = index * STEP;
          const y = CAP_BAND + PLOT_HEIGHT - columnHeight;

          return (
            <g key={`${point.label}-${index}`}>
              <title>
                {point.label}: {point.display ?? point.value}
                {point.provisional ? ' (still maturing)' : ''}
              </title>

              {columnHeight > 0 ? (
                // Rounded cap, square baseline. The radius is clamped so a very
                // short column does not turn into a lozenge.
                <rect
                  x={x}
                  y={y}
                  width={COLUMN}
                  height={columnHeight}
                  rx={Math.min(4, columnHeight / 2)}
                  ry={Math.min(4, columnHeight / 2)}
                  fill="var(--color-series)"
                  opacity={point.provisional ? 0.45 : 1}
                />
              ) : null}
              {/* Square off the baseline end that rx just rounded. */}
              {columnHeight > 4 ? (
                <rect
                  x={x}
                  y={CAP_BAND + PLOT_HEIGHT - 4}
                  width={COLUMN}
                  height={4}
                  fill="var(--color-series)"
                  opacity={point.provisional ? 0.45 : 1}
                />
              ) : null}

              {/* Value on the cap and year beneath, both in text tokens — never
                  the series colour, which is what the column already carries. */}
              <text
                x={x + COLUMN / 2}
                y={Math.max(y - 4, 9)}
                textAnchor="middle"
                fontSize="9"
                className="fill-ink-soft"
              >
                {point.display ?? point.value}
              </text>
              <text
                x={x + COLUMN / 2}
                y={height - 4}
                textAnchor="middle"
                fontSize="9"
                className="fill-ink-faint"
              >
                {point.label}
              </text>
            </g>
          );
        })}

        {/* Hairline baseline, solid and recessive. */}
        <line
          x1={0}
          y1={CAP_BAND + PLOT_HEIGHT + 0.5}
          x2={width}
          y2={CAP_BAND + PLOT_HEIGHT + 0.5}
          stroke="var(--color-line)"
          strokeWidth={1}
        />
      </svg>
      <figcaption className="mt-1 text-[10px] text-ink-faint">{caption}</figcaption>
    </figure>
  );
}
