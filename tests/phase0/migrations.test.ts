/**
 * Phase 0 acceptance: migrations run clean from empty, and every view returns.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, listViews, loadMigrations, type Harness } from '../helpers/db.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

describe('migrations', () => {
  it('apply cleanly from an empty database', async () => {
    // createHarness throws with the offending filename if any migration fails,
    // so reaching beforeAll at all is the assertion. This confirms the set is
    // non-trivial and ordered.
    const migrations = await loadMigrations();
    expect(migrations.length).toBeGreaterThanOrEqual(18);
    expect(migrations.map((m) => m.name.slice(0, 4))).toEqual(
      [...migrations].map((m) => m.name.slice(0, 4)).sort(),
    );
  });

  it('create the eighteen tables the model calls for', async () => {
    const rows = await h.sql<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'manifest' order by tablename;`,
    );
    const names = rows.map((r) => r.tablename);

    for (const expected of [
      'people',
      'organizations',
      'sources',
      'touchpoints',
      'notes',
      'followups',
      'tier_history',
      'affiliation_history',
      'introductions',
      'favors',
      'deals',
      'content_touches',
      'subscriptions',
      'suppressions',
      'staging_records',
      'merge_log',
      'sync_state',
      'taxonomies',
    ]) {
      expect(names, `missing table ${expected}`).toContain(expected);
    }
  });

  it('every view returns without error', async () => {
    const views = await listViews(h.db);
    expect(views.length).toBeGreaterThanOrEqual(18);

    for (const view of views) {
      await expect(
        h.sql(`select * from ${view} limit 5;`),
        `view ${view} failed to return`,
      ).resolves.toBeDefined();
    }
  });

  it('enables row level security on every table', async () => {
    const rows = await h.sql<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'manifest' and c.relkind = 'r';
    `);

    const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
    expect(unprotected).toEqual([]);
  });

  it('gives every table an owner-scoped select policy', async () => {
    const rows = await h.sql<{ tablename: string; n: number }>(`
      select tablename, count(*)::int as n
      from pg_policies where schemaname = 'manifest'
      group by tablename;
    `);
    const withPolicies = new Set(rows.map((r) => r.tablename));

    const tables = await h.sql<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'manifest';`,
    );
    for (const { tablename } of tables) {
      expect(withPolicies.has(tablename), `${tablename} has no RLS policy`).toBe(true);
    }
  });

  it('runs views with the caller’s permissions rather than the owner’s', async () => {
    // Without security_invoker a view silently bypasses RLS on its base tables.
    const rows = await h.sql<{ relname: string; reloptions: string[] | null }>(`
      select c.relname, c.reloptions
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'manifest' and c.relkind = 'v';
    `);

    const leaky = rows
      .filter((r) => !(r.reloptions ?? []).some((o) => o.replace(/\s/g, '') === 'security_invoker=on'))
      .map((r) => r.relname);

    expect(leaky).toEqual([]);
  });
});

describe('taxonomies', () => {
  it('seed every domain the write triggers validate against', async () => {
    const rows = await h.sql<{ domain: string; n: number }>(
      `select domain, count(*)::int as n from taxonomies group by domain;`,
    );
    const byDomain = Object.fromEntries(rows.map((r) => [r.domain, r.n]));

    for (const domain of [
      'professional_function',
      'specialty',
      'relationship_to_me',
      'organization_type',
      'industry_category',
      'source_kind',
      'watchlist_source',
    ]) {
      expect(byDomain[domain], `${domain} has no seeded values`).toBeGreaterThan(0);
    }
  });

  it('mark exactly the event-family source kinds', async () => {
    const rows = await h.sql<{ value: string }>(
      `select value from taxonomies where domain = 'source_kind' and meta->>'family' = 'event' order by value;`,
    );
    expect(rows.map((r) => r.value)).toEqual([
      'Conference',
      'Dinner',
      'Expo',
      'Meetup',
      'Pitch Event',
      'Trade Show',
      'Webinar',
    ]);
  });

  it('reject a value outside the taxonomy', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, first_contact_at, specialties)
         values ('Test', 'Person', 'active', now(), '{Astrology}');`,
      ),
    ).rejects.toThrow(/not a known specialty/i);
  });
});
