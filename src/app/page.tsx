import Link from 'next/link';
import { QueueRow } from '@/components/queue-row';
import { requireOperator } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { getNeverFollowedUp, getQueue, getQueueDepth } from '@/lib/queries';

export const metadata = { title: 'Queue' };

/**
 * Home. The success test is: on a phone, in under ten seconds, who is overdue
 * and what do I say to them.
 *
 * Fifteen rows maximum. A queue that shows everything overdue is a list you
 * scroll past; a queue that shows fifteen is a list you work.
 */
export default async function QueuePage() {
  await requireOperator();

  const [queue, depth, neverFollowedUp] = await Promise.all([
    getQueue(15),
    getQueueDepth(),
    getNeverFollowedUp(10),
  ]);

  return (
    <main className="py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Queue</h1>
        <p className="text-sm text-ink-soft">
          {depth === 0
            ? 'Nobody is overdue.'
            : `${depth} overdue${depth > queue.length ? `, showing the top ${queue.length}` : ''}`}
        </p>
      </header>

      {queue.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-medium">Nothing is overdue.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Every active relationship is inside its cadence. Come back tomorrow.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/person/new" className="btn-primary px-3 py-2 text-sm">
              Add someone
            </Link>
            <Link href="/watchlist" className="btn px-3 py-2 text-sm">
              Work the watchlist
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {queue.map((row) => (
            <QueueRow key={row.person_id} row={row} />
          ))}
        </ul>
      )}

      {/*
        Directly beneath the queue, per §8.1. These are people met once and
        never contacted again — still recoverable, but not for much longer.
      */}
      {neverFollowedUp.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-sm font-semibold tracking-wide text-ink-soft uppercase">
            Never followed up
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Met once, nothing since. Recoverable for about 120 days.
          </p>

          <ul className="mt-3 divide-y divide-line-soft">
            {neverFollowedUp.map((row) => (
              <li key={row.person_id} className="flex flex-wrap items-baseline gap-x-2 py-2.5 text-sm">
                <Link href={`/person/${row.person_id}`} className="font-medium hover:underline">
                  {row.full_name}
                </Link>
                {row.organization_name ? (
                  <span className="text-ink-soft">{row.organization_name}</span>
                ) : null}
                {row.met_at ? <span className="text-xs text-ink-faint">met at {row.met_at}</span> : null}
                <span className="ml-auto text-xs text-ink-faint">
                  {formatRelative(row.only_touch_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
