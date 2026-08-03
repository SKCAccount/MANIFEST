/**
 * The Gmail run.
 *
 * Deliberately free of `server-only` and of any direct database import: it
 * takes a provider and a store and does nothing else, which is what lets the
 * phase2 suite run it end to end against PGlite. Everything it decides is
 * decided in classify.ts and rollup.ts, both pure; everything it writes goes
 * through the store port.
 *
 * The ordering of the writes is the part to preserve if this is ever edited.
 * Touchpoints are written first, then the message ledger, then the cursor. Each
 * step is the permission slip for skipping work next time, so they have to be
 * granted in that order: a crash between any two costs a re-read, which is free
 * and idempotent. Reversed, a crash would mark messages as handled that were
 * never recorded, and nothing would ever look at them again — a silent,
 * permanent gap, which is the one failure mode a sync must not have.
 */

import { classify, type SkipReason } from './classify';
import { BACKFILL_DAYS, MAX_MESSAGES_PER_RUN } from './config';
import type { GoogleProvider, ProviderMessage } from './google/provider';
import { rollUp, type RollupInput, type ThreadDay } from './rollup';
import type { SeenMessage, SyncStore, TouchpointAction } from './store';
import type { ThreadSummary } from './summarize';

export type GmailCounts = {
  messagesSeen: number;
  messagesNew: number;
  threadsFetched: number;
  threadDays: number;
  inserted: number;
  superseded: number;
  unchanged: number;
  staged: number;
} & Record<`skipped_${SkipReason}`, number>;

export type GmailRunResult = {
  runId: string;
  providerKind: 'live' | 'fixture';
  cursor: string | null;
  complete: boolean;
  counts: GmailCounts;
};

export type Summarizer = (days: ThreadDay[]) => Promise<Map<string, ThreadSummary>>;

export type GmailRunOptions = {
  provider: GoogleProvider;
  store: SyncStore;
  ownDomains: readonly string[];
  /** Omitted in tests, so the pipeline is exercised without an API key. */
  summarize?: Summarizer;
  limit?: number;
  /**
   * MANIFEST_GMAIL_LABEL, when set. Empty means all mail, which is the settled
   * choice (README §11) — this is the escape hatch if the noise ever outweighs
   * the recall.
   *
   * Applied client-side rather than as a Gmail query, because the incremental
   * path reads `users.history.list`, which has no label filter. Filtering here
   * means the same rule holds on both the incremental and backfill paths
   * instead of silently applying to only one of them.
   */
  label?: string;
};

function emptyCounts(): GmailCounts {
  return {
    messagesSeen: 0,
    messagesNew: 0,
    threadsFetched: 0,
    threadDays: 0,
    inserted: 0,
    superseded: 0,
    unchanged: 0,
    staged: 0,
    skipped_label: 0,
    skipped_machine: 0,
    skipped_internal: 0,
    skipped_blast: 0,
    skipped_unparseable: 0,
  };
}

export async function runGmailSync(options: GmailRunOptions): Promise<GmailRunResult> {
  const { provider, store, ownDomains } = options;
  const counts = emptyCounts();

  const cursorBefore = await store.cursor('gmail');
  const runId = await store.startRun('gmail', provider.kind, cursorBefore);

  try {
    const page = await provider.listMessages(cursorBefore, {
      limit: options.limit ?? MAX_MESSAGES_PER_RUN,
      since: cursorBefore
        ? undefined
        : new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    counts.messagesSeen = page.messages.length;

    const known = await store.knownMessageIds(
      'gmail',
      page.messages.map((message) => message.id),
    );
    const label = options.label?.trim();
    const fresh = page.messages
      .filter((message) => !known.has(message.id))
      .filter((message) => {
        if (!label || message.labelIds.includes(label)) return true;
        counts.skipped_label += 1;
        return false;
      });
    counts.messagesNew = fresh.length;

    // Classify the new arrivals only, to decide which threads are worth
    // fetching. A thread whose every new message is a promotion or a machine
    // notice is not opened at all.
    const threadIds = new Set<string>();
    for (const message of fresh) {
      const verdict = classify(message, ownDomains);
      if (verdict.ok) threadIds.add(message.threadId);
      else counts[`skipped_${verdict.reason}`] += 1;
    }

    // Re-derive each affected thread from source rather than reconciling
    // against what a previous run believed. See GoogleProvider.getThread.
    const threadMessages: ProviderMessage[] = [];
    for (const threadId of threadIds) {
      threadMessages.push(...(await provider.getThread(threadId)));
      counts.threadsFetched += 1;
    }

    const inputs: RollupInput[] = [];
    const ledger = new Map<string, SeenMessage>();

    for (const message of threadMessages) {
      const verdict = classify(message, ownDomains);
      if (!verdict.ok) continue;

      for (const counterparty of verdict.counterparties) {
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

      ledger.set(message.id, {
        externalId: message.id,
        threadKey: message.threadId,
        personId: null,
        occurredAt: message.occurredAt,
        direction: verdict.direction,
      });
    }

    const freshIds = new Set(fresh.map((message) => message.id));

    // A thread-day is only rewritten when it actually contains something new.
    // Without this, every run would recompute every day of every touched
    // thread — harmless, because recordTouchpoint would answer 'unchanged',
    // but it would re-summarize each one, and the summarizer is the expensive
    // part of a run by a wide margin.
    const days = rollUp(inputs).filter((day) =>
      day.messageIds.some((messageId) => freshIds.has(messageId)),
    );
    counts.threadDays = days.length;

    const matches = await store.matchByEmail(days.map((day) => day.address));
    const matched = days.filter((day) => matches.has(day.address));
    const unmatched = days.filter((day) => !matches.has(day.address));

    const summaries = options.summarize ? await options.summarize(matched) : new Map<string, ThreadSummary>();

    for (const day of matched) {
      const personId = matches.get(day.address)!;
      const summary = summaries.get(day.key);

      const { touchpointId, action } = await store.recordTouchpoint({
        source: 'gmail',
        externalId: day.key,
        personId,
        channel: 'email',
        direction: day.direction,
        occurredAt: day.occurredAt,
        subject: day.subject || null,
        // Falls back to nothing rather than to a fabricated sentence. The
        // subject is already on the row and the permalink reaches the thread.
        summary: summary?.summary?.trim() || null,
        substantive: summary?.substantive ?? false,
        externalUrl: day.permalink,
      });

      counts[action as TouchpointAction] += 1;

      for (const messageId of day.messageIds) {
        const row = ledger.get(messageId);
        if (row) {
          row.personId = personId;
          row.touchpointId = touchpointId;
        }
      }
    }

    for (const day of unmatched) {
      const { staged } = await store.stage({
        kind: 'gmail_suggestion',
        source: 'gmail',
        address: day.address,
        payload: {
          address: day.address,
          display_name: day.displayName,
          first_seen: day.occurredAt,
          last_seen: day.occurredAt,
          last_subject: day.subject,
          last_direction: day.direction,
          permalink: day.permalink,
        },
      });
      if (staged) counts.staged += 1;
    }

    // Only now: the ledger, then the cursor. Both are permission to skip this
    // work next time, and neither should be granted before the work is done.
    await store.recordMessages('gmail', [...ledger.values()]);

    const cursor = page.cursor ?? cursorBefore;
    if (cursor) {
      await store.saveCursor('gmail', cursor, { complete: page.complete, provider: provider.kind });
    }

    await store.finishRun(runId, { status: 'ok', cursorAfter: cursor, counts });
    return { runId, providerKind: provider.kind, cursor, complete: page.complete, counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun(runId, { status: 'error', counts, error: message });
    throw error;
  }
}
