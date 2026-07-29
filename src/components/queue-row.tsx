'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { contactedToday, } from '@/lib/actions/touchpoints';
import { changeTier, snoozePerson } from '@/lib/actions/people';
import type { QueueRow as Row } from '@/lib/db/database.types';
import { TIER_VALUES } from '@/lib/db/enums';
import { formatOverdue, tierTextClass } from '@/lib/format';

/**
 * One row of the ten-second test.
 *
 * The suggested opener is the point of the row. "40 days overdue" gets skipped;
 * "changed jobs three weeks ago" gets acted on. So the opener gets the
 * full-width line and everything else is metadata around it.
 */
export function QueueRow({ row }: { row: Row }) {
  const [pending, startTransition] = useTransition();
  const [expanded, setExpanded] = useState(false);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function run(action: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) setError(result.error ?? 'Something went wrong.');
      else setDone(true);
    });
  }

  if (done) {
    return (
      <li className="card flex items-center justify-between px-4 py-3 text-sm text-ink-soft">
        <span>
          Logged for <span className="font-medium text-ink">{row.full_name}</span>.
        </span>
        <Link href={`/person/${row.person_id}`} className="text-accent hover:underline">
          Open
        </Link>
      </li>
    );
  }

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Link href={`/person/${row.person_id}`} className="font-medium hover:underline">
          {row.full_name}
        </Link>
        {row.position || row.organization_name ? (
          <span className="text-sm text-ink-soft">
            {[row.position, row.organization_name].filter(Boolean).join(' · ')}
          </span>
        ) : null}

        <span className="ml-auto flex items-center gap-2 text-xs">
          <span className={`font-mono font-semibold ${tierTextClass(row.tier)}`}>{row.tier}</span>
          <span className="text-overdue">{formatOverdue(row.days_overdue)}</span>
        </span>
      </div>

      <p className="mt-2 text-sm">{row.suggested_opener}</p>

      {row.last_substantive_summary && row.opener_kind !== 'last_conversation' ? (
        <p className="mt-1 text-xs text-ink-faint">Last time: {row.last_substantive_summary}</p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-overdue" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => setExpanded((v) => !v)}
          className="btn-primary px-2.5 py-1.5 text-xs"
        >
          Contacted today
        </button>

        <details className="relative">
          <summary className="btn cursor-pointer list-none px-2.5 py-1.5 text-xs">Snooze</summary>
          <div className="card absolute z-10 mt-1 flex gap-1 p-1 shadow-lg">
            {[30, 60, 90].map((days) => (
              <button
                key={days}
                type="button"
                disabled={pending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('person_id', row.person_id);
                  fd.set('days', String(days));
                  run(snoozePerson, fd);
                }}
                className="btn px-2 py-1 text-xs"
              >
                {days}d
              </button>
            ))}
          </div>
        </details>

        <details className="relative">
          <summary className="btn cursor-pointer list-none px-2.5 py-1.5 text-xs">Tier</summary>
          <div className="card absolute z-10 mt-1 flex gap-1 p-1 shadow-lg">
            {TIER_VALUES.map((tier) => (
              <button
                key={tier}
                type="button"
                disabled={pending || tier === row.tier}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('person_id', row.person_id);
                  fd.set('tier', tier);
                  run(changeTier, fd);
                }}
                className={`btn px-2 py-1 font-mono text-xs ${tierTextClass(tier)} disabled:opacity-40`}
              >
                {tier}
              </button>
            ))}
          </div>
        </details>

        <Link href={`/person/${row.person_id}`} className="btn px-2.5 py-1.5 text-xs">
          Open
        </Link>
      </div>

      {expanded ? (
        <div className="mt-3 border-t border-line-soft pt-3">
          <label className="label" htmlFor={`summary-${row.person_id}`}>
            What did you discuss? <span className="normal-case">(optional)</span>
          </label>
          <textarea
            id={`summary-${row.person_id}`}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={2}
            className="field"
            placeholder="Walked through the Q2 facility. He is sending the AR ageing."
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const fd = new FormData();
                fd.set('person_id', row.person_id);
                fd.set('channel', 'call');
                // Reaching for this button means a real conversation happened,
                // and only a substantive touchpoint resets the cadence clock.
                fd.set('substantive', 'on');
                if (summary.trim()) fd.set('summary', summary);
                run(contactedToday, fd);
              }}
              className="btn-primary px-2.5 py-1.5 text-xs"
            >
              {pending ? 'Saving…' : 'Log it'}
            </button>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="btn px-2.5 py-1.5 text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
