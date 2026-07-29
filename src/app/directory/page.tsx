import Link from 'next/link';
import { requireOperator } from '@/lib/auth';
import { formatRelative, tierTextClass } from '@/lib/format';
import { getTaxonomy, searchDirectory } from '@/lib/queries';

export const metadata = { title: 'Directory' };

type Props = {
  searchParams: Promise<{ q?: string; fn?: string | string[]; sp?: string | string[]; city?: string }>;
};

const asArray = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * Capability search. Active people only, strictly — the whole value of a name
 * here is that the operator can vouch for the person.
 *
 * Function and specialty filter independently, which is the point: "an
 * accountant who knows CPG" is two dimensions, and collapsing them into one
 * field makes the question unanswerable.
 */
export default async function DirectoryPage({ searchParams }: Props) {
  await requireOperator();
  const params = await searchParams;

  const functions = asArray(params.fn);
  const specialties = asArray(params.sp);

  const [results, functionOptions, specialtyOptions] = await Promise.all([
    searchDirectory({
      q: params.q,
      functions,
      specialties,
      city: params.city,
    }),
    getTaxonomy('professional_function'),
    getTaxonomy('specialty'),
  ]);

  const hasFilter = Boolean(params.q || functions.length || specialties.length || params.city);

  return (
    <main className="py-6">
      <header className="mb-4">
        <h1 className="text-xl font-semibold tracking-tight">Directory</h1>
        <p className="mt-1 text-sm text-ink-soft">
          People you can vouch for. Filter by what they do and what they know.
        </p>
      </header>

      <form method="get" className="card mb-5 space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="q">
              Name, organization or title
            </label>
            <input id="q" name="q" defaultValue={params.q} className="field" placeholder="Search…" />
          </div>
          <div>
            <label className="label" htmlFor="city">
              City
            </label>
            <input id="city" name="city" defaultValue={params.city} className="field" placeholder="Any" />
          </div>
        </div>

        <FilterChips
          name="fn"
          label="Professional function"
          options={functionOptions}
          selected={functions}
        />
        <FilterChips name="sp" label="Specialty" options={specialtyOptions} selected={specialties} />

        <div className="flex gap-2">
          <button type="submit" className="btn-primary px-3 py-1.5 text-sm">
            Search
          </button>
          {hasFilter ? (
            <Link href="/directory" className="btn px-3 py-1.5 text-sm">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <p className="mb-2 text-sm text-ink-soft">
        {results.length} {results.length === 1 ? 'person' : 'people'}
        {results.length === 200 ? ' (showing the first 200)' : ''}
      </p>

      {results.length === 0 ? (
        <p className="card p-6 text-center text-sm text-ink-faint">
          Nobody matches. Uncontacted people are never in the Directory — check the{' '}
          <Link href="/watchlist" className="text-accent hover:underline">
            watchlist
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {results.map((person) => (
            <li key={person.person_id} className="py-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link href={`/person/${person.person_id}`} className="font-medium hover:underline">
                  {person.full_name}
                </Link>
                <span className="text-sm text-ink-soft">
                  {[person.position, person.organization_name].filter(Boolean).join(' · ')}
                </span>
                <span className={`ml-auto font-mono text-xs ${tierTextClass(person.tier)}`}>
                  {person.tier}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                {person.professional_function.map((fn) => (
                  <span key={fn} className="rounded-full border border-line px-2 py-0.5">
                    {fn}
                  </span>
                ))}
                {person.specialties.map((sp) => (
                  <span key={sp} className="rounded-full border border-accent/40 px-2 py-0.5 text-accent">
                    {sp}
                  </span>
                ))}
                <span className="ml-auto text-ink-faint">
                  {person.city ?? '—'} · last substantive {formatRelative(person.last_substantive_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function FilterChips({
  name,
  label,
  options,
  selected,
}: {
  name: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
}) {
  const chosen = new Set(selected);
  return (
    <fieldset>
      <legend className="label">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-xs
                       has-checked:border-accent has-checked:bg-accent-soft has-checked:font-medium
                       has-checked:text-accent"
          >
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={chosen.has(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
