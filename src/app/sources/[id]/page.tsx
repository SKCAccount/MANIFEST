import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BulkEventLog } from '@/components/bulk-event-log';
import { SourceForm } from '@/components/source-form';
import { StageBar, StageLegend } from '@/components/stage-bar';
import { requireOperator, supabase } from '@/lib/auth';
import type { SourceMetricsRow } from '@/lib/db/database.types';
import { HORIZONS } from '@/lib/db/enums';
import { formatDate, formatMoney, tierTextClass } from '@/lib/format';
import { getSourceKinds, getSourceMetrics } from '@/lib/queries';

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const db = await supabase();
  const { data } = await db.from('sources').select('display_name').eq('id', id).maybeSingle();
  return { title: data?.display_name ?? 'Source' };
}

export default async function SourcePage({ params }: Props) {
  await requireOperator();
  const { id } = await params;

  const db = await supabase();

  const [{ data: source }, { data: attributed }, { data: everyone }, kinds] = await Promise.all([
    db.from('sources').select('*').eq('id', id).maybeSingle(),
    db
      .from('people')
      .select('id, full_name, position, tier, contact_status, organization:organizations(name)')
      .eq('met_at_source_id', id)
      .order('full_name'),
    db
      .from('people')
      .select('id, full_name, contact_status, met_at_source_id, organization:organizations(name)')
      .order('full_name')
      .limit(1000),
    getSourceKinds(),
  ]);

  if (!source) notFound();

  const isEvent = kinds.find((k) => k.value === source.kind)?.isEvent ?? false;

  // Present, plus each horizon this event has actually reached. An age it has
  // not reached is omitted rather than shown empty: a column of dashes invites
  // the reading that the event produced nothing by then, when the truth is that
  // "by then" has not happened.
  const present = isEvent ? await getSourceMetrics(id, null) : null;
  const matured = isEvent
    ? (await Promise.all(HORIZONS.map((days) => getSourceMetrics(id, days)))).filter(
        (row): row is SourceMetricsRow => row !== null && row.is_mature,
      )
    : [];

  const attendees = (everyone ?? []).map((person) => ({
    id: person.id,
    full_name: person.full_name,
    organizationName: (person.organization as unknown as { name: string } | null)?.name ?? null,
    contactStatus: person.contact_status,
    hasMetAt: person.met_at_source_id !== null,
  }));

  return (
    <main className="py-6">
      <header className="mb-6">
        <p className="text-xs text-ink-faint">
          <Link href="/sources" className="hover:underline">
            Sources
          </Link>
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{source.display_name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {[source.kind, [source.city, source.state].filter(Boolean).join(', ')]
            .filter(Boolean)
            .join(' · ')}
          {source.occurred_on ? ` · ${formatDate(source.occurred_on)}` : ''}
        </p>

        {isEvent ? (
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Cost label="Pass" value={source.cost_pass_cents} />
            <Cost label="Travel" value={source.cost_travel_cents} />
            <Cost label="Lodging" value={source.cost_lodging_cents} />
            <Cost label="Meals" value={source.cost_meals_cents} />
            <Cost label="Other" value={source.cost_other_cents} />
            <div>
              <dt className="label">Total</dt>
              <dd className="font-medium">{formatMoney(source.cost_total_cents)}</dd>
            </div>
          </dl>
        ) : null}
      </header>

      {isEvent && present ? (
        <section className="mb-8">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-ink-soft uppercase">
              What it produced
            </h2>
            <StageLegend />
          </div>

          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <StageBar
                  counts={{
                    card: present.stage_card,
                    contact: present.stage_contact,
                    active: present.stage_active,
                    producing: present.stage_producing,
                  }}
                  label={source.display_name}
                />
              </div>
              <span className="shrink-0 font-mono text-xs text-ink-faint">
                {present.active_or_better}/{present.new_contacts}
              </span>
            </div>

            {/* The ladder as it stood at each age this event has reached.
                Reading left to right is how the room actually developed —
                which is the question a retro is trying to answer, and one that
                a single present-day number cannot express. */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[26rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th scope="col" className="py-1.5 pr-3 text-xs font-medium text-ink-faint">
                      Measured at
                    </th>
                    {matured.map((row) => (
                      <th
                        key={row.horizon_days}
                        scope="col"
                        className="py-1.5 pr-3 text-right text-xs font-medium text-ink-faint"
                      >
                        {row.horizon_days! >= 365 ? `${row.horizon_days! / 365} yr` : `${row.horizon_days} d`}
                      </th>
                    ))}
                    <th scope="col" className="py-1.5 text-right text-xs font-medium">
                      Today
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <MetricRow
                    label="New contacts"
                    columns={matured}
                    present={present}
                    read={(row) => String(row.new_contacts)}
                  />
                  <MetricRow
                    label="Active or better"
                    columns={matured}
                    present={present}
                    read={(row) => String(row.active_or_better)}
                  />
                  <MetricRow
                    label="Producing"
                    columns={matured}
                    present={present}
                    read={(row) => String(row.stage_producing)}
                  />
                  <MetricRow
                    label="Tier A/B"
                    columns={matured}
                    present={present}
                    read={(row) => String(row.tier_ab_contacts)}
                  />
                  <MetricRow
                    label="Cost per contact"
                    columns={matured}
                    present={present}
                    read={(row) => formatMoney(row.cost_per_new_contact_cents)}
                  />
                  <MetricRow
                    label="Cost per active"
                    columns={matured}
                    present={present}
                    emphasis
                    read={(row) => formatMoney(row.cost_per_active_or_better_cents)}
                  />
                  <MetricRow
                    label="Deals funded"
                    columns={matured}
                    present={present}
                    read={(row) =>
                      row.deals_sourced === 0
                        ? '—'
                        : `${row.deals_funded}/${row.deals_sourced}`
                    }
                  />
                  <MetricRow
                    label="Return"
                    columns={matured}
                    present={present}
                    read={(row) => (row.return_multiple === null ? '—' : `${row.return_multiple}×`)}
                  />
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-ink-faint">
              Cost per active is what the Sources ranking sorts on. Cost per contact is shown
              because it is the number most people reach for, and it is flattered by collecting
              business cards — an event where nobody stayed in touch would win on it.
              {present.relationships_touched > present.new_contacts
                ? ` ${present.relationships_touched} existing relationships were also seen here; they are counted separately and never fold into these ratios.`
                : ''}
            </p>
          </div>

          {source.retro_note ? (
            <div className="card mt-3 p-4">
              <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
                Retro
              </h3>
              <p className="mt-1 text-sm">{source.retro_note}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      {isEvent ? (
        <section className="mb-8">
          <BulkEventLog sourceId={source.id} sourceName={source.display_name} people={attendees} />
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-ink-soft uppercase">
          Attributed to this source
        </h2>
        {(attributed ?? []).length === 0 ? (
          <p className="card p-4 text-sm text-ink-faint">Nobody yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {(attributed ?? []).map((person) => (
              <li key={person.id} className="flex flex-wrap items-baseline gap-x-2 py-2 text-sm">
                <Link href={`/person/${person.id}`} className="font-medium hover:underline">
                  {person.full_name}
                </Link>
                <span className="text-ink-soft">
                  {[
                    person.position,
                    (person.organization as unknown as { name: string } | null)?.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className={`ml-auto font-mono text-xs ${tierTextClass(person.tier)}`}>
                  {person.tier}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-soft uppercase">Edit</h2>
        <SourceForm
          kinds={kinds}
          defaults={{
            id: source.id,
            event_name: source.event_name,
            event_year: source.event_year,
            kind: source.kind,
            occurred_on: source.occurred_on,
            ends_on: source.ends_on,
            city: source.city,
            state: source.state,
            url: source.url,
            cost_pass_cents: source.cost_pass_cents,
            cost_travel_cents: source.cost_travel_cents,
            cost_lodging_cents: source.cost_lodging_cents,
            cost_meals_cents: source.cost_meals_cents,
            cost_other_cents: source.cost_other_cents,
            cost_note: source.cost_note,
            retro_note: source.retro_note,
          }}
        />
      </section>
    </main>
  );
}

function MetricRow({
  label,
  columns,
  present,
  read,
  emphasis = false,
}: {
  label: string;
  columns: SourceMetricsRow[];
  present: SourceMetricsRow;
  read: (row: SourceMetricsRow) => string;
  emphasis?: boolean;
}) {
  return (
    <tr className="border-b border-line-soft last:border-0">
      <th scope="row" className={`py-1.5 pr-3 text-left font-normal ${emphasis ? 'font-medium' : ''}`}>
        {label}
      </th>
      {columns.map((row) => (
        <td
          key={row.horizon_days}
          className="py-1.5 pr-3 text-right font-mono text-xs text-ink-soft tabular-nums"
        >
          {read(row)}
        </td>
      ))}
      <td
        className={`py-1.5 text-right font-mono text-xs tabular-nums ${
          emphasis ? 'font-medium text-ink' : 'text-ink'
        }`}
      >
        {read(present)}
      </td>
    </tr>
  );
}

function Cost({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>{formatMoney(value)}</dd>
    </div>
  );
}
