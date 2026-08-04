/**
 * npm run auth:set-password
 *
 * Sets (or resets) the operator's password, interactively and locally. This
 * exists because signup is disabled everywhere real — there is no self-service
 * "create account" or "forgot password" flow to lean on, and the dashboard is
 * an extra trip. Works against whichever project .env.local points at, local
 * stack included.
 *
 * The password is read with terminal echo off, compared against a second
 * entry, sent once to the project's admin endpoint over TLS, and held nowhere
 * else — not in argv (shell history), not in the environment, not in any log.
 * Run it yourself; it is deliberately interactive and refuses piped input for
 * the first entry only when no TTY is present at all.
 */

import { createClient } from '@supabase/supabase-js';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
const email = (process.env.MANIFEST_OWNER_EMAIL ?? process.argv[2])?.trim().toLowerCase();

if (!url || !serviceKey) {
  console.error(`${RED}Missing NEXT_PUBLIC_SUPABASE_URL, or a service key (SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SECRET_KEY).${RESET}`);
  process.exit(1);
}
if (!email) {
  console.error(`${RED}No email. Set MANIFEST_OWNER_EMAIL in .env.local, or pass one: npm run auth:set-password -- you@example.com${RESET}`);
  process.exit(1);
}

/** Reads one line with echo off. Backspace works; Ctrl-C aborts. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      console.error(`\n${RED}This prompt needs a real terminal — the password must not arrive via pipe or argv.${RESET}`);
      process.exit(1);
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '') {
          // Ctrl-C
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        } else if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.removeListener('data', onData);
          stdin.pause();
          process.stdout.write('\n');
          resolve(value);
          return;
        } else if (char === '' || char === '\b') {
          value = value.slice(0, -1);
        } else if (char >= ' ') {
          value += char;
        }
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const host = new URL(url!).host;
  console.log(`\n${BOLD}Set the sign-in password${RESET}`);
  console.log(`${DIM}${email} @ ${host}${RESET}\n`);

  const db = createClient(url!, serviceKey!, { auth: { persistSession: false } });

  const { data: list, error: listError } = await db.auth.admin.listUsers();
  if (listError) {
    console.error(`${RED}Could not list users: ${listError.message}${RESET}`);
    process.exit(1);
  }

  const user = list.users.find((candidate) => candidate.email?.toLowerCase() === email);
  if (!user) {
    console.error(
      `${RED}No auth user for ${email}.${RESET}\n` +
        `${DIM}Create it first — locally: npm run bootstrap:owner. Hosted: SETUP.md step 6.${RESET}`,
    );
    process.exit(1);
  }

  const password = await promptHidden('New password (typing is hidden): ');
  if (password.length < 12) {
    // Length is most of what a password has going for it. Twelve is the floor,
    // not a target.
    console.error(`${RED}Too short — use at least 12 characters.${RESET}`);
    process.exit(1);
  }

  const again = await promptHidden('Once more: ');
  if (password !== again) {
    console.error(`${RED}They differ. Nothing changed — run it again.${RESET}`);
    process.exit(1);
  }

  const { error } = await db.auth.admin.updateUserById(user.id, { password });
  if (error) {
    console.error(`${RED}${error.message}${RESET}`);
    process.exit(1);
  }

  console.log(`\n${GREEN}✓${RESET} Password set for ${email}.`);
  console.log(`${DIM}Sign in at ${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}.${RESET}\n`);
}

await main();
