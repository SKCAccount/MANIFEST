/**
 * Prints a signed-in cookie header for the LOCAL stack, so pages can be fetched
 * with curl and checked for what they actually render.
 *
 * Local only, by assertion below — it sets a password on the local auth user,
 * which is meaningless against a hosted project (where signup is disabled and
 * magic links are the only path) and would be a real change to make there.
 *
 * The cookie names are not guessed: this drives the same @supabase/ssr client
 * the app uses and captures whatever it writes, so the header is correct by
 * construction even if the library changes its storage key.
 */

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error('Needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(url)) {
  console.error(`Refusing to run against ${url}. This is a local-stack helper and it sets a password.`);
  process.exit(1);
}

const PASSWORD = 'manifest-local-verify';

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: users, error: listError } = await admin.auth.admin.listUsers();
if (listError) {
  console.error(listError.message);
  process.exit(1);
}

const user = users.users[0];
if (!user?.email) {
  console.error('No auth user. Run `npm run bootstrap:owner` first.');
  process.exit(1);
}

const { error: updateError } = await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
if (updateError) {
  console.error(updateError.message);
  process.exit(1);
}

const jar = new Map<string, string>();
const client = createServerClient(url, anonKey, {
  cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (toSet) => {
      for (const { name, value } of toSet) jar.set(name, value);
    },
  },
});

const { error: signInError } = await client.auth.signInWithPassword({
  email: user.email,
  password: PASSWORD,
});

if (signInError) {
  console.error(signInError.message);
  process.exit(1);
}

console.log([...jar].map(([name, value]) => `${name}=${value}`).join('; '));
