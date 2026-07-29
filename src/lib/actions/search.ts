'use server';

import { requireOperatorForAction, supabase } from '../auth';

/**
 * Global search — Cmd+K.
 *
 * Fuzzy across names, organizations, specialties, note bodies, watchlist
 * reasons and touchpoint summaries. The last three matter most: the operator
 * remembers "the guy who hates cold outreach" or "the one raising a bridge in
 * LA" far more often than he remembers a surname.
 */

export type SearchHit = {
  personId: string;
  fullName: string;
  subtitle: string | null;
  /** Where the match came from, so the row can explain itself. */
  matchedOn: 'name' | 'organization' | 'specialty' | 'note' | 'watchlist_reason' | 'touchpoint';
  excerpt: string | null;
  contactStatus: 'active' | 'uncontacted';
  tier: string | null;
};

const LIMIT_PER_SOURCE = 8;

export async function globalSearch(term: string): Promise<SearchHit[]> {
  await requireOperatorForAction();

  const q = term.trim();
  if (q.length < 2) return [];

  const db = await supabase();
  const like = `%${q}%`;

  const [byName, bySpecialty, byNote, byWatchlist, byTouchpoint, byOrg] = await Promise.all([
    db
      .from('people')
      .select('id, full_name, position, contact_status, tier, organization:organizations(name)')
      .ilike('full_name', like)
      .limit(LIMIT_PER_SOURCE),

    db
      .from('people')
      .select('id, full_name, specialties, contact_status, tier, organization:organizations(name)')
      .overlaps('specialties', [q])
      .limit(LIMIT_PER_SOURCE),

    db
      .from('notes')
      .select('body, person:people!inner(id, full_name, contact_status, tier)')
      .ilike('body', like)
      .limit(LIMIT_PER_SOURCE),

    db
      .from('people')
      .select('id, full_name, watchlist_reason, contact_status, tier')
      .eq('contact_status', 'uncontacted')
      .ilike('watchlist_reason', like)
      .limit(LIMIT_PER_SOURCE),

    db
      .from('touchpoints')
      .select('summary, occurred_at, person:people!inner(id, full_name, contact_status, tier)')
      .ilike('summary', like)
      .order('occurred_at', { ascending: false })
      .limit(LIMIT_PER_SOURCE),

    db
      .from('people')
      .select('id, full_name, contact_status, tier, organization:organizations!inner(name)')
      .ilike('organizations.name', like)
      .limit(LIMIT_PER_SOURCE),
  ]);

  const hits: SearchHit[] = [];
  const seen = new Set<string>();

  /** First source to mention a person wins, so a name match outranks a note match. */
  function push(hit: SearchHit) {
    if (seen.has(hit.personId)) return;
    seen.add(hit.personId);
    hits.push(hit);
  }

  const orgName = (row: { organization?: unknown }) =>
    (row.organization as { name: string } | null)?.name ?? null;

  for (const row of byName.data ?? []) {
    push({
      personId: row.id,
      fullName: row.full_name,
      subtitle: [row.position, orgName(row)].filter(Boolean).join(' · ') || null,
      matchedOn: 'name',
      excerpt: null,
      contactStatus: row.contact_status,
      tier: row.tier,
    });
  }

  for (const row of byOrg.data ?? []) {
    push({
      personId: row.id,
      fullName: row.full_name,
      subtitle: orgName(row),
      matchedOn: 'organization',
      excerpt: null,
      contactStatus: row.contact_status,
      tier: row.tier,
    });
  }

  for (const row of bySpecialty.data ?? []) {
    push({
      personId: row.id,
      fullName: row.full_name,
      subtitle: orgName(row),
      matchedOn: 'specialty',
      excerpt: (row.specialties ?? []).join(', '),
      contactStatus: row.contact_status,
      tier: row.tier,
    });
  }

  for (const row of byWatchlist.data ?? []) {
    push({
      personId: row.id,
      fullName: row.full_name,
      subtitle: 'Watchlist',
      matchedOn: 'watchlist_reason',
      excerpt: excerptAround(row.watchlist_reason, q),
      contactStatus: row.contact_status,
      tier: null,
    });
  }

  for (const row of byNote.data ?? []) {
    const person = row.person as unknown as {
      id: string;
      full_name: string;
      contact_status: 'active' | 'uncontacted';
      tier: string;
    };
    push({
      personId: person.id,
      fullName: person.full_name,
      subtitle: 'Note',
      matchedOn: 'note',
      excerpt: excerptAround(row.body, q),
      contactStatus: person.contact_status,
      tier: person.tier,
    });
  }

  for (const row of byTouchpoint.data ?? []) {
    const person = row.person as unknown as {
      id: string;
      full_name: string;
      contact_status: 'active' | 'uncontacted';
      tier: string;
    };
    push({
      personId: person.id,
      fullName: person.full_name,
      subtitle: 'Conversation',
      matchedOn: 'touchpoint',
      excerpt: excerptAround(row.summary, q),
      contactStatus: person.contact_status,
      tier: person.tier,
    });
  }

  return hits.slice(0, 25);
}

/** A window of text around the match, so the row shows why it matched. */
function excerptAround(body: string | null, term: string, radius = 60): string | null {
  if (!body) return null;

  const index = body.toLowerCase().indexOf(term.toLowerCase());
  if (index === -1) return body.slice(0, radius * 2);

  const start = Math.max(0, index - radius);
  const end = Math.min(body.length, index + term.length + radius);

  return `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`;
}
