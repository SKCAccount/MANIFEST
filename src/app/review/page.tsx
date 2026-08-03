import Link from 'next/link';
import { ReviewItem, type PickerPerson } from '@/components/review-item';
import { requireOperator, supabase } from '@/lib/auth';
import { getReviewQueue } from '@/lib/queries';

export const metadata = { title: 'Review' };

/**
 * What sync could not resolve.
 *
 * This screen is the reason sync is allowed to be conservative. Every rule in
 * the pipeline that refuses to guess — an address matching nobody, an attendee
 * who never RSVP'd, a name that trigram-matches at 0.7 — sends its uncertainty
 * here instead of resolving it. That is only a good trade if the queue is
 * actually workable, so the view attaches the two lookups that make each item
 * decidable at a glance: the person the display name probably belongs to, and
 * the organization the domain belongs to.
 *
 * The queue is meant to reach zero. If it does not, the filters upstream are
 * too loose, not this screen — the fix belongs in classify.ts.
 */
export default async function ReviewPage() {
  await requireOperator();

  const db = await supabase();
  const [items, people] = await Promise.all([
    getReviewQueue(),
    db
      .from('people')
      .select('id, full_name, contact_status, organization:organizations(name)')
      .is('archived_at', null)
      .order('full_name')
      .limit(1000),
  ]);

  const picker: PickerPerson[] = (people.data ?? []).map((person) => ({
    id: person.id,
    full_name: person.full_name,
    organizationName:
      (person.organization as { name: string } | null | undefined)?.name ?? null,
    contactStatus: person.contact_status,
  }));

  return (
    <main className="py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Review</h1>
          <p className="mt-1 text-sm text-ink-soft">
            {items.length === 0
              ? 'Nothing waiting.'
              : `${items.length} ${items.length === 1 ? 'address' : 'addresses'} sync could not place.`}
          </p>
        </div>
        <Link href="/sync" className="btn px-3 py-2 text-sm">
          Sync status
        </Link>
      </header>

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="font-medium">Nothing to review.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Sync writes touchpoints for people it recognises and parks everyone else here. An empty
            queue means it recognised everyone it saw.
          </p>
        </div>
      ) : (
        <>
          <p className="mb-3 text-xs text-ink-faint">
            Sync never creates a person. Attaching an address also pulls in the earlier
            correspondence that put it here.
          </p>
          <ul className="space-y-3">
            {items.map((item) => (
              <ReviewItem key={item.id} item={item} people={picker} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
