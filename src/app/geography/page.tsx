import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import { formatOverdue, formatRelative, tierTextClass } from '@/lib/format';
import { getCities, getGeography } from '@/lib/queries';

export const metadata = { title: 'Geography' };

type Props = { searchParams: Promise<{ city?: string }> };

/**
 * Trip planning.
 *
 * Two cohorts, labelled and kept apart: active relationships to see, and
 * watchlist entries to try to meet. They answer different questions — who is
 * overdue there, versus who could introduce me there — so mixing them into one
 * list would make both worse.
 */
export default async function GeographyPage({ searchParams }: Props) {
  await requireOperator();
  const { city } = await searchParams;

  const [cities, cohorts] = await Promise.all([getCities(), city ? getGeography(city) : null]);

  return (
    <main className="py-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Geography</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Where is the trip? This returns who to see and who could introduce you.
        </p>
      </header>

      <form method="get" className="card mb-6 flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-48 flex-1">
          <label className="label" htmlFor="city">
            City
          </label>
          <input
            id="city"
            name="city"
            list="known-cities"
            defaultValue={city}
            className="field"
            placeholder="Los Angeles"
          />
          <datalist id="known-cities">
            {cities.map((entry) => (
              <option key={entry.city} value={entry.city} />
            ))}
          </datalist>
        </div>
        <button type="submit" className="btn-primary px-3 py-2 text-sm">
          Plan
        </button>
      </form>

      {!city ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
            Where your network is
          </h2>
          <ul className="divide-y divide-line-soft">
            {cities.slice(0, 30).map((entry) => (
              <li key={entry.city} className="flex items-baseline justify-between py-2 text-sm">
                <Link
                  href={`/geography?city=${encodeURIComponent(entry.city)}`}
                  className="font-medium hover:underline"
                >
                  {entry.city}
                </Link>
                <span className="text-xs text-ink-faint">
                  {entry.active} active
                  {entry.watchlist > 0 ? ` · ${entry.watchlist} on the watchlist` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="space-y-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
              People to see in {city}
            </h2>
            {cohorts!.active.length === 0 ? (
              <p className="card p-4 text-sm text-ink-faint">Nobody active there.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {cohorts!.active.map((row) => (
                  <li key={row.person_id} className="py-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/person/${row.person_id}`} className="font-medium hover:underline">
                        {row.full_name}
                      </Link>
                      <span className="text-sm text-ink-soft">
                        {[row.position, row.organization_name].filter(Boolean).join(' · ')}
                      </span>
                      <span className={`ml-auto font-mono text-xs ${tierTextClass(row.tier)}`}>
                        {row.tier}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs">
                      <span className={row.is_overdue ? 'text-overdue' : 'text-ink-faint'}>
                        {formatOverdue(row.days_overdue)}
                      </span>
                      <span className="text-ink-faint">
                        {' '}
                        · last contact {formatRelative(row.last_touch_at)}
                        {row.stage ? ` · ${row.stage}` : ''}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
              Worth trying to meet in {city}
            </h2>
            {cohorts!.watchlist.length === 0 ? (
              <p className="card p-4 text-sm text-ink-faint">
                Nobody on the watchlist there.{' '}
                <Link href="/watchlist/new" className="text-accent hover:underline">
                  Add someone
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2">
                {cohorts!.watchlist.map((row) => (
                  <li key={row.person_id} className="card p-4">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <Link href={`/person/${row.person_id}`} className="font-medium hover:underline">
                        {row.full_name}
                      </Link>
                      <span className="text-sm text-ink-soft">
                        {[row.position, row.organization_name].filter(Boolean).join(' · ')}
                      </span>
                      {row.watchlist_priority ? (
                        <span className="ml-auto text-xs text-ink-faint">{row.watchlist_priority}</span>
                      ) : null}
                    </div>

                    <p className="mt-1 text-sm">{row.watchlist_reason}</p>

                    <p className="mt-1.5 text-xs">
                      {row.warm_path_count > 0 ? (
                        <span className="text-ok">
                          Ask {row.top_paths?.slice(0, 2).join(' or ')} for an introduction
                        </span>
                      ) : (
                        <span className="text-ink-faint">No warm path — cold approach only</span>
                      )}
                      {row.outreach_attempts > 0 ? (
                        <span className="text-ink-faint">
                          {' '}
                          · {row.outreach_attempts} previous{' '}
                          {row.outreach_attempts === 1 ? 'attempt' : 'attempts'}
                        </span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
