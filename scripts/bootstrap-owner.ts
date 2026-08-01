/**
 * npm run bootstrap:owner
 *
 * Registers your Supabase auth user in `manifest.app_owners`, which is what
 * every RLS policy checks. Without a row here you can sign in successfully and
 * see an entirely empty rolodex — the most confusing possible failure, so this
 * exists to make it a one-liner.
 *
 * Against a local stack it also creates the auth user if it does not exist, so
 * the local path needs no dashboard at all. Against a hosted project it will
 * not: signup there is disabled by design, and creating accounts from a script
 * would quietly undo that.
 */

import { createClient } from '@supabase/supabase-js';

const GREEN = '[32m';
const RED = '[31m';
const DIM = '[2m';
const RESET = '[0m';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.MANIFEST_OWNER_EMAIL ?? process.argv[2])?.trim().toLowerCase();

if (!url || !serviceKey) {
  console.error(`${RED}Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.${RESET}`);
  console.error(`${DIM}Fill in .env.local, then run: npm run doctor${RESET}`);
  process.exit(1);
}

if (!email) {
  console.error(`${RED}No email given.${RESET}`);
  console.error(
    `${DIM}Set MANIFEST_OWNER_EMAIL in .env.local, or pass it: npm run bootstrap:owner -- you@example.com${RESET}`,
  );
  process.exit(1);
}

/** A local stack is disposable and single-user; a hosted project is neither. */
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(url);

const db = createClient(url, serviceKey, {
  db: { schema: 'manifest' },
  auth: { persistSession: false },
});

const { data: list, error: listError } = await db.auth.admin.listUsers();
if (listError) {
  console.error(`${RED}Could not list auth users: ${listError.message}${RESET}`);
  process.exit(1);
}

let user = list.users.find((u) => u.email?.toLowerCase() === email);

if (!user) {
  if (!isLocal) {
    console.error(`${RED}No auth user with the address ${email}.${RESET}\n`);
    console.error('Signup is disabled by design on a hosted project — create the user first:');
    console.error(`${DIM}  Supabase dashboard → Authentication → Users → Add user${RESET}`);
    console.error(`${DIM}  Use ${email}, tick "Auto Confirm User", then run this again.${RESET}\n`);
    if (list.users.length > 0) {
      console.error(`Existing auth users: ${list.users.map((u) => u.email).join(', ')}`);
    }
    process.exit(1);
  }

  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (createError) {
    console.error(`${RED}Could not create the local auth user: ${createError.message}${RESET}`);
    process.exit(1);
  }

  user = created.user;
  console.log(`${GREEN}✓${RESET} Created local auth user ${email}.`);
}

const { error: insertError } = await db
  .from('app_owners')
  .upsert({ user_id: user.id, label: email }, { onConflict: 'user_id' });

if (insertError) {
  console.error(`${RED}Could not register the owner: ${insertError.message}${RESET}`);
  process.exit(1);
}

console.log(`${GREEN}✓${RESET} ${email} registered as an owner of MANIFEST.`);
console.log(`${DIM}  auth user id: ${user.id}${RESET}`);

if (isLocal) {
  console.log(
    `\nSign in at ${DIM}http://localhost:3000${RESET} — the magic link arrives at ` +
      `${DIM}http://localhost:54324${RESET}, not your real inbox.`,
  );
} else {
  console.log(`\nSign in at ${DIM}${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}${RESET}.`);
}
