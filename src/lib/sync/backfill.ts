/**
 * History for a person sync has only just learned about.
 *
 * When the operator resolves a review item — "that address is Amanda" — the
 * cursor has long since moved past everything Amanda ever sent. Without this,
 * the record he just confirmed would start with an empty timeline, which is
 * exactly backwards: the reason she was suggested at all is that there was
 * correspondence.
 *
 * So accepting a suggestion runs a bounded `from:x OR to:x` search for that one
 * address and writes the thread-days it finds. Everything downstream is the
 * same code the ordinary Gmail run uses — same classification, same rollup,
 * same idempotent write — so a backfill that overlaps mail already recorded
 * answers 'unchanged' rather than duplicating it.
 */

import { classify } from './classify';
import { BACKFILL_DAYS } from './config';
import type { GoogleProvider } from './google/provider';
import { rollUp, type RollupInput } from './rollup';
import type { SeenMessage, SyncStore, TouchpointAction } from './store';
import type { ThreadSummary } from './summarize';

export type BackfillResult = {
  days: number;
  inserted: number;
  superseded: number;
  unchanged: number;
};

export async function backfillAddress(options: {
  provider: GoogleProvider;
  store: SyncStore;
  ownDomains: readonly string[];
  personId: string;
  address: string;
  summarize?: (days: ReturnType<typeof rollUp>) => Promise<Map<string, ThreadSummary>>;
  since?: string;
}): Promise<BackfillResult> {
  const { provider, store, ownDomains, personId } = options;
  const address = options.address.trim().toLowerCase();

  const messages = await provider.searchByAddress(address, {
    since: options.since ?? new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
  });

  const inputs: RollupInput[] = [];
  const ledger: SeenMessage[] = [];

  for (const message of messages) {
    const verdict = classify(message, ownDomains);
    if (!verdict.ok) continue;

    // Only this address. A search for `to:amanda` legitimately returns threads
    // where she was one of several recipients, and the others are not what the
    // operator just confirmed — they get found by the ordinary run, or stay in
    // the review queue where they belong.
    const counterparty = verdict.counterparties.find((party) => party.address === address);
    if (!counterparty) continue;

    inputs.push({
      messageId: message.id,
      threadId: message.threadId,
      occurredAt: message.occurredAt,
      subject: message.subject,
      snippet: message.snippet,
      permalink: message.permalink,
      direction: verdict.direction,
      counterparty,
    });
  }

  const days = rollUp(inputs);
  const summaries = options.summarize ? await options.summarize(days) : new Map<string, ThreadSummary>();
  const result: BackfillResult = { days: days.length, inserted: 0, superseded: 0, unchanged: 0 };

  for (const day of days) {
    const summary = summaries.get(day.key);
    const { touchpointId, action } = await store.recordTouchpoint({
      source: 'gmail',
      externalId: day.key,
      personId,
      channel: 'email',
      direction: day.direction,
      occurredAt: day.occurredAt,
      subject: day.subject || null,
      summary: summary?.summary?.trim() || null,
      substantive: summary?.substantive ?? false,
      externalUrl: day.permalink,
    });

    result[action as TouchpointAction] += 1;

    for (const messageId of day.messageIds) {
      ledger.push({
        externalId: messageId,
        threadKey: day.threadId,
        personId,
        occurredAt: day.occurredAt,
        direction: day.direction === 'mutual' ? 'mutual' : day.direction,
        touchpointId,
      });
    }
  }

  await store.recordMessages('gmail', ledger);
  return result;
}
