/**
 * npm run doctor
 *
 * Answers one question: what is stopping me from using this right now?
 *
 * Checks environment, connectivity, schema, owner registration and fixture
 * state, and prints the next action for whatever is missing. Safe to run
 * repeatedly; it writes nothing.
 */

import { createClient } from '@supabase/supabase-js';

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

type Check = {
  label: string;
  state: 'ok' | 'fail' | 'warn';
  detail: string;
  fix?: string;
};

const checks: Check[] = [];
let blocked = false;

function record(check: Check) {
  checks.push(check);
  if (check.state === 'fail') blocked = true;
}

async function main() {
  console.log(`\n${BOLD}MANIFEST — setup check${RESET}\n`);

  // -------------------------------------------------------------------------
  // 1. Environment
  // -------------------------------------------------------------------------
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ownerEmail = process.env.MANIFEST_OWNER_EMAIL;

  record({
    label: 'NEXT_PUBLIC_SUPABASE_URL',
    state: url ? 'ok' : 'fail',
    detail: url ?? 'not set',
    fix: 'Supabase dashboard → Project Settings → Data API → Project URL',
  });

  record({
    label: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    state: anonKey ? 'ok' : 'fail',
    detail: anonKey ? `${anonKey.slice(0, 12)}…` : 'not set',
    fix: 'Supabase dashboard → Project Settings → API Keys → anon / public',
  });

  record({
    label: 'SUPABASE_SERVICE_ROLE_KEY',
    state: serviceKey ? 'ok' : 'fail',
    detail: serviceKey ? `${serviceKey.slice(0, 12)}…` : 'not set',
    fix: 'Supabase dashboard → Project Settings → API Keys → service_role (keep this server-side)',
  });

  record({
    label: 'MANIFEST_OWNER_EMAIL',
    state: ownerEmail ? 'ok' : 'warn',
    detail: ownerEmail ?? 'not set',
    fix: 'Needed by `npm run bootstrap:owner`. Your own address.',
  });

  record({
    label: 'ANTHROPIC_API_KEY',
    state: process.env.ANTHROPIC_API_KEY ? 'ok' : 'warn',
    detail: process.env.ANTHROPIC_API_KEY ? 'set' : 'not set',
    fix: 'Optional. Without it quick capture falls back to the manual form; everything else works.',
  });

  if (!url || !serviceKey) {
    report();
    console.log(
      `${YELLOW}Stopping here — fill in .env.local, then run this again.${RESET}\n` +
        `${DIM}cp .env.example .env.local${RESET}\n`,
    );
    process.exit(1);
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  // -------------------------------------------------------------------------
  // 2. Connectivity + schema
  // -------------------------------------------------------------------------
  const { error: reachError } = await db.from('taxonomies').select('id', { head: true, count: 'exact' });

  if (reachError) {
    const looksUnmigrated = /relation .* does not exist|schema cache/i.test(reachError.message);
    record({
      label: 'Schema',
      state: 'fail',
      detail: looksUnmigrated ? 'tables not found' : reachError.message,
      fix: looksUnmigrated
        ? 'Run: supabase link --project-ref <ref>  then  supabase db push'
        : 'Check the URL and service key belong to the same project.',
    });
    report();
    process.exit(1);
  }

  record({ label: 'Connectivity', state: 'ok', detail: 'reachable' });

  const { count: taxonomyCount } = await db
    .from('taxonomies')
    .select('id', { head: true, count: 'exact' });

  record({
    label: 'Taxonomies seeded',
    state: (taxonomyCount ?? 0) > 0 ? 'ok' : 'fail',
    detail: `${taxonomyCount ?? 0} values`,
    fix: 'Migration 0018 seeds these. Re-run `supabase db push`.',
  });

  // Every view must be queryable, or a screen will 500 on first load.
  const views = [
    'v_queue',
    'v_never_followed_up',
    'v_directory',
    'v_watchlist',
    'v_geography',
    'v_source_roi',
  ];
  const brokenViews: string[] = [];
  for (const view of views) {
    const { error } = await db.from(view).select('*', { head: true, count: 'exact' });
    if (error) brokenViews.push(`${view}: ${error.message}`);
  }
  record({
    label: 'Views',
    state: brokenViews.length === 0 ? 'ok' : 'fail',
    detail: brokenViews.length === 0 ? `${views.length} queryable` : brokenViews.join('; '),
    fix: 'Re-run `supabase db push`; a migration may have partially applied.',
  });

  // -------------------------------------------------------------------------
  // 3. Owner registration — the one that silently shows an empty rolodex
  // -------------------------------------------------------------------------
  const { data: owners } = await db.from('app_owners').select('user_id, label');

  if ((owners ?? []).length === 0) {
    record({
      label: 'Owner registered',
      state: 'fail',
      detail: 'app_owners is empty',
      fix: 'Run `npm run bootstrap:owner`. Until then you can sign in but every screen will be empty — RLS grants access only to registered owners.',
    });
  } else {
    record({
      label: 'Owner registered',
      state: 'ok',
      detail: `${owners!.length} owner${owners!.length === 1 ? '' : 's'}`,
    });
  }

  // Does an auth user actually exist to sign in as?
  const { data: authUsers, error: authError } = await db.auth.admin.listUsers();
  if (authError) {
    record({
      label: 'Auth user',
      state: 'warn',
      detail: authError.message,
      fix: 'Could not list auth users — check the service key.',
    });
  } else if (authUsers.users.length === 0) {
    record({
      label: 'Auth user',
      state: 'fail',
      detail: 'no auth users exist',
      fix: 'Signup is disabled by design. Supabase dashboard → Authentication → Users → Add user, using your own email. Then `npm run bootstrap:owner`.',
    });
  } else {
    record({
      label: 'Auth user',
      state: 'ok',
      detail: authUsers.users.map((u) => u.email).join(', '),
    });
  }

  // -------------------------------------------------------------------------
  // 4. Data state — so you know whether you are looking at fixtures
  // -------------------------------------------------------------------------
  const { count: peopleCount } = await db.from('people').select('id', { head: true, count: 'exact' });
  const { count: fixtureCount } = await db
    .from('people')
    .select('id', { head: true, count: 'exact' })
    .like('id', '11111111-0000-4000-8000-%');

  record({
    label: 'People',
    state: 'ok',
    detail:
      (peopleCount ?? 0) === 0
        ? 'empty — ready for real data'
        : `${peopleCount} records${(fixtureCount ?? 0) > 0 ? `, ${fixtureCount} of them fixtures` : ''}`,
    fix:
      (fixtureCount ?? 0) > 0
        ? 'Fixtures are invented people. Run `npm run fixtures:clear` before entering real relationships.'
        : undefined,
  });

  report();

  if (blocked) {
    console.log(`${YELLOW}Fix the ${RED}✗${YELLOW} items above, then run this again.${RESET}\n`);
    process.exit(1);
  }

  console.log(`${GREEN}Ready.${RESET} Start the app with ${BOLD}npm run dev${RESET}\n`);
}

function report() {
  const pad = Math.max(...checks.map((c) => c.label.length));
  for (const check of checks) {
    const mark = check.state === 'ok' ? `${GREEN}✓${RESET}` : check.state === 'warn' ? `${YELLOW}!${RESET}` : `${RED}✗${RESET}`;
    console.log(`  ${mark} ${check.label.padEnd(pad)}  ${DIM}${check.detail}${RESET}`);
    if (check.state !== 'ok' && check.fix) {
      console.log(`    ${DIM}→ ${check.fix}${RESET}`);
    }
  }
  console.log('');
}

await main();
