import 'server-only';

import { getOrganizations, getSources, getSpecialtyOptions, getTaxonomy } from './queries';
import { getCountryOptions } from './geo';
import { supabase } from './auth';
import type { PersonFormLookups } from '@/components/person-form';

/** Alphabetical, with the 'Other' escape valve pinned last rather than filed under O. */
function alphabetical<T extends { label: string }>(options: T[]): T[] {
  return [...options].sort((a, b) => {
    if (a.label === 'Other') return 1;
    if (b.label === 'Other') return -1;
    return a.label.localeCompare(b.label);
  });
}

/** Everything the person form needs to render its comboboxes and pickers. */
export async function getPersonFormLookups(): Promise<PersonFormLookups> {
  const db = await supabase();

  const [organizations, sources, functions, specialties, relationships, watchlistSources, people] =
    await Promise.all([
      getOrganizations(),
      getSources(),
      getTaxonomy('professional_function'),
      getSpecialtyOptions(),
      getTaxonomy('relationship_to_me'),
      getTaxonomy('watchlist_source'),
      db.from('people').select('id, full_name').order('full_name').limit(1000),
    ]);

  return {
    organizations,
    people: people.data ?? [],
    sources: sources.map((s) => ({ id: s.source_id, display_name: s.display_name })),
    countries: getCountryOptions(),
    functions: alphabetical(functions),
    specialties,
    relationships,
    watchlistSources,
  };
}
