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
import type { Database } from './database.types.js';

export type ManifestClient = ReturnType<typeof browserClient>;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env.local and fill it in — no secrets live in the repo.`,
    );
  }
  return value;
}

const url = () => requireEnv('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = () => requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

export function browserClient() {
  return createBrowserClient<Database>(url(), anonKey());
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

  return createClient<Database>(url(), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
