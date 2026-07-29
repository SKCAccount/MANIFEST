import Link from 'next/link';
import { notFound } from 'next/navigation';
import { BulkEventLog } from '@/components/bulk-event-log';
import { SourceForm } from '@/components/source-form';
import { requireOperator, supabase } from '@/lib/auth';
import { formatDate, formatMoney, tierTextClass } from '@/lib/format';
import { getSourceKinds } from '@/lib/queries';

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

function Cost({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null;
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>{formatMoney(value)}</dd>
    </div>
  );
}
