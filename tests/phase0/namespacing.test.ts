/**
 * MANIFEST owns one schema on a database shared with other systems.
 *
 * Kraken, Plunder, Harpoon and Deepwatch are intended to live alongside this in
 * the same Postgres. Every one of them plausibly wants a table called `people`,
 * `organizations`, `notes`, `sources` or `deals`, and a type called `tier` or
 * `deal_stage`. Postgres types are schema-scoped, so two systems both defining
 * `tier` in `public` is not a merge conflict — it is a hard failure for
 * whichever one migrates second.
 *
 * These tests fail the moment something leaks back into `public`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/db';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

describe('everything lives in the manifest schema', () => {
  it('puts every table there', async () => {
    const stray = await h.sql<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename;`,
    );
    expect(stray.map((r) => r.tablename), 'tables left in public').toEqual([]);

    const owned = await h.sql<{ n: string }>(
      `select count(*) as n from pg_tables where schemaname = 'manifest';`,
    );
    expect(Number(owned[0]!.n)).toBeGreaterThanOrEqual(17);
  });

  it('puts every view there', async () => {
    const stray = await h.sql<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm');
    `);
    expect(stray.map((r) => r.relname), 'views left in public').toEqual([]);
  });

  it('puts every enum there — the collision Postgres cannot resolve', async () => {
    const stray = await h.sql<{ typname: string }>(`
      select t.typname from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' and t.typtype = 'e';
    `);
    expect(stray.map((r) => r.typname), 'enum types left in public').toEqual([]);
  });

  it('puts every function there', async () => {
    // Extension-provided functions (citext, pg_trgm) legitimately live in
    // public; anything MANIFEST defined must not.
    const stray = await h.sql<{ proname: string }>(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      left join pg_depend d
        on d.objid = p.oid
       and d.deptype = 'e'
      where n.nspname = 'public'
        and d.objid is null
      order by p.proname;
    `);
    expect(stray.map((r) => r.proname), 'functions left in public').toEqual([]);
  });

  it('leaves the shared extensions in public, where every system can use them', async () => {
    const rows = await h.sql<{ extname: string; nspname: string }>(`
      select e.extname, n.nspname
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
      where e.extname in ('citext', 'pg_trgm');
    `);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.nspname, `${row.extname} should stay shared`).toBe('public');
    }
  });
});

describe('access control is scoped to this system', () => {
  it('grants schema usage to the client roles but never to anon', async () => {
    const [row] = await h.sql<{ authenticated: boolean; anon: boolean }>(`
      select
        has_schema_privilege('authenticated', 'manifest', 'usage') as authenticated,
        has_schema_privilege('anon', 'manifest', 'usage') as anon;
    `);
    expect(row).toEqual({ authenticated: true, anon: false });
  });

  it('pins the security-definer function to a fixed search_path', async () => {
    // Without this, a caller who can create a schema could shadow app_owners
    // and authorize themselves — the classic definer-function escalation.
    const [row] = await h.sql<{ config: string[] | null }>(
      `select proconfig as config from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'manifest' and p.proname = 'fn_is_owner';`,
    );
    expect(row!.config?.join(',')).toMatch(/search_path=manifest/);
  });

  it('scopes every RLS policy to this schema', async () => {
    const rows = await h.sql<{ schemaname: string }>(`select distinct schemaname from pg_policies;`);
    expect(rows.map((r) => r.schemaname)).toEqual(['manifest']);
  });
});
