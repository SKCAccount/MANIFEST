/**
 * Test harness: a real Postgres, in-process.
 *
 * PGlite is Postgres 18 compiled to WASM. It runs the migrations exactly as
 * written — same planner, same constraint machinery, same plpgsql — with no
 * Docker daemon required. That matters because the Phase 0 acceptance criteria
 * are almost entirely database-level assertions: a constraint that only *looks*
 * correct is worth nothing.
 *
 * Two known gaps versus hosted Supabase, both handled in prelude.sql:
 *   - the `auth` schema and `auth.uid()` are created by the harness
 *   - the anon / authenticated / service_role roles are created by the harness
 */

import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..');
export const migrationsDir = join(repoRoot, 'supabase', 'migrations');

export type MigrationFile = { name: string; sql: string };

/** Migration files in lexical order, which is numeric order given the 4-digit prefix. */
export async function loadMigrations(): Promise<MigrationFile[]> {
  const names = (await readdir(migrationsDir)).filter((n) => n.endsWith('.sql')).sort();

  const seen = new Set<string>();
  for (const name of names) {
    const prefix = name.slice(0, 4);
    if (!/^\d{4}$/.test(prefix)) {
      throw new Error(`Migration ${name} does not start with a 4-digit ordinal.`);
    }
    if (seen.has(prefix)) {
      throw new Error(`Duplicate migration ordinal ${prefix} (${name}).`);
    }
    seen.add(prefix);
  }

  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(join(migrationsDir, name), 'utf8') })),
  );
}

export type Harness = {
  db: PGlite;
  /** Run SQL as the operator (the `authenticated` role, with RLS enforced). */
  asOperator<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run SQL with full privileges, as a server action using the service key would. */
  sql<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  /** The seeded owner's auth user id. */
  ownerId: string;
  close(): Promise<void>;
};

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Boots an empty Postgres, applies the prelude, then every migration in order.
 * Any migration error fails loudly with the file name attached — "migrations run
 * clean from empty" is a Phase 0 acceptance criterion, not a nice-to-have.
 */
export async function createHarness(options: { seed?: boolean } = {}): Promise<Harness> {
  const db = await new PGlite({ extensions: { citext, pg_trgm } });

  const prelude = await readFile(join(here, 'prelude.sql'), 'utf8');
  await db.exec(prelude);

  for (const migration of await loadMigrations()) {
    try {
      await db.exec(migration.sql);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migration ${migration.name} failed: ${message}`);
    }
  }

  const harness: Harness = {
    db,
    ownerId: OWNER_ID,
    async sql<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      const result = await db.query<T>(text, params);
      return result.rows;
    },
    async exec(text: string) {
      await db.exec(text);
    },
    // SET LOCAL would be a no-op outside a transaction block, so this uses a
    // plain SET and always resets, including on failure.
    async asOperator<T = Record<string, unknown>>(text: string, params: unknown[] = []) {
      await db.exec(`set role authenticated;`);
      try {
        const result = await db.query<T>(text, params);
        return result.rows;
      } finally {
        await db.exec(`reset role;`);
      }
    },
    async close() {
      await db.close();
    },
  };

  // Tests write unqualified SQL, exactly as the migrations do.
  await db.exec(`set search_path = manifest, public, extensions;`);

  await db.exec(`
    insert into app_owners (user_id, label)
    values ('${OWNER_ID}', 'test operator')
    on conflict (user_id) do nothing;
  `);
  await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER_ID}', false);`);

  if (options.seed !== false) {
    const seed = await readFile(join(repoRoot, 'supabase', 'seed.sql'), 'utf8');
    await db.exec(seed);
  }

  return harness;
}

/** Every view and matview in the public schema, for the "all views return" check. */
export async function listViews(db: PGlite): Promise<string[]> {
  const result = await db.query<{ viewname: string }>(`
    select c.relname as viewname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'manifest' and c.relkind in ('v', 'm')
    order by c.relname;
  `);
  return result.rows.map((r) => r.viewname);
}
