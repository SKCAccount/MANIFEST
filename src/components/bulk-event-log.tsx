'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { logBulkEvent } from '@/lib/actions/touchpoints';

type Attendee = {
  id: string;
  full_name: string;
  organizationName: string | null;
  contactStatus: 'active' | 'uncontacted';
  hasMetAt: boolean;
};

/**
 * Bulk event logging: pick a source, check off everyone spoken to.
 *
 * Writes one touchpoint per person sharing a group_key, and because a
 * conversation at an event is a meeting — two-way by definition — checking off
 * a watchlist entry promotes them. That promotion is the single most valuable
 * thing this screen does, so the form says so before you press the button.
 */
export function BulkEventLog({
  sourceId,
  sourceName,
  people,
}: {
  sourceId: string;
  sourceName: string;
  people: Attendee[];
}) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return people.slice(0, 60);
    return people
      .filter(
        (person) =>
          person.full_name.toLowerCase().includes(term) ||
          (person.organizationName ?? '').toLowerCase().includes(term),
      )
      .slice(0, 60);
  }, [people, filter]);

  const selectedWatchlist = [...checked].filter(
    (id) => people.find((p) => p.id === id)?.contactStatus === 'uncontacted',
  ).length;

  function toggle(id: string) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit(formData: FormData) {
    setError(null);
    setResult(null);
    for (const id of checked) formData.append('person_ids', id);

    startTransition(async () => {
      const outcome = await logBulkEvent(formData);
      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }
      const { logged, promoted, metAtSet } = outcome.data;
      setResult(
        `Logged ${logged} ${logged === 1 ? 'conversation' : 'conversations'}` +
          (promoted > 0 ? ` · promoted ${promoted} off the watchlist` : '') +
          (metAtSet > 0 ? ` · set Met At for ${metAtSet}` : ''),
      );
      setChecked(new Set());
      router.refresh();
    });
  }

  return (
    <form action={submit} className="card p-4">
      <input type="hidden" name="source_id" value={sourceId} />

      <h2 className="text-sm font-semibold">Log conversations at {sourceName}</h2>
      <p className="mt-0.5 mb-3 text-xs text-ink-faint">
        Check off everyone you actually spoke to. Each gets one meeting touchpoint.
      </p>

      <input
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="field mb-2"
        placeholder="Filter by name or organization…"
      />

      <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-md border border-line-soft p-2">
        {visible.map((person) => (
          <li key={person.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent-soft/40">
              <input
                type="checkbox"
                checked={checked.has(person.id)}
                onChange={() => toggle(person.id)}
              />
              <span className="font-medium">{person.full_name}</span>
              {person.organizationName ? (
                <span className="text-xs text-ink-soft">{person.organizationName}</span>
              ) : null}
              {person.contactStatus === 'uncontacted' ? (
                <span className="ml-auto text-[10px] tracking-wide text-warn uppercase">
                  watchlist
                </span>
              ) : null}
            </label>
          </li>
        ))}
        {visible.length === 0 ? (
          <li className="px-1.5 py-2 text-sm text-ink-faint">Nobody matches.</li>
        ) : null}
      </ul>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="label">When</span>
          <input type="date" name="occurred_at" className="field" />
        </label>
        <div className="space-y-1.5 self-end pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="substantive" />
            <span>
              Substantive
              <span className="ml-1 text-xs text-ink-faint">— real conversations, not card swaps</span>
            </span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="set_met_at_for_new" defaultChecked />
            <span>
              Set Met At for anyone new
              <span className="ml-1 text-xs text-ink-faint">— never overwrites an existing one</span>
            </span>
          </label>
        </div>
      </div>

      <div className="mt-3">
        <label className="label" htmlFor="bulk-summary">
          Shared note <span className="normal-case">(optional)</span>
        </label>
        <input id="bulk-summary" name="summary" className="field" placeholder="Applied to every row." />
      </div>

      {selectedWatchlist > 0 ? (
        <p className="mt-3 rounded-md border border-line bg-accent-soft/40 px-3 py-2 text-xs">
          {selectedWatchlist} of the people checked{' '}
          {selectedWatchlist === 1 ? 'is' : 'are'} on the watchlist. A conversation at an event is
          two-way contact, so {selectedWatchlist === 1 ? 'they' : 'they'} will be promoted.
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-overdue" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <p className="mt-2 text-xs text-ok" role="status">
          {result}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || checked.size === 0}
        className="btn-primary mt-3 px-3 py-2 text-sm"
      >
        {pending
          ? 'Logging…'
          : `Log ${checked.size} ${checked.size === 1 ? 'conversation' : 'conversations'}`}
      </button>
    </form>
  );
}
