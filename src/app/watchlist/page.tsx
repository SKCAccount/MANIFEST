import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { getWatchlist } from '@/lib/queries';

export const metadata = { title: 'Watchlist' };

const PRIORITY_CLASS: Record<string, string> = {
  high: 'text-overdue',
  medium: 'text-warn',
  low: 'text-ink-faint',
};

/**
 * People worth meeting, grouped by city.
 *
 * Grouped by city rather than by date because geography is the usual trigger
 * for working this list. Days waiting is shown but never sorted or flagged on:
 * a watchlist entry's value is contingent on a trigger that has no schedule,
 * so elapsed time carries no information about it. There are deliberately no
 * staleness indicators anywhere on this screen.
 */
export default async function WatchlistPage() {
  await requireOperator();
  const byCity = await getWatchlist();

  const total = [...byCity.values()].reduce((sum, rows) => sum + rows.length, 0);

  return (
    <main className="py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Watchlist</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {total} {total === 1 ? 'person' : 'people'} you intend to meet, by city.
          </p>
        </div>
        <Link href="/watchlist/new" className="btn-primary px-3 py-2 text-sm">
          Add someone
        </Link>
      </header>

      {total === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-medium">Nobody on the watchlist.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
            Add people you have a reason to meet but have not been in contact with. One at a time,
            each with a written reason — that is what keeps this list worth working.
          </p>
          <Link href="/watchlist/new" className="btn-primary mt-4 inline-flex px-3 py-2 text-sm">
            Add someone
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {[...byCity.entries()].map(([city, rows]) => (
            <section key={city}>
              <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                {city}
                <span className="text-xs font-normal text-ink-faint">
                  {rows.length} {rows.length === 1 ? 'person' : 'people'}
                </span>
                <Link
                  href={`/geography?city=${encodeURIComponent(city)}`}
                  className="ml-auto text-xs font-normal text-accent hover:underline"
                >
                  Plan a trip here →
                </Link>
              </h2>

              <ul className="space-y-2">
                {rows.map((row) => (
                  <li key={row.person_id} className="card p-4">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/person/${row.person_id}`} className="font-medium hover:underline">
                        {row.full_name}
                      </Link>
                      <span className="text-sm text-ink-soft">
                        {[row.position, row.organization_name].filter(Boolean).join(' · ')}
                      </span>
                      {row.watchlist_priority ? (
                        <span
                          className={`ml-auto text-xs font-medium ${PRIORITY_CLASS[row.watchlist_priority] ?? ''}`}
                        >
                          {row.watchlist_priority}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-1.5 text-sm">{row.watchlist_reason}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-faint">
                      {row.introduced_by_name ? (
                        <span>
                          Mentioned by{' '}
                          <Link
                            href={`/person/${row.introduced_by_person_id}`}
                            className="text-accent hover:underline"
                          >
                            {row.introduced_by_name}
                          </Link>
                        </span>
                      ) : row.watchlist_source ? (
                        <span>via {row.watchlist_source}</span>
                      ) : null}

                      {row.warm_path_count > 0 ? (
                        <span className="text-ok">
                          {row.warm_path_count} warm{' '}
                          {row.warm_path_count === 1 ? 'path' : 'paths'}
                          {row.top_paths?.length ? `: ${row.top_paths.join(', ')}` : ''}
                        </span>
                      ) : (
                        <span>No warm path</span>
                      )}

                      {row.outreach_attempts > 0 ? (
                        <span>
                          {row.outreach_attempts}{' '}
                          {row.outreach_attempts === 1 ? 'attempt' : 'attempts'}, last{' '}
                          {formatRelative(row.last_attempt_at)} by {row.last_attempt_channel}
                        </span>
                      ) : null}

                      {/* Displayed, never ranked on. */}
                      {row.days_waiting !== null ? <span>on the list {row.days_waiting} days</span> : null}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link href={`/person/${row.person_id}`} className="btn px-2.5 py-1.5 text-xs">
                        Log an attempt
                      </Link>
                      {row.linkedin_url ? (
                        <a
                          href={row.linkedin_url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="btn px-2.5 py-1.5 text-xs"
                        >
                          LinkedIn
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
