/**
 * npm run fixtures:load    — push the 25 demo people into the linked project
 * npm run fixtures:clear   — remove them again
 *
 * The fixtures are invented people. They are useful for seeing the screens work
 * with realistic data and useless — actively harmful — once you start entering
 * real relationships, because a rolodex you cannot trust is worse than no
 * rolodex.
 *
 * So: load them into a scratch project, or load them, look around, and clear
 * them before the first real record. `npm run doctor` tells you which state you
 * are in.
 *
 * Every fixture id is prefixed, which is what makes the clear exact rather than
 * a guess: people 11111111-…, organizations 22222222-…, sources 33333333-…,
 * deals 44444444-….
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const RESET = '[0m';

const mode = process.argv[2];
if (mode !== 'load' && mode !== 'clear') {
  console.error('Usage: tsx scripts/fixtures.ts <load|clear>');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(`${RED}Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.${RESET}`);
  process.exit(1);
}

const db = createClient(url, serviceKey, { db: { schema: 'manifest' }, auth: { persistSession: false } });

const FIXTURE_PREFIXES = {
  people: '11111111-0000-4000-8000-',
  organizations: '22222222-0000-4000-8000-',
  sources: '33333333-0000-4000-8000-',
  deals: '44444444-0000-4000-8000-',
} as const;

type FixtureCounts = Record<keyof typeof FIXTURE_PREFIXES, number>;

async function countFixtures(): Promise<FixtureCounts> {
  const counts = {} as FixtureCounts;
  for (const table of Object.keys(FIXTURE_PREFIXES) as Array<keyof typeof FIXTURE_PREFIXES>) {
    const { count } = await db
      .from(table)
      .select('id', { head: true, count: 'exact' })
      .like('id', `${FIXTURE_PREFIXES[table]}%`);
    counts[table] = count ?? 0;
  }
  return counts;
}

async function countReal() {
  const { count: total } = await db.from('people').select('id', { head: true, count: 'exact' });
  const { count: fixtures } = await db
    .from('people')
    .select('id', { head: true, count: 'exact' })
    .like('id', `${FIXTURE_PREFIXES.people}%`);
  return (total ?? 0) - (fixtures ?? 0);
}

if (mode === 'load') {
  const existing = await countFixtures();
  if (existing.people > 0) {
    console.log(`${YELLOW}Fixtures already loaded${RESET} (${existing.people} people). Nothing to do.`);
    console.log(`${DIM}Run \`npm run fixtures:clear\` first if you want to reload them.${RESET}`);
    process.exit(0);
  }

  const real = await countReal();
  if (real > 0) {
    console.error(
      `${RED}Refusing to load fixtures: this project already holds ${real} real ${real === 1 ? 'record' : 'records'}.${RESET}`,
    );
    console.error(
      `${DIM}Mixing invented people into a real rolodex is the one thing this system must never do.${RESET}`,
    );
    console.error(`${DIM}Use a separate scratch project for demo data.${RESET}`);
    process.exit(1);
  }

  // seed.sql is a single script with ordering that matters (referrers before
  // referrals, the job-change update last), so it goes over in one call.
  const seedPath = join(process.cwd(), 'supabase', 'seed.sql');
  const sql = await readFile(seedPath, 'utf8');

  const { error } = await db.rpc('exec_sql' as never, { sql } as never);

  if (error) {
    console.error(`${RED}Could not load fixtures over the API.${RESET}\n`);
    console.error('Supabase does not expose arbitrary SQL through the REST API, so use one of:\n');
    console.error(`  ${DIM}supabase db reset --linked${RESET}   ${DIM}# applies migrations + seed.sql (destructive)${RESET}`);
    console.error(`  ${DIM}psql "$DATABASE_URL" -f supabase/seed.sql${RESET}`);
    console.error(
      `\n${DIM}The connection string is in the dashboard under Project Settings → Database.${RESET}`,
    );
    process.exit(1);
  }

  const loaded = await countFixtures();
  console.log(`${GREEN}✓${RESET} Fixtures loaded: ${loaded.people} people, ${loaded.organizations} organizations.`);
  console.log(`${DIM}Clear them with \`npm run fixtures:clear\` before entering real relationships.${RESET}`);
} else {
  const existing = await countFixtures();
  if (existing.people === 0) {
    console.log('No fixtures present. Nothing to do.');
    process.exit(0);
  }

  const real = await countReal();
  console.log(
    `Removing ${existing.people} fixture people, ${existing.organizations} organizations, ` +
      `${existing.sources} sources, ${existing.deals} deals.`,
  );
  if (real > 0) {
    console.log(`${DIM}Leaving your ${real} real ${real === 1 ? 'record' : 'records'} untouched.${RESET}`);
  }

  // People first: touchpoints, notes, followups, favors, tier_history and
  // affiliation_history all cascade from it. Organizations and sources go last
  // because person rows reference them.
  for (const table of ['deals', 'people', 'sources', 'organizations'] as const) {
    const { error } = await db.from(table).delete().like('id', `${FIXTURE_PREFIXES[table]}%`);
    if (error) {
      console.error(`${RED}Failed clearing ${table}: ${error.message}${RESET}`);
      process.exit(1);
    }
  }

  const left = await countFixtures();
  if (left.people > 0) {
    console.error(`${RED}${left.people} fixture people remain — check for references.${RESET}`);
    process.exit(1);
  }

  console.log(`${GREEN}✓${RESET} Fixtures cleared.`);
}
