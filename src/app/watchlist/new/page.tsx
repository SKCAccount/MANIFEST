import Link from 'next/link';
import { PersonForm } from '@/components/person-form';
import { createWatchlistEntry } from '@/lib/actions/people';
import { requireOperator } from '@/lib/auth';
import { getPersonFormLookups } from '@/lib/lookups';

export const metadata = { title: 'Add to watchlist' };

/**
 * A distinct entry path from person creation, deliberately: one person at a
 * time, no multi-add, no paste-a-list, and a written reason that cannot be
 * skipped.
 *
 * The tedium is the feature. It is what keeps this a curated list of people
 * worth meeting rather than a lead database.
 */
export default async function NewWatchlistEntryPage() {
  await requireOperator();
  const lookups = await getPersonFormLookups();

  return (
    <main className="py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Add to watchlist</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Someone you intend to meet but have not been in contact with.{' '}
          <Link href="/person/new" className="text-accent hover:underline">
            Already spoken to them?
          </Link>
        </p>
      </header>

      <PersonForm mode="create-watchlist" lookups={lookups} action={createWatchlistEntry} />
    </main>
  );
}
