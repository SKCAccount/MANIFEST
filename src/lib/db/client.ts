/**
 * Typed Supabase clients.
 *
 * Three of them, and the distinction matters: this database holds private notes
 * about real people, including people who have never spoken to the operator.
 *
 *   browserClient()  — anon key, RLS enforced. Safe in the bundle.
 *   serverClient()   — the signed-in operator's session, RLS enforced.
 *   serviceClient()  — service role, RLS bypassed. Server-only, never imported
 *                      into a client component, and only for sync jobs, merges
 *                      and exports.
 */

import { createBrowserClient, createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type ManifestClient = ReturnType<typeof browserClient>;

/**
 * MANIFEST owns one schema on a database shared with the other systems, so
 * every client is pinned to it. Without this, supabase-js would resolve
 * `people` against `public` and find nothing — or, worse, find another
 * system's table of the same name.
 */
export const SCHEMA = 'manifest';

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in — no secrets live in the repo.`,
    );
  }
  return value;
}

/**
 * Two names per key, and static property access on purpose.
 *
 * Supabase renamed its API keys in 2025: new projects issue
 * `sb_publishable_...` / `sb_secret_...` under new dashboard names, older ones
 * carry the legacy JWT `anon` / `service_role` keys. The values are
 * interchangeable where supabase-js takes a key, so both spellings are read
 * and whichever is set wins — the combined seaking project uses the new kind.
 *
 * The lookups are written out literally rather than through a helper taking a
 * name, because Next.js inlines `process.env.NEXT_PUBLIC_*` into the browser
 * bundle only when the expression appears verbatim — a dynamic
 * `process.env[name]` compiles to `undefined` in client code with no error
 * anywhere.
 */
const url = () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
const anonKey = () =>
  required(
    'NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );

export function browserClient() {
  return createBrowserClient<Database>(url(), anonKey(), { db: { schema: SCHEMA } });
}

type CookieStore = {
  getAll(): Array<{ name: string; value: string }>;
  set(name: string, value: string, options?: Record<string, unknown>): void;
};

/**
 * For server components and server actions. Pass Next's cookie store.
 * RLS applies, so this can only see what the signed-in operator can see.
 */
export function serverClient(cookies: CookieStore) {
  return createServerClient<Database>(url(), anonKey(), {
    db: { schema: SCHEMA },
    cookies: {
      getAll: () => cookies.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) {
            cookies.set(name, value, options);
          }
        } catch {
          // Server components cannot set cookies. Middleware refreshes the
          // session instead, so this is safe to swallow.
        }
      },
    },
  });
}

/**
 * Bypasses RLS. Server-side only.
 *
 * Importing this into anything that reaches the browser would ship the service
 * key. The `SUPABASE_SERVICE_ROLE_KEY` name has no NEXT_PUBLIC_ prefix
 * precisely so Next refuses to inline it into client code.
 */
export function serviceClient() {
  if (typeof window !== 'undefined') {
    throw new Error('serviceClient() is server-only. It bypasses RLS and must never reach the browser.');
  }

  return createClient<Database>(
    url(),
    required(
      'SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY)',
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY,
    ),
    {
      db: { schema: SCHEMA },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}
