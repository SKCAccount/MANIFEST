/**
 * The numbers in the README's status table, asserted.
 *
 * Those counts are the first thing anyone reads and the easiest thing to leave
 * stale — the mailing-list removal already required correcting them once by
 * hand. Asserting them here means the next person to add a table finds out from
 * a failing test rather than from a README that has quietly been wrong for two
 * months.
 *
 * If this fails, the fix is usually the README, not the schema.
 */

import { readdir } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, migrationsDir, type Harness } from '../helpers/db';

let h: Harness;

beforeAll(async () => {
  h = await createHarness({ seed: false });
});

afterAll(async () => {
  await h?.close();
});

async function count(sql: string): Promise<number> {
  const rows = await h.sql<{ n: number }>(sql);
  return Number(rows[0]!.n);
}

describe('the README status table', () => {
  it('says 24 migrations', async () => {
    const files = (await readdir(migrationsDir)).filter((name) => name.endsWith('.sql'));
    expect(files).toHaveLength(24);
  });

  it('says 19 tables, plus app_owners for RLS', async () => {
    const tables = await count(
      `select count(*)::int as n from pg_tables where schemaname = 'manifest';`,
    );
    // 19 domain tables + app_owners.
    expect(tables).toBe(20);
  });

  it('says 21 views', async () => {
    expect(
      await count(`
        select count(*)::int as n from pg_class c
        join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'manifest' and c.relkind = 'v';
      `),
    ).toBe(21);
  });

  it('says 15 enums', async () => {
    expect(
      await count(`
        select count(*)::int as n from pg_type t
        join pg_namespace ns on ns.oid = t.typnamespace
        where ns.nspname = 'manifest' and t.typtype = 'e';
      `),
    ).toBe(15);
  });

  it('says 33 functions — 23 callable, 10 trigger', async () => {
    const all = await count(`
      select count(*)::int as n from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'manifest';
    `);
    const triggers = await count(`
      select count(*)::int as n from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
      where ns.nspname = 'manifest' and p.prorettype = 'trigger'::regtype;
    `);

    expect({ all, triggers, callable: all - triggers }).toEqual({
      all: 33,
      triggers: 10,
      callable: 23,
    });
  });
});
