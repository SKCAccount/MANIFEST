import { SourceForm } from '@/components/source-form';
import { requireOperator } from '@/lib/auth';
import { getSourceKinds } from '@/lib/queries';

export const metadata = { title: 'Add a source' };

export default async function NewSourcePage() {
  await requireOperator();
  const kinds = await getSourceKinds();

  return (
    <main className="py-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Add a source</h1>
        <p className="mt-1 text-sm text-ink-soft">
          An event, or a non-event origin like a referral or prior work.
        </p>
      </header>
      <SourceForm kinds={kinds} />
    </main>
  );
}
