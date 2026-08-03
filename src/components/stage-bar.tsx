import { DEV_STAGE_VALUES, type DevStage } from '@/lib/db/enums';

/**
 * The development ladder as one bar.
 *
 * Card → Contact → Active → Producing is an *ordered* set, not a set of
 * categories: swapping two of them changes what they mean. So it is coloured
 * with one hue in four lightness steps rather than four separate hues, and the
 * order becomes visible in the colour itself. Someone who cannot distinguish
 * the hues still reads the ladder off the lightness, and the legend and the
 * counts beside it carry identity regardless — nothing here depends on colour
 * alone.
 *
 * Built from flex divs rather than SVG on purpose. A stacked bar has to fill
 * whatever width its row happens to be, and SVG offers two bad ways to do that:
 * `preserveAspectRatio="none"`, which stretches the rounded end into an
 * ellipse, or measuring the container in JS, which makes a server component a
 * client one for no gain. Percentage widths are responsive by construction.
 */

const STAGE_LABEL: Record<DevStage, string> = {
  card: 'Card',
  contact: 'Contact',
  active: 'Active',
  producing: 'Producing',
};

/** Matches --color-stage-1..4, which are validated in globals.css. */
const STAGE_VAR: Record<DevStage, string> = {
  card: 'var(--color-stage-1)',
  contact: 'var(--color-stage-2)',
  active: 'var(--color-stage-3)',
  producing: 'var(--color-stage-4)',
};

export type StageCounts = {
  card: number;
  contact: number;
  active: number;
  producing: number;
};

export function StageBar({ counts, label }: { counts: StageCounts; label?: string }) {
  const total = counts.card + counts.contact + counts.active + counts.producing;

  if (total === 0) {
    return (
      <div className="h-3.5 rounded-r-[4px] bg-line-soft" role="img" aria-label="No contacts yet" />
    );
  }

  // Zero-count stages are omitted rather than rendered at zero width, so the
  // 2px gaps stay meaningful — a run of empty segments would otherwise read as
  // a gap wider than the ones that separate real data.
  const segments = DEV_STAGE_VALUES.map((stage) => ({
    stage,
    count: counts[stage],
    percent: (counts[stage] / total) * 100,
  })).filter((segment) => segment.count > 0);

  const description = segments
    .map((segment) => `${segment.count} ${STAGE_LABEL[segment.stage]}`)
    .join(', ');

  return (
    <div
      className="flex h-3.5 gap-[2px]"
      role="img"
      aria-label={label ? `${label}: ${description}` : description}
    >
      {segments.map((segment, index) => (
        <div
          key={segment.stage}
          // The data-end is rounded and the baseline is square, so the bar
          // reads as growing from the left rather than floating.
          className={index === segments.length - 1 ? 'rounded-r-[4px]' : ''}
          style={{ width: `${segment.percent}%`, background: STAGE_VAR[segment.stage] }}
        >
          {/* Native tooltip: the per-segment number without a client component. */}
          <span className="sr-only">
            {segment.count} {STAGE_LABEL[segment.stage]}
          </span>
          <div className="h-full w-full" title={`${STAGE_LABEL[segment.stage]}: ${segment.count}`} />
        </div>
      ))}
    </div>
  );
}

/**
 * One legend for a whole list of bars.
 *
 * Always rendered where bars are — four segments is well past the point where
 * a reader can be expected to infer which step is which.
 */
export function StageLegend({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-ink-faint ${className}`}>
      {DEV_STAGE_VALUES.map((stage) => (
        <li key={stage} className="flex items-center gap-1">
          <span
            className="inline-block h-2 w-2 rounded-[1px]"
            style={{ background: STAGE_VAR[stage] }}
            aria-hidden
          />
          {STAGE_LABEL[stage]}
        </li>
      ))}
    </ul>
  );
}
