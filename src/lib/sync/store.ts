/**
 * The database operations sync performs, as an interface.
 *
 * This exists for one reason, and it is the same reason PGlite is the test
 * harness: the Phase 2 claims worth making are database-level. "An outbound
 * email promotes nobody", "their reply promotes them", "a re-run writes
 * nothing", "a later message the same day supersedes rather than duplicates" —
 * none of those can be demonstrated by asserting on a mock. They need real
 * triggers, real constraints, real unique indexes.
 *
 * But the production path goes through PostgREST, and PostgREST needs a server.
 * So the engine is written against this port instead, with two adapters: the
 * supabase-js one below, and a direct-SQL one in tests/helpers/sync-store.ts
 * that runs against the same in-process Postgres every other test uses. The
 * engine cannot tell them apart, which means `npm run ci` exercises the whole
 * pipeline — against real triggers — with no Docker, no Supabase project and no
 * network.
 *
 * Every method maps to one statement. Nothing here composes logic; the logic is
 * in gmail.ts and calendar.ts, above the port, where both adapters share it.
 */

import type { TouchChannel, TouchDirection, TouchSource } from '../db/enums';

export type SyncChannelName = 'gmail' | 'gcal';

export type TouchpointAction = 'inserted' | 'superseded' | 'unchanged';

export type RecordTouchpointArgs = {
  source: TouchSource;
  externalId: string;
  personId: string;
  channel: TouchChannel;
  direction: TouchDirection;
  occurredAt: string;
  subject: string | null;
  summary: string | null;
  substantive: boolean;
  externalUrl: string | null;
  /** Shared across one calendar event's attendee rows so the UI collapses them. */
  groupKey?: string | null;
};

export type StageArgs = {
  kind: 'gmail_suggestion' | 'calendar_suggestion';
  source: TouchSource;
  address: string;
  payload: Record<string, unknown>;
};

export type SeenMessage = {
  externalId: string;
  threadKey: string;
  personId: string | null;
  occurredAt: string;
  direction: TouchDirection;
  /**
   * The touchpoint this message ended up in, if any.
   *
   * Carried on the row rather than stitched on afterwards, because the ledger
   * is written last (see the ordering note in gmail.ts) — a separate update
   * would run before its target row existed and quietly match nothing.
   */
  touchpointId?: string | null;
};

export type RunPatch = {
  status: 'ok' | 'error' | 'skipped';
  cursorAfter?: string | null;
  counts?: Record<string, number>;
  error?: string | null;
};

export interface SyncStore {
  /** Current position for a channel. Null before the first run. */
  cursor(channel: SyncChannelName): Promise<string | null>;
  saveCursor(channel: SyncChannelName, cursor: string, detail: Record<string, unknown>): Promise<void>;

  startRun(channel: SyncChannelName, providerKind: 'live' | 'fixture', cursorBefore: string | null): Promise<string>;
  finishRun(runId: string, patch: RunPatch): Promise<void>;

  /**
   * Address → person id, for addresses that resolve to exactly one person.
   *
   * Matches on email_work and email_personal only. Section 7.5's matcher order
   * also includes LinkedIn and phone, which are unreachable from an email
   * header — a message carries an address and nothing else, so an address is
   * the only key sync can use. Everything it fails to match becomes a review
   * item, which is where the operator's own knowledge does the rest.
   */
  matchByEmail(addresses: string[]): Promise<Map<string, string>>;

  /** Which of these message ids has sync already accounted for. */
  knownMessageIds(channel: SyncChannelName, externalIds: string[]): Promise<Set<string>>;
  recordMessages(channel: SyncChannelName, rows: SeenMessage[]): Promise<void>;

  recordTouchpoint(args: RecordTouchpointArgs): Promise<{ touchpointId: string; action: TouchpointAction }>;
  stage(args: StageArgs): Promise<{ stagingId: string; staged: boolean }>;
}
