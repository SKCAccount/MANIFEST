/**
 * Reads. Called from server components, never from the client.
 *
 * Every one of these goes through a view whose contact_status filter is written
 * into the view definition, so a caller cannot forget it. Where a query touches
 * `people` directly it says which cohort it wants explicitly.
 */

import { supabase } from './auth';
import type {
  DataQualityRow,
  DirectoryRow,
  GeographyRow,
  NeverFollowedUpRow,
  PathToRow,
  QueueRow,
  SourceRoiRow,
  WatchlistRow,
} from './db/database.types';
import type { ContactStatus, Tier } from './db/enums';

/** The home screen shows fifteen. The view is uncapped so other surfaces can read the tail. */
export async function getQueue(limit = 15): Promise<QueueRow[]> {
  const db = await supabase();
  const { data, error } = await db.from('v_queue').select('*').lte('queue_rank', limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as QueueRow[];
}

export async function getQueueDepth(): Promise<number> {
  const db = await supabase();
  const { count, error } = await db.from('v_queue').select('person_id', { count: 'exact', head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getNeverFollowedUp(limit = 10): Promise<NeverFollowedUpRow[]> {
  const db = await supabase();
  const { data, error } = await db
    .from('v_never_followed_up')
    .select('*')
    .order('days_since', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as NeverFollowedUpRow[];
}

// ---------------------------------------------------------------------------
// Directory — capability search, active only
// ---------------------------------------------------------------------------

export type DirectoryFilters = {
  q?: string;
  functions?: string[];
  specialties?: string[];
  relationships?: string[];
  city?: string;
  tier?: string;
};

/**
 * The two-dimensional query that makes this system worth having:
 * professional_function contains "Accountant" AND specialties contains "CPG",
 * ignoring relationship entirely.
 */
export async function searchDirectory(filters: DirectoryFilters): Promise<DirectoryRow[]> {
  const db = await supabase();
  let query = db.from('v_directory').select('*');

  if (filters.functions?.length) query = query.contains('professional_function', filters.functions);
  if (filters.specialties?.length) query = query.contains('specialties', filters.specialties);
  if (filters.relationships?.length) query = query.contains('relationship_to_me', filters.relationships);
  if (filters.city) query = query.ilike('city', filters.city);
  if (filters.tier) query = query.eq('tier', filters.tier as Tier);
  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`full_name.ilike.${term},organization_name.ilike.${term},position.ilike.${term}`);
  }

  const { data, error } = await query
    .order('tier', { ascending: true })
    .order('last_substantive_at', { ascending: false, nullsFirst: false })
    .limit(200);

  if (error) throw new Error(error.message);
  return (data ?? []) as DirectoryRow[];
}

// ---------------------------------------------------------------------------
// Watchlist — uncontacted only, grouped by city
// ---------------------------------------------------------------------------

/**
 * Default grouping is by city, not by date. Geography is the usual trigger for
 * working this list, and days waiting carries no information about a watchlist
 * entry — so it is displayed but never sorted on.
 */
export async function getWatchlist(): Promise<Map<string, WatchlistRow[]>> {
  const db = await supabase();
  const { data, error } = await db.from('v_watchlist').select('*');
  if (error) throw new Error(error.message);

  const priorityRank = { high: 0, medium: 1, low: 2 } as const;
  const rows = (data ?? []) as WatchlistRow[];

  const byCity = new Map<string, WatchlistRow[]>();
  for (const row of rows) {
    const city = row.city?.trim() || 'No city recorded';
    const bucket = byCity.get(city);
    if (bucket) bucket.push(row);
    else byCity.set(city, [row]);
  }

  for (const bucket of byCity.values()) {
    bucket.sort((a, b) => {
      const byPriority =
        (priorityRank[a.watchlist_priority ?? 'low'] ?? 3) -
        (priorityRank[b.watchlist_priority ?? 'low'] ?? 3);
      if (byPriority !== 0) return byPriority;
      // Then by whether a warm path exists — a name with a route in is
      // actionable and a name without one is a research task.
      if (a.warm_path_count !== b.warm_path_count) return b.warm_path_count - a.warm_path_count;
      return a.full_name.localeCompare(b.full_name);
    });
  }

  return new Map([...byCity.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// ---------------------------------------------------------------------------
// Geography — both cohorts, labelled
// ---------------------------------------------------------------------------

export async function getGeography(city?: string): Promise<{
  active: GeographyRow[];
  watchlist: GeographyRow[];
}> {
  const db = await supabase();
  let query = db.from('v_geography').select('*');
  if (city) query = query.ilike('city', city);

  const { data, error } = await query.limit(500);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as GeographyRow[];
  return {
    active: rows
      .filter((r) => r.cohort === 'active')
      .sort((a, b) => (b.days_overdue ?? -9999) - (a.days_overdue ?? -9999)),
    watchlist: rows
      .filter((r) => r.cohort === 'watchlist')
      .sort((a, b) => b.warm_path_count - a.warm_path_count),
  };
}

/** Cities with anyone in them, for the trip planner's suggestions. */
export async function getCities(): Promise<Array<{ city: string; active: number; watchlist: number }>> {
  const db = await supabase();
  const { data, error } = await db.from('v_geography').select('city, cohort').not('city', 'is', null);
  if (error) throw new Error(error.message);

  const counts = new Map<string, { city: string; active: number; watchlist: number }>();
  for (const row of (data ?? []) as Array<{ city: string; cohort: string }>) {
    const entry = counts.get(row.city) ?? { city: row.city, active: 0, watchlist: 0 };
    if (row.cohort === 'active') entry.active += 1;
    else entry.watchlist += 1;
    counts.set(row.city, entry);
  }

  return [...counts.values()].sort((a, b) => b.active + b.watchlist - (a.active + a.watchlist));
}

// ---------------------------------------------------------------------------
// Person detail
// ---------------------------------------------------------------------------

export async function getPersonDetail(personId: string) {
  const db = await supabase();

  const [person, recency, value, reciprocity, stage] = await Promise.all([
    db
      .from('people')
      .select('*, organization:organizations(id, name, industry_category, organization_type)')
      .eq('id', personId)
      .maybeSingle(),
    db.from('v_person_recency').select('*').eq('person_id', personId).maybeSingle(),
    db.from('v_relationship_value').select('*').eq('person_id', personId).maybeSingle(),
    db.from('v_reciprocity').select('*').eq('person_id', personId).maybeSingle(),
    db.rpc('fn_person_stage', { p_person_id: personId }),
  ]);

  if (person.error) throw new Error(person.error.message);
  if (!person.data) return null;

  const [
    touchpoints,
    notes,
    followups,
    favors,
    content,
    deals,
    introductionsMade,
    referrer,
    tierHistory,
    affiliations,
    paths,
  ] = await Promise.all([
    db
      .from('touchpoints')
      .select('*, source:sources(display_name)')
      .eq('person_id', personId)
      .order('occurred_at', { ascending: false })
      .limit(200),
    db.from('notes').select('*').eq('person_id', personId).order('is_pinned', { ascending: false }).order('created_at', { ascending: false }),
    db.from('followups').select('*').eq('person_id', personId).order('due_on', { ascending: true }),
    db.from('favors').select('*').eq('person_id', personId).order('occurred_on', { ascending: false }),
    db.from('content_touches').select('*').eq('person_id', personId).order('sent_on', { ascending: false }),
    db.from('deals').select('*').eq('source_person_id', personId).order('referred_on', { ascending: false }),
    // Everyone this person has introduced the operator to. Frequently the
    // difference between an A and a C.
    db
      .from('introductions')
      .select('id, occurred_on, note, party_a:people!introductions_party_a_person_id_fkey(id, full_name, tier)')
      .eq('perspective', 'received_by_me')
      .eq('introducer_person_id', personId)
      .order('occurred_on', { ascending: false }),
    person.data.introduced_by_person_id
      ? db.from('people').select('id, full_name, tier').eq('id', person.data.introduced_by_person_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('tier_history').select('*').eq('person_id', personId).order('changed_at', { ascending: true }),
    db.from('affiliation_history').select('*').eq('person_id', personId).order('created_at', { ascending: false }),
    // Warm paths matter most for an uncontacted target, but are useful for a
    // cold active relationship too.
    db.rpc('fn_path_to', { p_target_person_id: personId }),
  ]);

  return {
    person: person.data,
    recency: recency.data,
    value: value.data,
    reciprocity: reciprocity.data,
    stage: stage.data as string | null,
    touchpoints: touchpoints.data ?? [],
    notes: notes.data ?? [],
    followups: followups.data ?? [],
    favors: favors.data ?? [],
    content: content.data ?? [],
    deals: deals.data ?? [],
    introductionsMade: introductionsMade.data ?? [],
    referrer: referrer.data,
    tierHistory: tierHistory.data ?? [],
    affiliations: affiliations.data ?? [],
    paths: (paths.data ?? []) as PathToRow[],
  };
}

export type PersonDetail = NonNullable<Awaited<ReturnType<typeof getPersonDetail>>>;

// ---------------------------------------------------------------------------
// Rolodex
// ---------------------------------------------------------------------------

export type RolodexFilters = {
  status?: ContactStatus | 'all';
  q?: string;
  sort?: string;
  direction?: 'asc' | 'desc';
};

/** Defaults to active, with an explicit filter to include or isolate uncontacted records. */
export async function getRolodex(filters: RolodexFilters) {
  const db = await supabase();
  let query = db
    .from('people')
    .select('id, full_name, position, contact_status, tier, city, state, professional_function, specialties, relationship_to_me, watchlist_priority, organization:organizations(id, name)');

  if (filters.status !== 'all') {
    query = query.eq('contact_status', filters.status ?? 'active');
  }

  if (filters.q) {
    const term = `%${filters.q}%`;
    query = query.or(`full_name.ilike.${term},position.ilike.${term},city.ilike.${term}`);
  }

  const sortColumn = ['full_name', 'tier', 'city', 'contact_status'].includes(filters.sort ?? '')
    ? (filters.sort as string)
    : 'full_name';

  const { data, error } = await query
    .order(sortColumn, { ascending: filters.direction !== 'desc' })
    .limit(500);

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Lookups for form comboboxes
// ---------------------------------------------------------------------------

export async function getTaxonomy(domain: string): Promise<Array<{ value: string; label: string }>> {
  const db = await supabase();
  const { data, error } = await db
    .from('taxonomies')
    .select('value, label, meta')
    .eq('domain', domain)
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ value: r.value, label: r.label }));
}

export async function getSourceKinds(): Promise<Array<{ value: string; label: string; isEvent: boolean }>> {
  const db = await supabase();
  const { data, error } = await db
    .from('taxonomies')
    .select('value, label, meta')
    .eq('domain', 'source_kind')
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    value: r.value,
    label: r.label,
    isEvent: (r.meta as { family?: string } | null)?.family === 'event',
  }));
}

export async function getOrganizations(): Promise<Array<{ id: string; name: string }>> {
  const db = await supabase();
  const { data, error } = await db.from('organizations').select('id, name').order('name').limit(1000);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getSources(): Promise<SourceRoiRow[]> {
  const db = await supabase();
  const { data, error } = await db
    .from('v_source_roi')
    .select('*')
    .order('occurred_on', { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SourceRoiRow[];
}

export async function getSourceById(id: string) {
  const db = await supabase();
  const { data, error } = await db.from('sources').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Name lookup for the referred-by combobox and bulk event attendee picker. */
export async function findPeople(term: string, limit = 20) {
  const db = await supabase();
  if (!term.trim()) return [];

  const { data, error } = await db
    .from('people')
    .select('id, full_name, position, contact_status, tier, organization:organizations(name)')
    .ilike('full_name', `%${term.trim()}%`)
    .order('full_name')
    .limit(limit);

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getDataQuality(): Promise<DataQualityRow[]> {
  const db = await supabase();
  const { data, error } = await db.from('v_data_quality').select('*').limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as DataQualityRow[];
}
