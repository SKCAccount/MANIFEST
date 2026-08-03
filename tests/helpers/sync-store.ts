/**
 * SyncStore over PGlite.
 *
 * The counterpart to src/lib/sync/store-supabase.ts. Same interface, same
 * statements, different transport — the engine cannot tell them apart, which is
 * the whole point: the phase2 suite runs the real Gmail and Calendar runs
 * against a real Postgres with real triggers, and needs no Docker, no Supabase
 * project, and no network to do it.
 *
 * Every method here is the SQL its supabase-js sibling generates. If the two
 * ever drift, the tests stop proving anything about production, so keep them
 * boring and keep them aligned.
 */

import type {
  RecordTouchpointArgs,
  RunPatch,
  SeenMessage,
  StageArgs,
  SyncChannelName,
  SyncStore,
  TouchpointAction,
} from '../../src/lib/sync/store';
import type { Harness } from './db';

/**
 * A Postgres array literal.
 *
 * PGlite passes a JS array through as a comma-joined string, which Postgres
 * then rejects as a malformed array literal. supabase-js does this conversion
 * for you; here it has to be explicit.
 */
function pgArray(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
}

export function pgliteSyncStore(h: Harness): SyncStore {
  return {
    async cursor(channel: SyncChannelName) {
      const rows = await h.sql<{ cursor: string | null }>(
        `select cursor from sync_state where channel = $1;`,
        [channel],
      );
      return rows[0]?.cursor ?? null;
    },

    async saveCursor(channel, cursor, detail) {
      await h.sql(
        `insert into sync_state (channel, cursor, last_run_at, last_status, detail)
         values ($1, $2, now(), 'ok', $3::jsonb)
         on conflict (channel) do update
           set cursor = excluded.cursor,
               last_run_at = excluded.last_run_at,
               last_status = excluded.last_status,
               last_error = null,
               detail = excluded.detail;`,
        [channel, cursor, JSON.stringify(detail)],
      );
    },

    async startRun(channel, providerKind, cursorBefore) {
      const rows = await h.sql<{ id: string }>(
        `insert into sync_runs (channel, provider_kind, cursor_before, status)
         values ($1, $2, $3, 'running')
         returning id;`,
        [channel, providerKind, cursorBefore],
      );
      return rows[0]!.id;
    },

    async finishRun(runId, patch: RunPatch) {
      await h.sql(
        `update sync_runs
            set status = $2,
                finished_at = now(),
                cursor_after = $3,
                counts = $4::jsonb,
                error = $5
          where id = $1;`,
        [runId, patch.status, patch.cursorAfter ?? null, JSON.stringify(patch.counts ?? {}), patch.error ?? null],
      );
    },

    async matchByEmail(addresses) {
      const wanted = [...new Set(addresses.map((address) => address.toLowerCase()))].filter(Boolean);
      const out = new Map<string, string>();
      if (wanted.length === 0) return out;

      const rows = await h.sql<{ id: string; email_work: string | null; email_personal: string | null }>(
        `select id, email_work::text, email_personal::text
           from people
          where email_work = any($1::citext[]) or email_personal = any($1::citext[]);`,
        [pgArray(wanted)],
      );

      for (const row of rows) {
        for (const field of [row.email_work, row.email_personal]) {
          const address = field?.toLowerCase();
          if (address && wanted.includes(address)) out.set(address, row.id);
        }
      }
      return out;
    },

    async knownMessageIds(channel, externalIds) {
      if (externalIds.length === 0) return new Set<string>();
      const rows = await h.sql<{ external_id: string }>(
        `select external_id from sync_messages where channel = $1 and external_id = any($2::text[]);`,
        [channel, pgArray(externalIds)],
      );
      return new Set(rows.map((row) => row.external_id));
    },

    async recordMessages(channel, rows: SeenMessage[]) {
      // One statement per row rather than a multi-row insert: PGlite's
      // parameter binding is simpler to keep honest this way, and the volumes
      // in a test are trivial. `on conflict do nothing` with no target covers
      // both partial unique indexes at once, matching the ignoreDuplicates
      // upsert on the production side.
      for (const row of rows) {
        await h.sql(
          `insert into sync_messages (channel, external_id, thread_key, person_id, occurred_at, direction, touchpoint_id)
           values ($1, $2, $3, $4, $5, $6, $7)
           on conflict do nothing;`,
          [
            channel,
            row.externalId,
            row.threadKey,
            row.personId,
            row.occurredAt,
            row.direction,
            row.touchpointId ?? null,
          ],
        );
      }
    },

    async recordTouchpoint(args: RecordTouchpointArgs) {
      const rows = await h.sql<{ touchpoint_id: string; action: TouchpointAction }>(
        `select touchpoint_id, action from fn_sync_record_touchpoint(
           $1::touch_source, $2, $3::uuid, $4::touch_channel, $5::touch_direction,
           $6::timestamptz, $7, $8, $9::boolean, $10, null, $11::uuid
         );`,
        [
          args.source,
          args.externalId,
          args.personId,
          args.channel,
          args.direction,
          args.occurredAt,
          args.subject,
          args.summary,
          args.substantive,
          args.externalUrl,
          args.groupKey ?? null,
        ],
      );
      return { touchpointId: rows[0]!.touchpoint_id, action: rows[0]!.action };
    },

    async stage(args: StageArgs) {
      const rows = await h.sql<{ staging_id: string; staged: boolean }>(
        `select staging_id, staged from fn_sync_stage_person(
           $1::staging_kind, $2::touch_source, $3, $4::jsonb, null
         );`,
        [args.kind, args.source, args.address, JSON.stringify(args.payload)],
      );
      return { stagingId: rows[0]!.staging_id, staged: rows[0]!.staged };
    },
  };
}
