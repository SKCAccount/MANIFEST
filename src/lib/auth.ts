/**
 * Auth helpers. Single account, magic link.
 *
 * Every page and every server action funnels through requireOperator(), which
 * both establishes the session and confirms the signed-in user is a registered
 * owner. RLS enforces the same thing at the database, so a missed check here
 * returns empty results rather than someone else's rolodex — but the redirect
 * is what makes that a login page instead of a blank screen.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { serverClient } from './db/client';

export async function supabase() {
  return serverClient(await cookies());
}

export type Operator = {
  userId: string;
  email: string | null;
  label: string | null;
};

/**
 * Cached per request: a page that reads it in the layout and again in three
 * server components should not make three round trips.
 */
export const currentOperator = cache(async (): Promise<Operator | null> => {
  const db = await supabase();

  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) return null;

  const { data: owner } = await db
    .from('app_owners')
    .select('user_id, label')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!owner) return null;

  return { userId: user.id, email: user.email ?? null, label: owner.label };
});

/** Redirects to the login page when there is no session, or the session is not an owner. */
export async function requireOperator(): Promise<Operator> {
  const operator = await currentOperator();
  if (!operator) redirect('/login');
  return operator;
}

/**
 * For server actions. Throws rather than redirecting: an action that fires
 * without a session is a bug or an expired tab, and a thrown error surfaces
 * that instead of silently doing nothing.
 */
export async function requireOperatorForAction(): Promise<Operator> {
  const operator = await currentOperator();
  if (!operator) {
    throw new Error('Not signed in. Reload the page and sign in again.');
  }
  return operator;
}
