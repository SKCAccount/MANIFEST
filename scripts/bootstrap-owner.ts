/**
 * npm run bootstrap:owner
 *
 * Registers your Supabase auth user in `app_owners`, which is what every RLS
 * policy checks. Without a row here you can sign in successfully and see an
 * entirely empty rolodex — the most confusing possible failure, so this exists
 * to make it a one-liner.
 *
 * Requires the auth user to exist first. Signup is disabled by design
 * (config.toml: enable_signup = false), so create it in the Supabase dashboard
 * under Authentication → Users → Add user.
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
  console.error(`${DIM}Set MANIFEST_OWNER_EMAIL in .env.local, or pass it: npm run bootstrap:owner -- you@example.com${RESET}`);
  process.exit(1);
}

const db = createClient(url, serviceKey, { db: { schema: 'manifest' }, auth: { persistSession: false } });

const { data: list, error: listError } = await db.auth.admin.listUsers();
if (listError) {
  console.error(`${RED}Could not list auth users: ${listError.message}${RESET}`);
  process.exit(1);
}

const user = list.users.find((u) => u.email?.toLowerCase() === email);

if (!user) {
  console.error(`${RED}No auth user with the address ${email}.${RESET}\n`);
  console.error('Signup is disabled by design — create the user first:');
  console.error(`${DIM}  Supabase dashboard → Authentication → Users → Add user${RESET}`);
  console.error(`${DIM}  Use ${email}, tick "Auto Confirm User", then run this again.${RESET}\n`);
  if (list.users.length > 0) {
    console.error(`Existing auth users: ${list.users.map((u) => u.email).join(', ')}`);
  }
  process.exit(1);
}

const { error: insertError } = await db
  .from('app_owners')
  .upsert({ user_id: user.id, label: email }, { onConflict: 'user_id' });

if (insertError) {
  console.error(`${RED}Could not register the owner: ${insertError.message}${RESET}`);
  process.exit(1);
}

console.log(`${GREEN}✓${RESET} ${email} registered as an owner.`);
console.log(`${DIM}  auth user id: ${user.id}${RESET}`);
console.log(`\nSign in at ${DIM}http://localhost:3000/login${RESET} with that address.`);
