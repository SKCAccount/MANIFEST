import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runCalendarSync } from '@/lib/sync/calendar';
import { syncConfig } from '@/lib/sync/config';
import { runGmailSync } from '@/lib/sync/gmail';
import { persistRefreshedToken, resolveProvider } from '@/lib/sync/google';
import { supabaseSyncStore } from '@/lib/sync/store-supabase';
import { summarizeAll } from '@/lib/sync/summarize';
import { SYNC_CHANNELS, type SyncChannel } from '@/lib/db/enums';

/**
 * The scheduled runs. `/api/cron/gmail` and `/api/cron/gcal`.
 *
 * There is no session here — cron is not a person — so the only thing standing
 * in front of a job that reads the operator's mail and writes to his rolodex is
 * CRON_SECRET. Two consequences, both deliberate:
 *
 *   - An unset CRON_SECRET refuses every request rather than allowing them.
 *     A misconfiguration that opens an endpoint is worse than one that closes
 *     it, and this endpoint is reachable from the internet.
 *   - The comparison is constant-time. A `!==` on a shared secret leaks its
 *     length and then its bytes to anyone patient enough to measure, and there
 *     is no reason to accept that when the fix is one function call.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  // Vercel cron sends the secret as a bearer token; a manual curl may send the
  // header instead. Both are the same secret.
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : (request.headers.get('x-cron-secret') ?? '');

  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal — so the lengths are compared first and the result folded in.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest, context: { params: Promise<{ channel: string }> }) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
  }

  const { channel } = await context.params;
  if (!SYNC_CHANNELS.includes(channel as SyncChannel)) {
    return NextResponse.json(
      { error: `Unknown channel "${channel}". Expected one of: ${SYNC_CHANNELS.join(', ')}.` },
      { status: 404 },
    );
  }

  const config = syncConfig();
  if (!config.ok) {
    // 503 rather than 500: the job is not broken, it is refusing to run. See
    // the note in lib/sync/config.ts on why an unset MANIFEST_OWN_DOMAINS is
    // not survivable.
    return NextResponse.json({ error: config.detail }, { status: 503 });
  }

  const resolution = await resolveProvider();
  if (!resolution.ok) {
    return NextResponse.json({ error: resolution.detail }, { status: 503 });
  }

  try {
    const store = supabaseSyncStore();
    const result =
      channel === 'gmail'
        ? await runGmailSync({
            provider: resolution.provider,
            store,
            ownDomains: config.config.ownDomains,
            label: config.config.gmailLabel,
            summarize: (days) => summarizeAll(days),
          })
        : await runCalendarSync({
            provider: resolution.provider,
            store,
            ownDomains: config.config.ownDomains,
          });

    await persistRefreshedToken(resolution.credentialId, resolution.provider);

    return NextResponse.json({
      channel,
      provider: result.providerKind,
      complete: result.complete,
      counts: result.counts,
    });
  } catch (error) {
    // The run has already recorded itself as failed in sync_runs before
    // rethrowing, so the Sync screen shows this even if nobody reads the cron
    // log — which nobody does.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ channel, error: message }, { status: 500 });
  }
}
