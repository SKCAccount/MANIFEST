/**
 * The Calendar run.
 *
 * Shorter than Gmail's because there is no rollup: one event is one meeting and
 * already produces one row per external attendee, which is why
 * `touchpoints_external_key` carries person_id (0006). What Calendar needs
 * instead is a set of judgements about *who was actually there*, and those
 * matter more than anything in the Gmail path — because channel = 'meeting'
 * qualifies for promotion under trg_first_contact.
 *
 * That is the thing to hold on to when editing this file. A calendar entry can
 * turn a name the operator has never spoken to into an active relationship. An
 * invitation is not a meeting; a meeting somebody declined is not contact; and
 * a webinar with sixty registrants is not sixty relationships. Each rule below
 * exists to stop one of those from silently promoting someone.
 */

import { createHash } from 'node:crypto';
import { isMachineAddress, isOwnAddress } from './classify';
import { BACKFILL_DAYS, MAX_MEETING_ATTENDEES, MAX_MESSAGES_PER_RUN } from './config';
import type { GoogleProvider, ProviderAttendee, ProviderEvent } from './google/provider';
import type { SeenMessage, SyncStore, TouchpointAction } from './store';

export type CalendarCounts = {
  eventsSeen: number;
  eventsNew: number;
  eventsCounted: number;
  attendees: number;
  inserted: number;
  superseded: number;
  unchanged: number;
  staged: number;
  skipped_cancelled: number;
  skipped_future: number;
  skipped_internal: number;
  skipped_large: number;
  skipped_self_declined: number;
  skipped_declined: number;
  skipped_machine: number;
};

export type CalendarRunResult = {
  runId: string;
  providerKind: 'live' | 'fixture';
  cursor: string | null;
  complete: boolean;
  counts: CalendarCounts;
};

export type CalendarRunOptions = {
  provider: GoogleProvider;
  store: SyncStore;
  ownDomains: readonly string[];
  limit?: number;
  /** Injectable so tests are not racing the clock. */
  now?: Date;
};

function emptyCounts(): CalendarCounts {
  return {
    eventsSeen: 0,
    eventsNew: 0,
    eventsCounted: 0,
    attendees: 0,
    inserted: 0,
    superseded: 0,
    unchanged: 0,
    staged: 0,
    skipped_cancelled: 0,
    skipped_future: 0,
    skipped_internal: 0,
    skipped_large: 0,
    skipped_self_declined: 0,
    skipped_declined: 0,
    skipped_machine: 0,
  };
}

/**
 * A stable group_key for one event's attendee rows.
 *
 * Derived from the event id rather than randomly generated, because a
 * correction to one attendee's row must land in the same group as the others.
 * A fresh uuid on every run would split a four-person dinner into four separate
 * entries in the timeline the first time anything about it changed.
 *
 * Shaped as a v5 UUID — the column is `uuid` and Postgres will not accept a
 * bare hash.
 */
export function stableGroupKey(eventId: string): string {
  const hash = createHash('sha1').update(`manifest:gcal:${eventId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Whether a meeting counts as substantive, and therefore resets a cadence clock.
 *
 * §4.5's rule is that only substantive touchpoints reset the clock, and the
 * example given for a non-substantive one is a conference handshake. A
 * scheduled meeting is on the other side of that line — it is time both people
 * agreed to spend — but not unconditionally:
 *
 *   - a fifteen-minute slot is a check-in, not a conversation
 *   - a six-person meeting is not six relationships being maintained; nobody
 *     leaves a room of six feeling they have caught up with each of the others
 *
 * The touchpoint is still written in both cases. It just does not tell the
 * queue that the relationship has been looked after.
 */
export function isSubstantiveMeeting(event: ProviderEvent, externalCount: number): boolean {
  const minutes = (Date.parse(event.endAt) - Date.parse(event.startAt)) / 60_000;
  return minutes >= 20 && externalCount <= 3;
}

export async function runCalendarSync(options: CalendarRunOptions): Promise<CalendarRunResult> {
  const { provider, store, ownDomains } = options;
  const now = options.now ?? new Date();
  const counts = emptyCounts();

  const cursorBefore = await store.cursor('gcal');
  const runId = await store.startRun('gcal', provider.kind, cursorBefore);

  try {
    const page = await provider.listEvents(cursorBefore, {
      limit: options.limit ?? MAX_MESSAGES_PER_RUN,
      since: cursorBefore
        ? undefined
        : new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    });
    counts.eventsSeen = page.events.length;

    const known = await store.knownMessageIds(
      'gcal',
      page.events.map((event) => event.id),
    );

    const ledger: SeenMessage[] = [];

    for (const event of page.events) {
      const isNew = !known.has(event.id);
      if (isNew) counts.eventsNew += 1;

      if (event.status === 'cancelled') {
        counts.skipped_cancelled += 1;
        continue;
      }

      // Only what has already happened. The sync-token query has no upper
      // bound by design (see live.ts), so future meetings arrive on every run
      // and are filtered here — a meeting on Thursday is not contact today,
      // and would promote a watchlist entry on the strength of an invitation.
      if (Date.parse(event.endAt) > now.getTime()) {
        counts.skipped_future += 1;
        continue;
      }

      // The operator turned it down, so whatever happened, he was not there.
      if (event.attendees.some((attendee) => attendee.self && attendee.responseStatus === 'declined')) {
        counts.skipped_self_declined += 1;
        continue;
      }

      const outsiders = event.attendees.filter(
        (attendee) => !attendee.self && !isOwnAddress(attendee.address, ownDomains),
      );
      // Room-booking systems and calendar bots are attendees as far as the API
      // is concerned. The provider already drops entries flagged as resources;
      // this catches the ones that present as ordinary addresses.
      const external = outsiders.filter((attendee) => !isMachineAddress(attendee.address));
      counts.skipped_machine += outsiders.length - external.length;

      if (external.length === 0) {
        counts.skipped_internal += 1;
        continue;
      }

      if (external.length > MAX_MEETING_ATTENDEES) {
        // A webinar, a company all-hands, an industry breakfast. Recording it
        // would promote every unknown attendee to `active` on the strength of
        // having been on the same invitation. Rooms like this are exactly what
        // the Sources screen and bulk event logging exist for, deliberately by
        // hand and with the operator deciding who he actually spoke to.
        counts.skipped_large += 1;
        continue;
      }

      counts.eventsCounted += 1;
      const groupKey = stableGroupKey(event.id);
      const substantive = isSubstantiveMeeting(event, external.length);

      const attending = external.filter((attendee) => attendeeWasThere(attendee) === true);
      const unconfirmed = external.filter((attendee) => attendeeWasThere(attendee) === null);
      counts.skipped_declined += external.length - attending.length - unconfirmed.length;

      const matches = await store.matchByEmail(attending.map((attendee) => attendee.address));

      for (const attendee of attending) {
        counts.attendees += 1;
        const personId = matches.get(attendee.address);

        if (!personId) {
          const { staged } = await store.stage({
            kind: 'calendar_suggestion',
            source: 'gcal',
            address: attendee.address,
            payload: {
              address: attendee.address,
              display_name: attendee.name,
              first_seen: event.startAt,
              last_seen: event.startAt,
              last_subject: event.summary,
              last_direction: 'mutual',
              permalink: event.permalink,
            },
          });
          if (staged) counts.staged += 1;
          continue;
        }

        const { touchpointId, action } = await store.recordTouchpoint({
          source: 'gcal',
          externalId: event.id,
          personId,
          // A meeting is two-way by definition, which is what makes this the
          // one synced channel that can promote a watchlist entry on its own.
          channel: 'meeting',
          direction: 'mutual',
          occurredAt: event.startAt,
          subject: event.summary || 'Meeting',
          summary: null,
          substantive,
          externalUrl: event.permalink || null,
          groupKey,
        });

        counts[action as TouchpointAction] += 1;

        ledger.push({
          // The event id alone, with person_id doing the disambiguating —
          // exactly the shape sync_messages' partial unique index was built
          // for, and the same reason touchpoints_external_key carries
          // person_id. Suffixing the address here would make the ledger keys
          // disagree with the knownMessageIds() lookup above, and every event
          // would read as new forever.
          externalId: event.id,
          threadKey: event.recurringEventId ?? event.id,
          personId,
          occurredAt: event.startAt,
          direction: 'mutual',
          touchpointId,
        });
      }

      // Nobody RSVPs to half the meetings they attend, so `needsAction` on a
      // past event is genuinely unknowable from here. It is neither recorded
      // (which could promote someone who never showed) nor dropped (which
      // would lose a real meeting) — it goes to the one person who remembers.
      for (const attendee of unconfirmed) {
        const { staged } = await store.stage({
          kind: 'calendar_suggestion',
          source: 'gcal',
          address: attendee.address,
          payload: {
            address: attendee.address,
            display_name: attendee.name,
            first_seen: event.startAt,
            last_seen: event.startAt,
            last_subject: event.summary,
            last_direction: 'unconfirmed',
            permalink: event.permalink,
            reason: 'Never responded to the invitation — confirm the meeting happened.',
          },
        });
        if (staged) counts.staged += 1;
      }
    }

    await store.recordMessages('gcal', ledger);

    const cursor = page.cursor ?? cursorBefore;
    if (cursor) {
      await store.saveCursor('gcal', cursor, { complete: page.complete, provider: provider.kind });
    }

    await store.finishRun(runId, { status: 'ok', cursorAfter: cursor, counts });
    return { runId, providerKind: provider.kind, cursor, complete: page.complete, counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.finishRun(runId, { status: 'error', counts, error: message });
    throw error;
  }
}

/**
 * true  — they were there
 * false — they declined
 * null  — they never said, and nobody can tell from here
 */
function attendeeWasThere(attendee: ProviderAttendee): boolean | null {
  if (attendee.responseStatus === 'accepted' || attendee.responseStatus === 'tentative') return true;
  if (attendee.responseStatus === 'declined') return false;
  return null;
}
