import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import { tierTextClass } from '@/lib/format';
import { getRolodex } from '@/lib/queries';
import type { ContactStatus } from '@/lib/db/enums';

export const metadata = { title: 'Rolodex' };

type Props = {
  searchParams: Promise<{ status?: string; q?: string; sort?: string; dir?: string }>;
};

const STATUS_TABS: Array<{ value: ContactStatus | 'all'; label: string; hint: string }> = [
  { value: 'active', label: 'Active', hint: 'People you have spoken to' },
  { value: 'uncontacted', label: 'Watchlist', hint: 'People you intend to meet' },
  { value: 'all', label: 'Everyone', hint: 'Both cohorts' },
];

/**
 * The full table. Defaults to active, with an explicit filter to include or
 * isolate uncontacted records — never silently mixed, because the two cohorts
 * mean different things and a merged count of "contacts" would be a lie.
 */
export default async function RolodexPage({ searchParams }: Props) {
  await requireOperator();
  const params = await searchParams;

  const status = (['active', 'uncontacted', 'all'] as const).includes(params.status as never)
    ? (params.status as ContactStatus | 'all')
    : 'active';

  const rows = await getRolodex({
    status,
    q: params.q,
    sort: params.sort,
    direction: params.dir === 'desc' ? 'desc' : 'asc',
  });

  return (
    <main className="py-6">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-tight">Rolodex</h1>
        <div className="flex gap-2">
          <Link href="/person/new" className="btn-primary px-3 py-2 text-sm">
            Add a relationship
          </Link>
          <Link href="/watchlist/new" className="btn px-3 py-2 text-sm">
            Add to watchlist
          </Link>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/rolodex?status=${tab.value}${params.q ? `&q=${encodeURIComponent(params.q)}` : ''}`}
            title={tab.hint}
            className={`rounded-md px-2.5 py-1.5 text-sm ${
              status === tab.value
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-ink-soft hover:text-ink'
            }`}
          >
            {tab.label}
          </Link>
        ))}

        <form method="get" className="ml-auto flex gap-2">
          <input type="hidden" name="status" value={status} />
          <input
            name="q"
            defaultValue={params.q}
            placeholder="Filter by name, title or city"
            className="field w-56 py-1.5 text-sm"
          />
          <button type="submit" className="btn px-3 py-1.5 text-sm">
            Filter
          </button>
        </form>
      </div>

      <p className="mb-2 text-sm text-ink-soft">
        {rows.length} {rows.length === 1 ? 'record' : 'records'}
        {rows.length === 500 ? ' (showing the first 500)' : ''}
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-3xl text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-ink-soft uppercase">
              <SortableHeader label="Name" column="full_name" params={params} status={status} />
              <th className="py-2 pr-3 font-medium">Position</th>
              <th className="py-2 pr-3 font-medium">Organization</th>
              <th className="py-2 pr-3 font-medium">Function</th>
              <th className="py-2 pr-3 font-medium">Specialties</th>
              <SortableHeader label="City" column="city" params={params} status={status} />
              <SortableHeader label="Tier" column="tier" params={params} status={status} />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {rows.map((row) => {
              const organization = row.organization as unknown as { name: string } | null;
              const isWatchlist = row.contact_status === 'uncontacted';

              return (
                <tr key={row.id} className="align-top">
                  <td className="py-2 pr-3">
                    <Link href={`/person/${row.id}`} className="font-medium hover:underline">
                      {row.full_name}
                    </Link>
                    {isWatchlist ? (
                      <span className="ml-1.5 text-[10px] tracking-wide text-warn uppercase">
                        watchlist
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-ink-soft">{row.position ?? '—'}</td>
                  <td className="py-2 pr-3 text-ink-soft">{organization?.name ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs text-ink-soft">
                    {row.professional_function.join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-3 text-xs text-ink-soft">
                    {row.specialties.join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-3 text-ink-soft">{row.city ?? '—'}</td>
                  <td className="py-2 pr-3">
                    {isWatchlist ? (
                      // Tier is not applicable until promotion, and showing one
                      // would imply a cadence that does not exist.
                      <span className="text-xs text-ink-faint">
                        {row.watchlist_priority ?? '—'}
                      </span>
                    ) : (
                      <span className={`font-mono ${tierTextClass(row.tier)}`}>{row.tier}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="card mt-4 p-6 text-center text-sm text-ink-faint">Nothing matches.</p>
      ) : null}
    </main>
  );
}

function SortableHeader({
  label,
  column,
  params,
  status,
}: {
  label: string;
  column: string;
  params: { sort?: string; dir?: string; q?: string };
  status: string;
}) {
  const isActive = params.sort === column;
  const nextDir = isActive && params.dir !== 'desc' ? 'desc' : 'asc';

  const query = new URLSearchParams({ status, sort: column, dir: nextDir });
  if (params.q) query.set('q', params.q);

  return (
    <th className="py-2 pr-3 font-medium">
      <Link href={`/rolodex?${query}`} className="hover:text-ink">
        {label}
        {isActive ? <span aria-hidden> {params.dir === 'desc' ? '↓' : '↑'}</span> : null}
      </Link>
    </th>
  );
}
