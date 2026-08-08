import 'server-only';

import { getOrganizations, getSources, getTaxonomy } from './queries';
import { getCountryOptions } from './geo';
import { supabase } from './auth';
import type { PersonFormLookups } from '@/components/person-form';

/** Everything the person form needs to render its comboboxes and pickers. */
export async function getPersonFormLookups(): Promise<PersonFormLookups> {
  const db = await supabase();

  const [organizations, sources, functions, specialties, relationships, watchlistSources, people] =
    await Promise.all([
      getOrganizations(),
      getSources(),
      getTaxonomy('professional_function'),
      getTaxonomy('specialty'),
      getTaxonomy('relationship_to_me'),
      getTaxonomy('watchlist_source'),
      db.from('people').select('id, full_name').order('full_name').limit(1000),
    ]);

  return {
    organizations,
    people: people.data ?? [],
    sources: sources.map((s) => ({ id: s.source_id, display_name: s.display_name })),
    countries: getCountryOptions(),
    functions,
    specialties,
    relationships,
    watchlistSources,
  };
}
