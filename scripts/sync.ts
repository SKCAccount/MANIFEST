/**
 * npm run sync [gmail|calendar|all]
 *
 * The same run cron performs, from a terminal. Useful for the first backfill,
 * which is long enough to want to watch, and for working out why a channel is
 * quiet without reading a serverless log.
 *
 * Run through `tsx --conditions=react-server`. The sync modules import
 * `server-only`, which is a real guarantee rather than a comment — it makes the
 * bundler fail if any of this is ever pulled into a client component, and the
 * service-role key with it. That package resolves to a module that throws
 * unless the `react-server` condition is set, so the flag in package.json is
 * what lets a CLI reuse exactly the code the app runs, with no second copy of
 * the wiring to drift.
 */

import { runCalendarSync } from '../src/lib/sync/calendar';
import { syncConfig } from '../src/lib/sync/config';
import { runGmailSync } from '../src/lib/sync/gmail';
import { persistRefreshedToken, resolveProvider } from '../src/lib/sync/google';
import { supabaseSyncStore } from '../src/lib/sync/store-supabase';
import { summarizeAll } from '../src/lib/sync/summarize';

const GREEN = '[32m';
const RED = '[31m';
const YELLOW = '[33m';
const DIM = '[2m';
const BOLD = '[1m';
const RESET = '[0m';

const requested = (process.argv[2] ?? 'all').toLowerCase();
const CHANNELS = requested === 'all' ? (['gmail', 'gcal'] as const) : ([normalize(requested)] as const);

function normalize(name: string): 'gmail' | 'gcal' {
  if (name === 'gmail') return 'gmail';
  if (name === 'calendar' || name === 'gcal') return 'gcal';
  console.error(`${RED}Unknown channel "${name}". Use gmail, calendar, or all.${RESET}`);
  process.exit(1);
}

async function main() {
  console.log(`\n${BOLD}MANIFEST — sync${RESET}\n`);

  const config = syncConfig();
  if (!config.ok) {
    console.error(`${RED}✗ ${config.detail}${RESET}\n`);
    process.exit(1);
  }

  console.log(`${DIM}Own domains: ${config.config.ownDomains.join(', ')}${RESET}`);

  const resolution = await resolveProvider();
  if (!resolution.ok) {
    console.error(`${RED}✗ ${resolution.detail}${RESET}\n`);
    process.exit(1);
  }

  const { provider } = resolution;

  if (provider.kind === 'fixture') {
    console.log(
      `${YELLOW}! Fixture provider — no Google OAuth app is configured, so this replays canned\n` +
        `  messages from src/lib/sync/google/fixtures/. Everything below is real except the mail.${RESET}`,
    );
  } else {
    console.log(`${DIM}Account: ${provider.accountEmail}${RESET}`);
  }
  console.log('');

  const store = supabaseSyncStore();
  let failed = false;

  for (const channel of CHANNELS) {
    process.stdout.write(`  ${channel === 'gmail' ? 'Gmail   ' : 'Calendar'}  `);
    try {
      const result =
        channel === 'gmail'
          ? await runGmailSync({
              provider,
              store,
              ownDomains: config.config.ownDomains,
              label: config.config.gmailLabel,
              summarize: (days) => summarizeAll(days),
            })
          : await runCalendarSync({ provider, store, ownDomains: config.config.ownDomains });

      const counts = result.counts as unknown as Record<string, number>;
      const written = (counts.inserted ?? 0) + (counts.superseded ?? 0);
      const skipped = Object.entries(counts)
        .filter(([key, value]) => key.startsWith('skipped_') && value > 0)
        .map(([key, value]) => `${key.replace('skipped_', '')} ${value}`)
        .join(', ');

      console.log(
        `${GREEN}✓${RESET} ${written} written, ${counts.unchanged ?? 0} unchanged, ` +
          `${counts.staged ?? 0} to review` +
          (skipped ? `${DIM} · skipped: ${skipped}${RESET}` : '') +
          (result.complete ? '' : `${YELLOW} · partial (cursor had expired)${RESET}`),
      );
    } catch (error) {
      failed = true;
      console.log(`${RED}✗ ${error instanceof Error ? error.message : String(error)}${RESET}`);
    }
  }

  await persistRefreshedToken(resolution.credentialId, provider);

  console.log('');
  if (failed) {
    console.log(`${YELLOW}One or more channels failed. The Sync screen has the recorded error.${RESET}\n`);
    process.exit(1);
  }
  console.log(`${DIM}Review anything unresolved at /review.${RESET}\n`);
}

await main();
