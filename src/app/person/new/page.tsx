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
/**
 * Prefill from the query string.
 *
 * The review screen links here when a synced address turns out to be somebody
 * new, carrying the address and whatever name the mail client supplied. It is
 * only ever a starting point — the operator still has to say who they are and
 * log the conversation that established the relationship, which is the whole
 * reason sync does not create people itself.
 */
function prefill(params: Record<string, string | string[] | undefined>) {
  const value = (key: string) => {
    const raw = params[key];
    const single = Array.isArray(raw) ? raw[0] : raw;
    return single?.trim() || undefined;
  };

  const name = value('name') ?? '';
  const [first, ...rest] = name.split(/\s+/).filter(Boolean);

  return {
    first_name: value('first') ?? first,
    last_name: value('last') ?? (rest.length > 0 ? rest.join(' ') : undefined),
    email_work: value('email'),
  };
}

export default async function NewPersonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const [lookups, params] = await Promise.all([getPersonFormLookups(), searchParams]);

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

      <PersonForm
        mode="create-active"
        lookups={lookups}
        defaults={prefill(params)}
        action={createActivePerson}
      />
    </main>
  );
}
