import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { currentOperator } from '@/lib/auth';
import { serviceClient } from '@/lib/db/client';
import { syncConfig } from '@/lib/sync/config';
import { exchangeCode } from '@/lib/sync/google/live';
import { STATE_COOKIE } from '../connect/route';

/**
 * Where Google sends the operator back.
 *
 * Writes with the service client rather than the operator's session, because
 * migration 0020 gives `authenticated` no insert or update on
 * `google_credentials` at all — the refresh token is a standing grant to read
 * an entire mailbox, and the app's own UI has no business being able to write
 * one, only to see that one exists.
 */
export async function GET(request: NextRequest) {
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const back = (message: string, ok = false) =>
    NextResponse.redirect(new URL(`/sync?${ok ? 'connected' : 'error'}=${encodeURIComponent(message)}`, site));

  const operator = await currentOperator();
  if (!operator) return NextResponse.redirect(new URL('/login', site));

  const config = syncConfig();
  if (!config.ok || !config.config.google) return back('Google is not configured.');

  const params = request.nextUrl.searchParams;

  // The operator pressed Cancel, or Google refused. Not an error worth a stack
  // trace, but worth saying out loud rather than silently landing back on a
  // page that still says "not connected".
  const denied = params.get('error');
  if (denied) return back(`Google returned "${denied}".`);

  const code = params.get('code');
  const state = params.get('state');
  const jar = await cookies();
  const expected = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);

  if (!code) return back('Google sent no authorization code.');
  if (!state || !expected || state !== expected) {
    return back('That sign-in did not start here. Try connecting again from the Sync screen.');
  }

  try {
    const granted = await exchangeCode({
      code,
      clientId: config.config.google.clientId,
      clientSecret: config.config.google.clientSecret,
      redirectUri: config.config.google.redirectUri,
    });

    // Whose mailbox this is. Read from Google rather than assumed to be the
    // operator's own login address — they are frequently different, and every
    // inbound/outbound decision downstream depends on getting it right.
    const profile = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${granted.accessToken}` },
    });
    if (!profile.ok) return back(`Could not read the Google profile (${profile.status}).`);
    const { emailAddress } = (await profile.json()) as { emailAddress: string };

    const db = serviceClient();

    // Only one live credential is allowed (google_credentials_live_key), so an
    // existing connection is retired before the new one lands. Connecting a
    // second account is a deliberate switch, not an accumulation.
    await db
      .from('google_credentials')
      .update({ revoked_at: new Date().toISOString(), access_token: null } as never)
      .is('revoked_at', null)
      .neq('account_email', emailAddress);

    const { error } = await db.from('google_credentials').upsert(
      {
        account_email: emailAddress,
        refresh_token: granted.refreshToken,
        access_token: granted.accessToken,
        access_token_expires_at: granted.expiresAt,
        scopes: granted.scopes,
        connected_at: new Date().toISOString(),
        revoked_at: null,
        last_refresh_at: new Date().toISOString(),
        last_refresh_error: null,
      } as never,
      { onConflict: 'account_email' },
    );
    if (error) return back(error.message);

    return back(`Connected ${emailAddress}.`, true);
  } catch (error) {
    return back(error instanceof Error ? error.message : 'The token exchange failed.');
  }
}
