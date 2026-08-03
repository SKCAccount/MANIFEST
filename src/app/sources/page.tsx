import Link from 'next/link';
import { SeriesChart, type SeriesPoint } from '@/components/series-chart';
import { StageBar, StageLegend } from '@/components/stage-bar';
import { HORIZONS } from '@/lib/db/enums';
import type { SourceCohortRow, SourceRoiRow } from '@/lib/db/database.types';
import { requireOperator } from '@/lib/auth';
import { formatDate, formatMoney } from '@/lib/format';
import { getSourceCohort, getSources, getSourceSeries } from '@/lib/queries';
import { rankEvents } from '@/lib/sources';

export const metadata = { title: 'Sources' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Where relationships started, and what each room actually cost.
 *
 * Two rules run this screen, and both exist to stop a number from lying:
 *
 * 1. **Rank on cost per Active-or-better, not cost per contact.** Cost per
 *    contact is a leading indicator and is trivially flattered by collecting
 *    business cards — an event where the operator met forty people and stayed
 *    in touch with none of them would top that ranking. The full ladder is
 *    computed and shown, but what sorts is the rung that means a relationship
 *    exists.
 *
 * 2. **Never compare events of different ages at today's date.** A two-year-old
 *    conference has had two years to produce; a six-month-old one has not.
 *    Ranking them together rewards whichever is older, every time. The horizon
 *    selector re-measures every event at the same age instead — and any event
 *    not yet that old is moved below the fold rather than scored against ones
 *    that are.
 *
 * Even at present, `days_since_event` and `new_contacts` sit beside every ratio,
 * so a three-week-old $4,200 event with one attributed contact reads as
 * incomplete rather than as a failure.
 */
export default async function SourcesPage({ searchParams }: Props) {
  await requireOperator();

  const params = await searchParams;
  const raw = Array.isArray(params.h) ? params.h[0] : params.h;
  const horizon = HORIZONS.find((days) => String(days) === raw) ?? null;

  const [sources, cohort, series] = await Promise.all([
    getSources(),
    horizon ? getSourceCohort(horizon) : Promise.resolve([]),
    getSourceSeries(),
  ]);

  const events = sources.filter((source) => source.cost_total_cents !== null);
  const origins = sources.filter((source) => source.cost_total_cents === null);

  // At a horizon, the cohort view has already dropped anything too young to
  // measure. Those events are not hidden — they move below the fold, with how
  // long until they can be compared.
  const measured: Array<SourceRoiRow | SourceCohortRow> = horizon ? cohort : events;
  const measuredIds = new Set(measured.map((row) => row.source_id));
  const tooYoung = horizon ? events.filter((event) => !measuredIds.has(event.source_id)) : [];

  const ranked = rankEvents(measured);

  const repeated = series.filter((entry) => entry.editions > 1);

  return (
    <main className="py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Sources</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Where relationships started, ranked by what a real one cost.
          </p>
        </div>
        <Link href="/sources/new" className="btn-primary px-3 py-2 text-sm">
          Add a source
        </Link>
      </header>

      {/* Plain links rather than a control: the horizon belongs in the URL so a
          particular comparison can be returned to, and it needs no client JS. */}
      <nav className="mb-5 flex flex-wrap items-center gap-1 text-sm" aria-label="Measurement age">
        <span className="mr-1 text-xs text-ink-faint">Measured at</span>
        <HorizonLink label="Present" href="/sources" active={horizon === null} />
        {HORIZONS.map((days) => (
          <HorizonLink
            key={days}
            label={days >= 365 ? `${days / 365} yr` : `${days} d`}
            href={`/sources?h=${days}`}
            active={horizon === days}
          />
        ))}
      </nav>

      <section className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-ink-soft uppercase">Events</h2>
          <StageLegend />
        </div>

        <p className="mb-3 text-xs text-ink-faint">
          {horizon
            ? `Every event measured at ${horizon} days old, so age is not what separates them.`
            : 'Measured today, so a young event has had less time to produce. Pick an age above to compare fairly.'}
        </p>

        {ranked.length === 0 ? (
          <p className="card p-4 text-sm text-ink-faint">
            {horizon
              ? 'No event is that old yet.'
              : 'No events yet. Add one and log who you met.'}
          </p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {ranked.map((row) => (
              <EventRow key={row.source_id} row={row} />
            ))}
          </ul>
        )}

        {tooYoung.length > 0 ? (
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-xs font-medium text-ink-faint">
              Too young to compare at {horizon} days
            </h3>
            <p className="mt-0.5 text-xs text-ink-faint">
              Listed rather than ranked. Scoring these against mature events would mark them down
              for not having happened long enough ago.
            </p>
            <ul className="mt-2 space-y-1">
              {tooYoung.map((event) => (
                <li key={event.source_id} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <Link
                    href={`/sources/${event.source_id}`}
                    className="text-ink-soft hover:underline"
                  >
                    {event.display_name}
                  </Link>
                  <span className="text-xs text-ink-faint">
                    {event.days_since_event} days old
                    {horizon && event.days_since_event !== null
                      ? ` · comparable in ${horizon - event.days_since_event} days`
                      : ''}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">
                    {formatMoney(event.cost_total_cents)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {repeated.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
            The same show, year over year
          </h2>
          <p className="mb-3 text-xs text-ink-faint">
            The series is the event name — there is no series key to maintain. Bars are Active-or-
            better contacts per edition; the ratio beneath is for the series as a whole.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            {repeated.map((entry) => {
              const editions = events
                .filter((event) => event.event_name === entry.event_name)
                .sort((a, b) => (a.event_year ?? 0) - (b.event_year ?? 0));

              const points: SeriesPoint[] = editions.map((edition) => ({
                label: String(edition.event_year ?? '—'),
                value: edition.active_or_better,
                // An edition too young to have produced yet is drawn back, so a
                // dip at the right-hand end is not read as a decline.
                provisional: (edition.days_since_event ?? 0) < 365,
              }));

              return (
                <div key={entry.event_name} className="card p-4">
                  <h3 className="text-sm font-medium">{entry.event_name}</h3>
                  <p className="mb-2 text-xs text-ink-faint">
                    {entry.editions} editions · {formatMoney(entry.cost_total_cents)} all in
                  </p>
                  <SeriesChart points={points} caption="Active-or-better contacts per edition" />
                  <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <Stat
                      label="Per active"
                      value={formatMoney(entry.cost_per_active_or_better_cents)}
                    />
                    <Stat label="Produced" value={String(entry.stage_producing)} />
                    <Stat
                      label="Return"
                      value={entry.return_multiple === null ? '—' : `${entry.return_multiple}×`}
                    />
                  </dl>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
          Other origins
        </h2>
        <p className="mb-2 text-xs text-ink-faint">
          No cost attached, so no ratio to compute. Referral and inbound are how people arrive, not
          rooms you paid to be in.
        </p>
        <ul className="divide-y divide-line-soft">
          {origins.map((source) => (
            <li key={source.source_id} className="flex items-baseline justify-between py-2 text-sm">
              <Link href={`/sources/${source.source_id}`} className="font-medium hover:underline">
                {source.display_name}
              </Link>
              <span className="text-xs text-ink-faint">
                {source.new_contacts} {source.new_contacts === 1 ? 'person' : 'people'}
                {source.stage_producing > 0 ? `, ${source.stage_producing} producing` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function EventRow({ row }: { row: SourceRoiRow | SourceCohortRow }) {
  const counts = {
    card: row.stage_card,
    contact: row.stage_contact,
    active: row.stage_active,
    producing: row.stage_producing,
  };

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link href={`/sources/${row.source_id}`} className="font-medium hover:underline">
          {row.display_name}
        </Link>
        <span className="text-sm text-ink-soft">{row.kind}</span>
        <span className="ml-auto text-sm font-medium">
          {formatMoney(row.cost_per_active_or_better_cents)}
          <span className="ml-1 text-xs font-normal text-ink-faint">per active</span>
        </span>
      </div>

      <div className="mt-1.5 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <StageBar counts={counts} label={row.display_name} />
        </div>
        <span className="shrink-0 font-mono text-xs text-ink-faint">
          {row.active_or_better}/{row.new_contacts}
        </span>
      </div>

      {/* Age and raw counts next to the ratio, always. Without them a young
          event's flattering-or-terrible ratio reads as a verdict. */}
      <p className="mt-1 text-xs text-ink-faint">
        {formatDate(row.occurred_on)}
        {row.days_since_event !== null ? ` · ${row.days_since_event} days ago` : ''}
        {' · '}
        {formatMoney(row.cost_total_cents)}
        {' · '}
        {row.new_contacts} new
        {row.relationships_touched > row.new_contacts
          ? `, ${row.relationships_touched} touched`
          : ''}
        {row.deals_sourced > 0 ? ` · ${row.deals_sourced} deals` : ''}
        {row.return_multiple !== null ? ` · ${row.return_multiple}× return` : ''}
      </p>
    </li>
  );
}

function HorizonLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-md px-2 py-1 text-xs transition-colors ${
        active ? 'bg-accent-soft font-medium text-accent' : 'text-ink-soft hover:text-ink'
      }`}
    >
      {label}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] tracking-wide text-ink-faint uppercase">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
