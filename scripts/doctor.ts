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
    fix:
      'Optional. Without it quick capture falls back to the manual form and synced touchpoints ' +
      'keep the subject line instead of a summary; everything else works.',
  });

  // ---------------------------------------------------------------------------
  // 1b. Phase 2 — sync
  // ---------------------------------------------------------------------------
  const ownDomains = (process.env.MANIFEST_OWN_DOMAINS ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  record({
    label: 'MANIFEST_OWN_DOMAINS',
    state: ownDomains.length > 0 ? 'ok' : 'warn',
    detail: ownDomains.length > 0 ? ownDomains.join(', ') : 'not set',
    // A warning rather than a failure because Phase 1 is entirely usable
    // without it — but the wording is blunt, because this is the one variable
    // whose absence sync treats as unsurvivable rather than degraded.
    fix:
      'Required before sync will run at all. With no own-domains every message you sent reads as ' +
      'inbound, inbound promotes, and the whole watchlist would flip to active — which cannot be ' +
      'undone. Sync refuses to start rather than risk it.',
  });

  const googleConfigured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REDIRECT_URI,
  );

  record({
    label: 'Google OAuth app',
    state: googleConfigured ? 'ok' : 'warn',
    detail: googleConfigured ? 'configured' : 'not configured — sync runs on fixtures',
    fix: googleConfigured
      ? undefined
      : 'Optional. Without it sync replays canned messages from src/lib/sync/google/fixtures/, which ' +
        'is enough to exercise every screen. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and ' +
        'GOOGLE_REDIRECT_URI to connect a real account.',
  });

  record({
    label: 'CRON_SECRET',
    state: process.env.CRON_SECRET ? 'ok' : 'warn',
    detail: process.env.CRON_SECRET ? 'set' : 'not set',
    fix: 'Without it /api/cron/* rejects every request, including the scheduled ones. Any long random string.',
  });

  if (!url || !serviceKey) {
    report();
    console.log(
      `${YELLOW}Stopping here — fill in .env.local, then run this again.${RESET}\n` +
        `${DIM}cp .env.example .env.local${RESET}\n`,
    );
    process.exit(1);
  }

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(url);
  const db = createClient(url, serviceKey, {
    db: { schema: 'manifest' },
    auth: { persistSession: false },
  });

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
        ? 'Either migrations are not applied (supabase db push / supabase start), or the ' +
          '`manifest` schema is not exposed to the API. Hosted: Project Settings → Data API → ' +
          'Exposed schemas → add `manifest`. Local: [api] schemas in supabase/config.toml.'
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
    // Phase 2. Listed here so a database still at Phase 1 is reported as
    // unmigrated rather than reaching the sync checks below, which read these
    // and would otherwise show "never run" for a channel whose tables do not
    // exist yet.
    'v_sync_status',
    'v_review_queue',
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
      fix: isLocal
        ? 'Run `npm run bootstrap:owner` — locally it creates the user for you.'
        : 'Signup is disabled by design. Supabase dashboard → Authentication → Users → Add user, using your own email. Then `npm run bootstrap:owner`.',
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
  // The cast matters: `id` is a uuid, and PostgREST's `like` against a uuid
  // column matches nothing rather than erroring — so without it this check
  // silently reported zero fixtures forever, which is precisely the warning it
  // exists to give before someone starts entering real relationships.
  const { count: fixtureCount } = await db
    .from('people')
    .select('id', { head: true, count: 'exact' })
    .like('id::text', '11111111-0000-4000-8000-%');

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

  // -------------------------------------------------------------------------
  // 5. Sync state — is it connected, and has it actually run
  // -------------------------------------------------------------------------
  const { data: connection } = await db
    .from('google_credentials')
    .select('account_email, scopes, connected_at')
    .is('revoked_at', null)
    .maybeSingle();

  record({
    label: 'Google connected',
    state: connection ? 'ok' : googleConfigured ? 'warn' : 'ok',
    detail: connection
      ? `${connection.account_email} (${(connection.scopes ?? []).length} scopes)`
      : googleConfigured
        ? 'no account connected'
        : 'n/a — running on fixtures',
    fix: connection || !googleConfigured ? undefined : 'Connect one from the Sync screen at /sync.',
  });

  const { data: channels } = await db
    .from('v_sync_status')
    .select('label, never_run, is_stale, last_run_status, last_success_at');

  for (const channel of channels ?? []) {
    record({
      label: `Sync — ${channel.label}`,
      state: channel.never_run ? 'warn' : channel.last_run_status === 'error' ? 'fail' : channel.is_stale ? 'warn' : 'ok',
      detail: channel.never_run
        ? 'never run'
        : channel.last_run_status === 'error'
          ? 'last run failed'
          : channel.is_stale
            ? `last success ${new Date(channel.last_success_at!).toISOString().slice(0, 16).replace('T', ' ')}`
            : 'healthy',
      fix: channel.never_run
        ? 'Run `npm run sync` once, or press Sync now on /sync.'
        : channel.last_run_status === 'error'
          ? 'The recorded error is on /sync under Recent runs.'
          : undefined,
    });
  }

  const { count: pendingReview } = await db
    .from('v_review_queue')
    .select('id', { head: true, count: 'exact' });

  record({
    label: 'Review queue',
    state: 'ok',
    detail:
      (pendingReview ?? 0) === 0
        ? 'empty'
        : `${pendingReview} address${pendingReview === 1 ? '' : 'es'} waiting`,
    fix:
      (pendingReview ?? 0) > 0
        ? 'Sync parks anything it could not place at /review rather than guessing at it.'
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
