'use server';

/**
 * The operator's side of sync: working the review queue, and running a job by
 * hand.
 *
 * Everything here goes through requireOperatorForAction() first. The sync jobs
 * themselves then use the service client — they write to tables the operator's
 * own role deliberately cannot write to (sync_runs, sync_messages,
 * google_credentials) — so the authorization check here is the only thing
 * standing in front of them. It is not defence in depth; it is the defence.
 */

import { revalidatePath } from 'next/cache';
import { requireOperatorForAction, supabase } from '../auth';
import { runCalendarSync } from '../sync/calendar';
import { syncConfig } from '../sync/config';
import { backfillAddress } from '../sync/backfill';
import { runGmailSync } from '../sync/gmail';
import { persistRefreshedToken, resolveProvider } from '../sync/google';
import { supabaseSyncStore } from '../sync/store-supabase';
import { summarizeAll } from '../sync/summarize';
import { serviceClient } from '../db/client';
import { toActionError, type ActionResult } from '../validation';

function refreshSyncSurfaces() {
  revalidatePath('/sync');
  revalidatePath('/review');
  // A run can promote a watchlist entry and change what is due, so the two
  // screens built on those are stale the moment it finishes.
  revalidatePath('/');
  revalidatePath('/watchlist');
}

// ---------------------------------------------------------------------------
// Running a job
// ---------------------------------------------------------------------------

export type SyncRunSummary = {
  channel: 'gmail' | 'gcal';
  providerKind: 'live' | 'fixture';
  complete: boolean;
  counts: Record<string, number>;
};

export async function runSyncNow(channel: 'gmail' | 'gcal'): Promise<ActionResult<SyncRunSummary>> {
  try {
    await requireOperatorForAction();

    const config = syncConfig();
    if (!config.ok) throw new Error(config.detail);

    const resolution = await resolveProvider();
    if (!resolution.ok) throw new Error(resolution.detail);

    const { provider } = resolution;
    const store = supabaseSyncStore();

    const result =
      channel === 'gmail'
        ? await runGmailSync({
            provider,
            store,
            ownDomains: config.config.ownDomains,
            label: config.config.gmailLabel,
            summarize: (days) => summarizeAll(days),
          })
        : await runCalendarSync({ provider, store, ownDomains: config.config.ownDomains });

    await persistRefreshedToken(resolution.credentialId, provider);
    refreshSyncSurfaces();

    return {
      ok: true,
      data: {
        channel,
        providerKind: result.providerKind,
        complete: result.complete,
        counts: result.counts as unknown as Record<string, number>,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// Working the review queue
// ---------------------------------------------------------------------------

/**
 * "That address is Amanda."
 *
 * Two steps that have to happen together and do: the database function writes
 * the address onto the person and closes the suggestion in one transaction,
 * then the backfill goes and gets the history that justified the suggestion in
 * the first place.
 *
 * The backfill is deliberately not inside that transaction. It talks to Google,
 * so it can be slow and it can fail, and neither should be able to undo a
 * decision the operator has already made. If it fails, the address is still
 * attached and the next ordinary run picks the person up from there — the cost
 * is missing history, not a wrong record.
 */
export async function attachSuggestion(
  stagingId: string,
  personId: string,
): Promise<ActionResult<{ field: string; backfilled: number; backfillError: string | null }>> {
  try {
    await requireOperatorForAction();

    const db = await supabase();
    const { data, error } = await db.rpc('fn_sync_attach_suggestion', {
      p_staging_id: stagingId,
      p_person_id: personId,
    });
    if (error) throw new Error(error.message);

    const attached = (data as Array<{ person_id: string; field: string }>)[0];
    if (!attached) throw new Error('Nothing came back from the attach.');

    const { data: staged } = await db
      .from('staging_records')
      .select('external_id')
      .eq('id', stagingId)
      .maybeSingle();

    let backfilled = 0;
    let backfillError: string | null = null;

    if (staged?.external_id) {
      try {
        const config = syncConfig();
        const resolution = await resolveProvider();
        if (config.ok && resolution.ok) {
          const result = await backfillAddress({
            provider: resolution.provider,
            store: supabaseSyncStore(),
            ownDomains: config.config.ownDomains,
            personId,
            address: staged.external_id,
            summarize: (days) => summarizeAll(days),
          });
          backfilled = result.inserted + result.superseded;
          await persistRefreshedToken(resolution.credentialId, resolution.provider);
        }
      } catch (error) {
        backfillError = error instanceof Error ? error.message : String(error);
      }
    }

    refreshSyncSurfaces();
    revalidatePath(`/person/${personId}`);
    return { ok: true, data: { field: attached.field, backfilled, backfillError } };
  } catch (error) {
    return toActionError(error);
  }
}

/** Permanent, and meant to be: sync will not raise the same address again. */
export async function rejectSuggestion(stagingId: string, note?: string): Promise<ActionResult> {
  try {
    await requireOperatorForAction();

    const db = await supabase();
    const { error } = await db.rpc('fn_sync_reject_suggestion', {
      p_staging_id: stagingId,
      p_note: note?.trim() || null,
    });
    if (error) throw new Error(error.message);

    revalidatePath('/review');
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}

// ---------------------------------------------------------------------------
// The Google connection
// ---------------------------------------------------------------------------

/**
 * Disconnects, by revoking the row rather than deleting it.
 *
 * Keeping the row keeps the history: when it was connected, when it was
 * revoked, and under which account. The partial unique index that allows only
 * one live credential is scoped to `revoked_at is null`, so a revoked row does
 * not block reconnecting.
 *
 * Note what this does not do — it does not revoke the grant at Google's end.
 * Nothing here can; that is done from the operator's own account page, and the
 * Sync screen says so rather than implying this button was enough.
 */
export async function disconnectGoogle(): Promise<ActionResult> {
  try {
    await requireOperatorForAction();

    const { error } = await serviceClient()
      .from('google_credentials')
      .update({
        revoked_at: new Date().toISOString(),
        // The point of disconnecting is that the tokens stop existing here.
        access_token: null,
        access_token_expires_at: null,
      } as never)
      .is('revoked_at', null);

    if (error) throw new Error(error.message);

    refreshSyncSurfaces();
    return { ok: true, data: undefined };
  } catch (error) {
    return toActionError(error);
  }
}
