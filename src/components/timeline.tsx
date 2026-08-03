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
  external_url?: string | null;
  source_ref?: unknown;
};

const DIRECTION_MARK: Record<TouchDirection, string> = {
  inbound: '←',
  outbound: '→',
  mutual: '↔',
};

/**
 * Which rows a job wrote rather than the operator.
 *
 * Shown on every synced row, and it is not decoration. A summary the operator
 * typed is something he observed; a summary sync produced is a model's reading
 * of a subject line and a two-hundred-character extract, and he should be able
 * to tell which he is looking at before he walks into a meeting on the strength
 * of it. The permalink is the answer to "is that actually what happened" — the
 * message body is never stored, so the link is the only route back to the
 * source.
 */
const SYNCED: Record<string, { label: string; linkText: string }> = {
  gmail: { label: 'synced', linkText: 'Open in Gmail' },
  gcal: { label: 'synced', linkText: 'Open in Calendar' },
};

/**
 * The append-only record, read backwards.
 *
 * Three things are marked rather than hidden: a superseded row is struck
 * through (the correction sits above it), a system entry is dimmed, and a
 * synced row says so and links to its source. Nothing is removed — that is the
 * point of an append-only log.
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

              {SYNCED[touchpoint.source] ? (
                <span
                  className="rounded-full border border-line px-1.5 py-px text-[10px] text-ink-faint"
                  title="Written by sync, not entered by hand"
                >
                  {SYNCED[touchpoint.source]!.label}
                </span>
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

            {touchpoint.external_url && SYNCED[touchpoint.source] ? (
              <a
                href={touchpoint.external_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                {SYNCED[touchpoint.source]!.linkText}
              </a>
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
