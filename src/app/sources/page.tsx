import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { getSources } from '@/lib/queries';

export const metadata = { title: 'Sources' };

/**
 * Where people came from. Event economics live here in Phase 3; for now this is
 * the lookup the person form and bulk event logging read from, plus the
 * present-day contact counts that already compute for free.
 */
export default async function SourcesPage() {
  await requireOperator();
  const sources = await getSources();

  const events = sources.filter((s) => s.cost_total_cents !== null);
  const origins = sources.filter((s) => s.cost_total_cents === null);

  return (
    <main className="py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-sm text-ink-soft">Where relationships started.</p>
        </div>
        <Link href="/sources/new" className="btn-primary px-3 py-2 text-sm">
          Add a source
        </Link>
      </header>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">Events</h2>
        {events.length === 0 ? (
          <p className="card p-4 text-sm text-ink-faint">No events yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {events.map((source) => (
              <li key={source.source_id} className="py-3">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/sources/${source.source_id}`} className="font-medium hover:underline">
                    {source.display_name}
                  </Link>
                  <span className="text-sm text-ink-soft">
                    {[source.kind, source.city].filter(Boolean).join(' · ')}
                  </span>
                  <span className="ml-auto text-sm">{formatMoney(source.cost_total_cents)}</span>
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {formatDate(source.occurred_on)}
                  {source.days_since_event !== null ? ` · ${source.days_since_event} days ago` : ''}
                  {' · '}
                  {source.new_contacts} new {source.new_contacts === 1 ? 'contact' : 'contacts'}
                  {source.relationships_touched > source.new_contacts
                    ? `, ${source.relationships_touched} relationships touched`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-faint">
          Cost per contact, stage distribution and horizon-matched comparison arrive with the Events
          screen in Phase 3. The data behind them is already being recorded.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
          Other origins
        </h2>
        <ul className="divide-y divide-line-soft">
          {origins.map((source) => (
            <li key={source.source_id} className="flex items-baseline justify-between py-2 text-sm">
              <Link href={`/sources/${source.source_id}`} className="font-medium hover:underline">
                {source.display_name}
              </Link>
              <span className="text-xs text-ink-faint">
                {source.new_contacts} {source.new_contacts === 1 ? 'person' : 'people'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
