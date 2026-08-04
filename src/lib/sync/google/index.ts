import 'server-only';

/**
 * Choosing a provider, and persisting what the provider learns.
 *
 * One decision: are there Google credentials, and is an account connected? The
 * answer picks `LiveGoogleProvider` or `FixtureGoogleProvider`, and nothing
 * downstream is told which. The `kind` field travels with the provider and is
 * recorded on every run, so a fixture run is always distinguishable after the
 * fact — the one thing that must never be ambiguous.
 */

import { serviceClient } from '../../db/client';
import { syncConfig } from '../config';
import { FixtureGoogleProvider } from './fixture';
import { LiveGoogleProvider } from './live';
import type { GoogleProvider } from './provider';

export type ProviderResolution =
  | { ok: true; provider: GoogleProvider; credentialId: string | null }
  | { ok: false; reason: 'not_connected' | 'not_configured'; detail: string };

export async function resolveProvider(): Promise<ProviderResolution> {
  const status = syncConfig();
  if (!status.ok) {
    return { ok: false, reason: 'not_configured', detail: status.detail };
  }

  const { google } = status.config;

  // No OAuth app configured at all. This is the documented state of the
  // project rather than an error, so it resolves to the fixture provider and
  // the sync runs end to end against canned data — which is what makes the
  // screens, the cron routes and the whole pipeline reviewable before anyone
  // has been through Google's verification process.
  //
  // Against a local stack only. On a hosted project, "no Google yet" is the
  // normal state between deploying and connecting an account, and a stray
  // "Sync now" during that window would replay invented mail into a real
  // review queue. Mixing fixture people into real data is the one thing this
  // system must never do, so the fixture provider refuses to run against a
  // non-local database. The override exists for the scratch-project demo case
  // (SETUP.md step 9), where the fixtures are the point.
  if (!google) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/i.test(supabaseUrl);

    if (!isLocal && process.env.MANIFEST_ALLOW_FIXTURE_SYNC !== '1') {
      return {
        ok: false,
        reason: 'not_configured',
        detail:
          'No Google OAuth app is configured, and this is not a local stack — refusing to replay ' +
          'fixture mail into a real database. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / ' +
          'GOOGLE_REDIRECT_URI to connect a real account, or MANIFEST_ALLOW_FIXTURE_SYNC=1 if ' +
          'this is a scratch project where the demo data is the point.',
      };
    }

    return { ok: true, provider: new FixtureGoogleProvider(), credentialId: null };
  }

  const db = serviceClient();

  // The only place the token columns are read. Named explicitly rather than
  // via select('*') so the columns that migration 0020 withholds from the
  // operator's own role are visible at the one call site that needs them.
  const { data, error } = await db
    .from('google_credentials')
    .select('id, account_email, refresh_token, access_token, access_token_expires_at, scopes')
    .is('revoked_at', null)
    .maybeSingle<{
      id: string;
      account_email: string;
      refresh_token: string;
      access_token: string | null;
      access_token_expires_at: string | null;
      scopes: string[];
    }>();

  if (error) {
    return { ok: false, reason: 'not_connected', detail: `Could not read the Google connection: ${error.message}` };
  }
  if (!data) {
    return {
      ok: false,
      reason: 'not_connected',
      detail: 'No Google account is connected. Connect one from the Sync screen.',
    };
  }

  return {
    ok: true,
    credentialId: data.id,
    provider: new LiveGoogleProvider(
      {
        accountEmail: data.account_email,
        refreshToken: data.refresh_token,
        accessToken: data.access_token,
        accessTokenExpiresAt: data.access_token_expires_at,
        scopes: data.scopes,
      },
      { clientId: google.clientId, clientSecret: google.clientSecret },
    ),
  };
}

/**
 * Writes back an access token the provider refreshed mid-run.
 *
 * Purely an optimization — a token that is not saved is re-fetched on the next
 * run, which costs one round trip and nothing else. It is done after the run
 * rather than during it so a failed sync cannot leave the credential row
 * inconsistent with what actually happened.
 */
export async function persistRefreshedToken(
  credentialId: string | null,
  provider: GoogleProvider,
): Promise<void> {
  if (!credentialId || !(provider instanceof LiveGoogleProvider) || !provider.refreshed) return;

  await serviceClient()
    .from('google_credentials')
    .update({
      access_token: provider.refreshed.accessToken,
      access_token_expires_at: provider.refreshed.expiresAt,
      scopes: provider.refreshed.scopes.length > 0 ? provider.refreshed.scopes : undefined,
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: null,
    } as never)
    .eq('id', credentialId);
}

export { FixtureGoogleProvider } from './fixture';
export { LiveGoogleProvider, authorizeUrl, exchangeCode, GoogleApiError } from './live';
export type { GoogleProvider } from './provider';
