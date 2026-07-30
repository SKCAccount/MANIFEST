/**
 * Keeps the hand-maintained database.types.ts honest.
 *
 * Until `supabase gen types` can run against a provisioned instance, the type
 * file is written by hand. That is only safe if something proves it has not
 * drifted from the schema — so this introspects the real database and asserts
 * every table, view, enum and enum member is represented.
 *
 * A string check rather than a type check on purpose: it catches the failure
 * that actually happens, which is adding a table and forgetting the types.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, repoRoot, type Harness } from '../helpers/db.js';

let h: Harness;
let typesSource: string;
let enumsSource: string;

beforeAll(async () => {
  h = await createHarness({ seed: false });
  typesSource = await readFile(join(repoRoot, 'src', 'lib', 'db', 'database.types.ts'), 'utf8');
  enumsSource = await readFile(join(repoRoot, 'src', 'lib', 'db', 'enums.ts'), 'utf8');
});

afterAll(async () => {
  await h?.close();
});

describe('database.types.ts tracks the schema', () => {
  it('names every table', async () => {
    const rows = await h.sql<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'manifest';`,
    );
    const missing = rows.map((r) => r.tablename).filter((t) => !typesSource.includes(`${t}:`));
    expect(missing, 'tables present in the schema but absent from database.types.ts').toEqual([]);
  });

  it('names every view', async () => {
    const rows = await h.sql<{ relname: string }>(`
      select c.relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'manifest' and c.relkind = 'v';
    `);
    const missing = rows.map((r) => r.relname).filter((v) => !typesSource.includes(`${v}:`));
    expect(missing, 'views present in the schema but absent from database.types.ts').toEqual([]);
  });

  it('names every enum type', async () => {
    const rows = await h.sql<{ typname: string }>(`
      select t.typname from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'manifest' and t.typtype = 'e';
    `);
    const missing = rows.map((r) => r.typname).filter((t) => !typesSource.includes(`${t}:`));
    expect(missing, 'enum types absent from database.types.ts').toEqual([]);
  });

  it('lists every enum member in enums.ts', async () => {
    const rows = await h.sql<{ typname: string; label: string }>(`
      select t.typname, e.enumlabel as label
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'manifest';
    `);

    const missing = rows
      .filter(({ label }) => !enumsSource.includes(`'${label}'`))
      .map((r) => `${r.typname}.${r.label}`);

    expect(missing, 'enum values missing from enums.ts').toEqual([]);
  });

  it('keeps the tier cadence defaults in step with fn_tier_cadence_days', async () => {
    const rows = await h.sql<{ tier: string; days: number | null }>(`
      select unnest(enum_range(null::tier))::text as tier,
             fn_tier_cadence_days(unnest(enum_range(null::tier))) as days;
    `);

    // enums.ts declares A 45, B 90, C 180, D null.
    expect(rows).toEqual([
      { tier: 'A', days: 45 },
      { tier: 'B', days: 90 },
      { tier: 'C', days: 180 },
      { tier: 'D', days: null },
    ]);
  });

  it('keeps the tier weights in step with fn_tier_weight', async () => {
    const rows = await h.sql<{ tier: string; weight: string }>(`
      select unnest(enum_range(null::tier))::text as tier,
             fn_tier_weight(unnest(enum_range(null::tier))) as weight;
    `);

    expect(rows.map((r) => [r.tier, Number(r.weight)])).toEqual([
      ['A', 3.0],
      ['B', 1.6],
      ['C', 1.0],
      ['D', 0],
    ]);
  });
});
