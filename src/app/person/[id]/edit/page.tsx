import { notFound } from 'next/navigation';
import { PersonForm } from '@/components/person-form';
import { updatePerson } from '@/lib/actions/people';
import { requireOperator, supabase } from '@/lib/auth';
import { getPersonFormLookups } from '@/lib/lookups';

export const metadata = { title: 'Edit' };

type Props = { params: Promise<{ id: string }> };

export default async function EditPersonPage({ params }: Props) {
  await requireOperator();
  const { id } = await params;

  const db = await supabase();
  const { data: person } = await db.from('people').select('*').eq('id', id).maybeSingle();
  if (!person) notFound();

  const lookups = await getPersonFormLookups();
  const isWatchlist = person.contact_status === 'uncontacted';

  return (
    <main className="py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Edit {person.full_name}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {isWatchlist
            ? 'Still on the watchlist. Promotion happens when they reply or you meet — not here.'
            : 'Changing organization or position files the previous one to history automatically.'}
        </p>
      </header>

      <PersonForm
        mode="edit"
        lookups={lookups}
        action={updatePerson}
        defaults={{
          id: person.id,
          first_name: person.first_name,
          last_name: person.last_name,
          preferred_name: person.preferred_name,
          name_pronunciation: person.name_pronunciation,
          position: person.position,
          organization_id: person.organization_id,
          professional_function: person.professional_function,
          specialties: person.specialties,
          relationship_to_me: person.relationship_to_me,
          city: person.city,
          state: person.state,
          country: person.country,
          tier: person.tier,
          met_at_source_id: person.met_at_source_id,
          met_on: person.met_on,
          introduced_by_person_id: person.introduced_by_person_id,
          introduced_by_external: person.introduced_by_external,
          email_work: person.email_work,
          email_personal: person.email_personal,
          phone_mobile: person.phone_mobile,
          phone_office: person.phone_office,
          preferred_phone: person.preferred_phone ?? null,
          linkedin_url: person.linkedin_url,
          other_url: person.other_url,
          do_not_contact: person.do_not_contact,
          summary: person.summary,
          cadence_days_override: person.cadence_days_override,
          watchlist_reason: person.watchlist_reason,
          watchlist_source: person.watchlist_source,
          watchlist_priority: person.watchlist_priority,
        }}
      />
    </main>
  );
}
