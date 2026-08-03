import 'server-only';

/**
 * The production adapter for SyncStore: supabase-js over PostgREST.
 *
 * Uses the service client throughout. Sync runs from cron with no session, and
 * it writes to tables (`sync_runs`, `sync_messages`, `google_credentials`) that
 * the operator's own role deliberately cannot write to — so there is no signed-in
 * identity to borrow even when a run is triggered from the Sync screen.
 *
 * The mirror of this file is tests/helpers/sync-store.ts, which implements the
 * same interface against PGlite. They must stay behaviourally identical; the
 * phase2 suite is what proves the engine works, and it only ever sees that one.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from '../db/client';
import type { Database } from '../db/database.types';
import type {
  RecordTouchpointArgs,
  RunPatch,
  SeenMessage,
  StageArgs,
  SyncChannelName,
  SyncStore,
  TouchpointAction,
} from './store';

type Client = SupabaseClient<Database, 'manifest'>;

export function supabaseSyncStore(client: Client = serviceClient() as Client): SyncStore {
  return {
    async cursor(channel) {
      const { data } = await client
        .from('sync_state')
        .select('cursor')
        .eq('channel', channel)
        .maybeSingle();
      return data?.cursor ?? null;
    },

    async saveCursor(channel, cursor, detail) {
      const { error } = await client.from('sync_state').upsert(
        {
          channel,
          cursor,
          last_run_at: new Date().toISOString(),
          last_status: 'ok',
          last_error: null,
          detail: detail as never,
        },
        { onConflict: 'channel' },
      );
      if (error) throw new Error(`Could not save the ${channel} cursor: ${error.message}`);
    },

    async startRun(channel, providerKind, cursorBefore) {
      const { data, error } = await client
        .from('sync_runs')
        .insert({ channel, provider_kind: providerKind, cursor_before: cursorBefore, status: 'running' })
        .select('id')
        .single();
      if (error) throw new Error(`Could not open a sync run: ${error.message}`);
      return data.id;
    },

    async finishRun(runId, patch: RunPatch) {
      await client
        .from('sync_runs')
        .update({
          status: patch.status,
          finished_at: new Date().toISOString(),
          cursor_after: patch.cursorAfter ?? null,
          counts: (patch.counts ?? {}) as never,
          error: patch.error ?? null,
        })
        .eq('id', runId);
    },

    async matchByEmail(addresses) {
      const out = new Map<string, string>();
      const wanted = [...new Set(addresses.map((a) => a.toLowerCase()))].filter(Boolean);
      if (wanted.length === 0) return out;

      // Chunked because PostgREST puts the filter in the query string and a
      // first sync can present several hundred distinct addresses at once.
      for (let index = 0; index < wanted.length; index += 100) {
        const chunk = wanted.slice(index, index + 100);
        const list = chunk.map((address) => `"${address}"`).join(',');

        const { data, error } = await client
          .from('people')
          .select('id, email_work, email_personal')
          .or(`email_work.in.(${list}),email_personal.in.(${list})`);

        if (error) throw new Error(`Could not match addresses: ${error.message}`);

        for (const person of data ?? []) {
          for (const field of [person.email_work, person.email_personal]) {
            const address = field?.toLowerCase();
            if (address && chunk.includes(address)) out.set(address, person.id);
          }
        }
      }
      return out;
    },

    async knownMessageIds(channel, externalIds) {
      const seen = new Set<string>();
      if (externalIds.length === 0) return seen;

      for (let index = 0; index < externalIds.length; index += 200) {
        const chunk = externalIds.slice(index, index + 200);
        const { data, error } = await client
          .from('sync_messages')
          .select('external_id')
          .eq('channel', channel)
          .in('external_id', chunk);
        if (error) throw new Error(`Could not read the message ledger: ${error.message}`);
        for (const row of data ?? []) seen.add(row.external_id);
      }
      return seen;
    },

    async recordMessages(channel, rows: SeenMessage[]) {
      if (rows.length === 0) return;

      // Ignore duplicates rather than failing the run. Two overlapping cursors
      // legitimately present the same message twice, and the partial unique
      // indexes on sync_messages are what make that safe — this is the write
      // path relying on them, not working around them.
      const { error } = await client.from('sync_messages').upsert(
        rows.map((row) => ({
          channel,
          external_id: row.externalId,
          thread_key: row.threadKey,
          person_id: row.personId,
          occurred_at: row.occurredAt,
          direction: row.direction,
          touchpoint_id: row.touchpointId ?? null,
        })),
        { onConflict: 'channel,external_id,person_id', ignoreDuplicates: true },
      );
      if (error) throw new Error(`Could not record messages: ${error.message}`);
    },

    async recordTouchpoint(args: RecordTouchpointArgs) {
      const { data, error } = await client.rpc('fn_sync_record_touchpoint', {
        p_source: args.source,
        p_external_id: args.externalId,
        p_person_id: args.personId,
        p_channel: args.channel,
        p_direction: args.direction,
        p_occurred_at: args.occurredAt,
        p_subject: args.subject,
        p_summary: args.summary,
        p_substantive: args.substantive,
        p_external_url: args.externalUrl,
        p_group_key: args.groupKey ?? null,
      });

      if (error) throw new Error(`Could not record a touchpoint: ${error.message}`);
      const row = (data as Array<{ touchpoint_id: string; action: TouchpointAction }>)[0];
      if (!row) throw new Error('fn_sync_record_touchpoint returned nothing.');
      return { touchpointId: row.touchpoint_id, action: row.action };
    },

    async stage(args: StageArgs) {
      const { data, error } = await client.rpc('fn_sync_stage_person', {
        p_kind: args.kind,
        p_source: args.source,
        p_external_id: args.address,
        p_payload: args.payload as never,
      });

      if (error) throw new Error(`Could not stage ${args.address}: ${error.message}`);
      const row = (data as Array<{ staging_id: string; staged: boolean }>)[0];
      if (!row) throw new Error('fn_sync_stage_person returned nothing.');
      return { stagingId: row.staging_id, staged: row.staged };
    },
  };
}
