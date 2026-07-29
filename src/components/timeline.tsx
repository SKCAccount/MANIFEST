import { formatDateTime, humanize } from '@/lib/format';
import type { TouchChannel, TouchDirection } from '@/lib/db/enums';

type TimelineTouchpoint = {
  id: string;
  occurred_at: string;
  channel: TouchChannel;
  direction: TouchDirection;
  substantive: boolean;
  subject: string | null;
  summary: string | null;
  group_key: string | null;
  supersedes_id: string | null;
  source: string;
  source_ref?: unknown;
};

const DIRECTION_MARK: Record<TouchDirection, string> = {
  inbound: '←',
  outbound: '→',
  mutual: '↔',
};

/**
 * The append-only record, read backwards.
 *
 * Two things are marked rather than hidden: a superseded row is struck through
 * (the correction sits above it), and a system entry is dimmed. Nothing is
 * removed — that is the point of an append-only log.
 */
export function Timeline({ touchpoints }: { touchpoints: TimelineTouchpoint[] }) {
  const supersededIds = new Set(
    touchpoints.map((t) => t.supersedes_id).filter((id): id is string => id !== null),
  );

  return (
    <ol className="relative space-y-0 border-l border-line pl-4">
      {touchpoints.map((touchpoint) => {
        const isSystem = touchpoint.channel === 'system';
        const isSuperseded = supersededIds.has(touchpoint.id);
        const source = touchpoint.source_ref as { display_name: string } | null;

        return (
          <li key={touchpoint.id} className="relative py-2.5">
            <span
              className={`absolute -left-[21px] top-4 h-2 w-2 rounded-full border-2 border-paper ${
                isSystem ? 'bg-line' : touchpoint.substantive ? 'bg-accent' : 'bg-ink-faint'
              }`}
              aria-hidden
            />

            <div className={`flex flex-wrap items-baseline gap-x-2 ${isSystem ? 'opacity-60' : ''}`}>
              <span className="font-mono text-xs text-ink-faint" aria-hidden>
                {DIRECTION_MARK[touchpoint.direction]}
              </span>
              <span className="text-sm font-medium">
                {humanize(touchpoint.channel)}
                <span className="sr-only"> — {touchpoint.direction}</span>
              </span>

              {touchpoint.substantive ? (
                <span className="rounded-full border border-accent/40 px-1.5 py-px text-[10px] text-accent">
                  substantive
                </span>
              ) : null}

              {touchpoint.group_key ? (
                <span className="text-[10px] text-ink-faint">group</span>
              ) : null}

              {source?.display_name ? (
                <span className="text-xs text-ink-faint">{source.display_name}</span>
              ) : null}

              <span className="ml-auto text-xs text-ink-faint">
                {formatDateTime(touchpoint.occurred_at)}
              </span>
            </div>

            {touchpoint.subject ? (
              <p className={`text-sm ${isSuperseded ? 'text-ink-faint line-through' : ''}`}>
                {touchpoint.subject}
              </p>
            ) : null}

            {touchpoint.summary ? (
              <p
                className={`text-sm ${
                  isSuperseded ? 'text-ink-faint line-through' : isSystem ? 'text-ink-faint' : 'text-ink-soft'
                }`}
              >
                {touchpoint.summary}
              </p>
            ) : null}

            {isSuperseded ? (
              <p className="text-[10px] text-ink-faint">Corrected by a later entry.</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
