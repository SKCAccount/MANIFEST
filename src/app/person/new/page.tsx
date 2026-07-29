import Link from 'next/link';
import { PersonForm } from '@/components/person-form';
import { createActivePerson } from '@/lib/actions/people';
import { requireOperator } from '@/lib/auth';
import { getPersonFormLookups } from '@/lib/lookups';

export const metadata = { title: 'Add a relationship' };

/**
 * Creating an active record. Requires the conversation that established it —
 * the database function refuses anything that would not promote a watchlist
 * entry, so this form cannot produce an "active" person the operator has never
 * actually spoken to.
 */
export default async function NewPersonPage() {
  await requireOperator();
  const lookups = await getPersonFormLookups();

  return (
    <main className="py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Add a relationship</h1>
        <p className="mt-1 text-sm text-ink-soft">
          For someone you have actually spoken to.{' '}
          <Link href="/watchlist/new" className="text-accent hover:underline">
            Adding someone you want to meet?
          </Link>
        </p>
      </header>

      <PersonForm mode="create-active" lookups={lookups} action={createActivePerson} />
    </main>
  );
}
