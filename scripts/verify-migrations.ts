/**
 * Migration verification.
 *
 * Applies every migration to an empty Postgres, then the fixtures, then selects
 * from every view. This is the check that "migrations run clean from empty"
 * stays true — it is easy to write a migration that works against your own
 * database and fails against a fresh one.
 *
 *   npm run db:verify
 */

import { createHarness, listViews, loadMigrations } from '../tests/helpers/db.js';

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

async function main(): Promise<number> {
  const migrations = await loadMigrations();
  console.log(`${DIM}Applying ${migrations.length} migrations to an empty database…${RESET}`);

  let harness;
  try {
    harness = await createHarness();
  } catch (error) {
    console.error(`${RED}✗ ${error instanceof Error ? error.message : String(error)}${RESET}`);
    return 1;
  }

  for (const migration of migrations) {
    console.log(`  ${GREEN}✓${RESET} ${migration.name}`);
  }

  const views = await listViews(harness.db);
  console.log(`\n${DIM}Selecting from ${views.length} views…${RESET}`);

  let failures = 0;
  for (const view of views) {
    try {
      const rows = await harness.sql(`select * from ${view} limit 1;`);
      console.log(`  ${GREEN}✓${RESET} ${view.padEnd(28)} ${DIM}${rows.length ? 'returns rows' : 'empty'}${RESET}`);
    } catch (error) {
      failures += 1;
      console.error(`  ${RED}✗ ${view}${RESET} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const counts = await harness.sql<{ total: string; active: string; uncontacted: string }>(`
    select
      count(*) as total,
      count(*) filter (where contact_status = 'active') as active,
      count(*) filter (where contact_status = 'uncontacted') as uncontacted
    from people;
  `);
  const fixtures = counts[0];

  console.log(
    `\n${DIM}Fixtures: ${fixtures?.total ?? 0} people ` +
      `(${fixtures?.active ?? 0} active, ${fixtures?.uncontacted ?? 0} uncontacted).${RESET}`,
  );

  await harness.close();

  if (failures > 0) {
    console.error(`\n${RED}${failures} view(s) failed.${RESET}`);
    return 1;
  }

  console.log(`\n${GREEN}Migrations verified.${RESET}`);
  return 0;
}

process.exit(await main());
