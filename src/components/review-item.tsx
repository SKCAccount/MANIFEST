'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { attachSuggestion, rejectSuggestion } from '@/lib/actions/sync';
import { formatRelative } from '@/lib/format';
import type { ReviewQueueRow } from '@/lib/db/database.types';

export type PickerPerson = {
  id: string;
  full_name: string;
  organizationName: string | null;
  contactStatus: 'active' | 'uncontacted';
};

/**
 * One unresolved address, and the three things that can be done with it.
 *
 * The ordering is the design. The suggested match is a single button because it
 * is right most of the time and should cost one click; picking somebody else is
 * behind a disclosure because it is the uncommon case; and "not a person" is
 * last and plain, because dismissing is cheap to do and expensive to undo —
 * sync will not raise the address again.
 *
 * What is deliberately absent is any way to create a person from here. The
 * "Add" links hand off to the ordinary forms, which still demand a watchlist
 * reason or a qualifying conversation. Letting this screen mint records would
 * turn a reviewed rolodex into an inbox with extra steps, which is exactly the
 * failure the whole contact_status split exists to prevent.
 */
export function ReviewItem({ item, people }: { item: ReviewQueueRow; people: PickerPerson[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState('');
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return people.slice(0, 8);
    return people
      .filter(
        (person) =>
          person.full_name.toLowerCase().includes(term) ||
          (person.organizationName ?? '').toLowerCase().includes(term),
      )
      .slice(0, 8);
  }, [people, filter]);

  function attach(personId: string) {
    setError(null);
    startTransition(async () => {
      const result = await attachSuggestion(item.id, personId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(
        result.data.backfilled > 0
          ? `Attached, and pulled in ${result.data.backfilled} earlier ${
              result.data.backfilled === 1 ? 'exchange' : 'exchanges'
            }.`
          : 'Attached.',
      );
      router.refresh();
    });
  }

  function dismiss() {
    setError(null);
    startTransition(async () => {
      const result = await rejectSuggestion(item.id, 'Dismissed from the review queue.');
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone('Dismissed. This address will not come back.');
      router.refresh();
    });
  }

  if (done) {
    return (
      <li className="card p-4 text-sm text-ink-soft">
        <span className="font-mono text-xs text-ink-faint">{item.address}</span> — {done}
      </li>
    );
  }

  const isMeeting = item.kind === 'calendar_suggestion';
  const addLink = `/person/new?email=${encodeURIComponent(item.address)}${
    item.display_name ? `&name=${encodeURIComponent(item.display_name)}` : ''
  }`;

  return (
    <li className="card p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm font-medium">{item.display_name ?? item.address}</span>
        {item.display_name ? (
          <span className="font-mono text-xs text-ink-faint">{item.address}</span>
        ) : null}

        <span className="rounded-full border border-line px-1.5 py-px text-[10px] text-ink-faint">
          {isMeeting ? 'meeting' : 'email'}
        </span>

        {item.occurrences > 1 ? (
          <span className="text-[10px] text-ink-faint">seen {item.occurrences}×</span>
        ) : null}

        {item.last_seen ? (
          <span className="ml-auto text-xs text-ink-faint">{formatRelative(item.last_seen)}</span>
        ) : null}
      </div>

      {item.last_subject ? (
        <p className="mt-1 text-sm text-ink-soft">
          {item.last_direction === 'outbound' ? '→ ' : item.last_direction === 'inbound' ? '← ' : ''}
          {item.last_subject}
        </p>
      ) : null}

      {item.last_direction === 'unconfirmed' ? (
        <p className="mt-1 text-xs text-warn">
          They never responded to the invitation. Attach them only if the meeting happened.
        </p>
      ) : null}

      {item.domain_organization_name ? (
        <p className="mt-1 text-xs text-ink-faint">
          {item.domain}
          {' — '}
          <Link
            href={`/rolodex?org=${item.domain_organization_id}`}
            className="text-accent hover:underline"
          >
            {item.domain_organization_name}
          </Link>
        </p>
      ) : null}

      {error ? <p className="mt-2 text-sm text-overdue">{error}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.suggested_person_id ? (
          <button
            type="button"
            onClick={() => attach(item.suggested_person_id!)}
            disabled={pending}
            className="btn-primary px-2.5 py-1.5 text-sm"
          >
            This is {item.suggested_person_name}
          </button>
        ) : null}

        <button
          type="button"
          onClick={() => setPicking((open) => !open)}
          disabled={pending}
          className="btn px-2.5 py-1.5 text-sm"
        >
          {item.suggested_person_id ? 'Someone else' : 'Attach to someone'}
        </button>

        <Link href={addLink} className="btn px-2.5 py-1.5 text-sm">
          Add as new
        </Link>

        <button
          type="button"
          onClick={dismiss}
          disabled={pending}
          className="ml-auto text-xs text-ink-faint hover:text-overdue"
        >
          Not a person
        </button>
      </div>

      {picking ? (
        <div className="mt-3 border-t border-line pt-3">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Search the rolodex…"
            className="field text-sm"
            autoFocus
          />
          <ul className="mt-2 space-y-1">
            {matches.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => attach(person.id)}
                  disabled={pending}
                  className="flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent-soft"
                >
                  <span>{person.full_name}</span>
                  {person.organizationName ? (
                    <span className="text-xs text-ink-faint">{person.organizationName}</span>
                  ) : null}
                  {person.contactStatus === 'uncontacted' ? (
                    <span className="ml-auto text-[10px] text-ink-faint">watchlist</span>
                  ) : null}
                </button>
              </li>
            ))}
            {matches.length === 0 ? (
              <li className="px-2 py-1.5 text-sm text-ink-faint">Nobody matches that.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </li>
  );
}
