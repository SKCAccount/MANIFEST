import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { currentOperator } from '@/lib/auth';
import { syncConfig } from '@/lib/sync/config';
import { authorizeUrl } from '@/lib/sync/google/live';
import { REQUIRED_SCOPES } from '@/lib/sync/google/provider';

export const STATE_COOKIE = 'manifest_google_state';

/**
 * Starts the Google consent flow.
 *
 * The `state` parameter is a CSRF defence, not a formality. Without it, anyone
 * who can get the signed-in operator to load a URL can complete an OAuth
 * callback with a code from an account of their choosing — and the result would
 * be MANIFEST happily syncing a stranger's mailbox into the rolodex. The value
 * is random per attempt, stored in an httpOnly cookie, and checked on the way
 * back.
 */
export async function GET() {
  const operator = await currentOperator();
  if (!operator) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'));
  }

  const config = syncConfig();
  if (!config.ok || !config.config.google) {
    return NextResponse.json(
      {
        error:
          'Google is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI in .env.local.',
      },
      { status: 400 },
    );
  }

  const state = randomUUID();
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  });

  return NextResponse.redirect(
    authorizeUrl({
      clientId: config.config.google.clientId,
      redirectUri: config.config.google.redirectUri,
      scopes: REQUIRED_SCOPES,
      state,
    }),
  );
}
