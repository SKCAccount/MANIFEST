/**
 * The provider used when Google is not configured.
 *
 * Not a mock in the usual sense — nothing here is stubbed out or short-circuited.
 * It implements the same interface as `live.ts`, honours the same cursor
 * semantics, and returns the same shapes; the messages simply come from a JSON
 * file instead of an HTTPS call. Everything downstream is identical, which is
 * what lets `npm run ci` exercise the complete Phase 2 pipeline — matching,
 * direction, rollup, promotion, idempotency, staging, correction — on a machine
 * with no network and no credentials.
 *
 * The batches are the part worth understanding. Each call advances the cursor
 * by one batch, so a second run sees the second batch. That is not a
 * convenience for tests; it is the only way to reach the case that matters
 * most, where a reply lands in a thread the previous run already recorded and
 * the day has to be rewritten from outbound to mutual.
 *
 * Selected automatically by `resolveProvider()` when GOOGLE_CLIENT_ID is unset,
 * and reported as `provider_kind = 'fixture'` on every run it performs, so a
 * green sync against invented data can never be mistaken for a green sync
 * against the real mailbox.
 */

import calendarFixture from './fixtures/calendar.json';
import gmailFixture from './fixtures/gmail.json';
import { parseAddress, parseAddressList } from '../address';
import type {
  EventPage,
  GoogleProvider,
  ListOptions,
  MessagePage,
  ProviderAttendee,
  ProviderEvent,
  ProviderMessage,
} from './provider';
import { REQUIRED_SCOPES } from './provider';

type RawMessage = {
  id: string;
  threadId: string;
  dayOffset: number;
  time: string;
  subject: string;
  snippet: string;
  from: string;
  to: string;
  cc?: string;
  labelIds?: string[];
};

type RawAttendee = {
  email: string;
  name?: string;
  responseStatus?: string;
  self?: boolean;
  optional?: boolean;
  organizer?: boolean;
  resource?: boolean;
};

type RawEvent = {
  id: string;
  dayOffset: number;
  startTime: string;
  endTime: string;
  summary: string;
  status?: string;
  organizer?: string;
  attendees?: RawAttendee[];
  recurringEventId?: string;
};

/**
 * Fixture times are UTC and constrained to 13:00–22:00 (see the note in
 * gmail.json). Within that band a UTC instant and its America/New_York
 * rendering fall on the same calendar day year round, so a fixture written
 * against "five days ago" stays on the local day it was written for and the
 * rollup assertions do not become seasonal.
 */
function instantAt(dayOffset: number, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset, hours ?? 0, minutes ?? 0),
  ).toISOString();
}

function toMessage(raw: RawMessage): ProviderMessage {
  const from = parseAddress(raw.from);
  if (!from) throw new Error(`Fixture message ${raw.id} has an unparseable From header: ${raw.from}`);

  return {
    id: raw.id,
    threadId: raw.threadId,
    occurredAt: instantAt(raw.dayOffset, raw.time),
    subject: raw.subject,
    snippet: raw.snippet,
    from,
    to: parseAddressList(raw.to),
    cc: parseAddressList(raw.cc),
    permalink: `https://mail.google.com/mail/u/0/#all/${raw.id}`,
    labelIds: raw.labelIds ?? [],
  };
}

function toEvent(raw: RawEvent): ProviderEvent {
  const organizer = raw.organizer ? parseAddress(raw.organizer) : null;

  const attendees: ProviderAttendee[] = (raw.attendees ?? [])
    .filter((attendee) => !attendee.resource)
    .map((attendee) => ({
      address: attendee.email.toLowerCase(),
      name: attendee.name ?? null,
      responseStatus: (attendee.responseStatus as ProviderAttendee['responseStatus']) ?? 'needsAction',
      self: attendee.self === true,
      optional: attendee.optional === true,
      organizer: attendee.organizer === true,
    }));

  return {
    id: raw.id,
    recurringEventId: raw.recurringEventId ?? null,
    summary: raw.summary,
    startAt: instantAt(raw.dayOffset, raw.startTime),
    endAt: instantAt(raw.dayOffset, raw.endTime),
    allDay: false,
    status: (raw.status as ProviderEvent['status']) ?? 'confirmed',
    organizer,
    attendees,
    permalink: `https://calendar.google.com/calendar/u/0/r/eventedit/${raw.id}`,
  };
}

/** Cursors are batch indexes as strings; anything unparseable restarts at zero. */
function batchIndex(cursor: string | null): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export class FixtureGoogleProvider implements GoogleProvider {
  readonly kind = 'fixture' as const;
  readonly accountEmail: string;
  readonly scopes: string[] = [...REQUIRED_SCOPES];

  private readonly messageBatches: ProviderMessage[][];
  private readonly eventBatches: ProviderEvent[][];

  /**
   * How far "now" has advanced.
   *
   * The batches are not just pages — they are points in time. Batch 1 holds a
   * reply that has not been sent yet when batch 0 is being processed, so
   * `getThread` must not reveal it: a real `threads.get` returns the messages
   * that exist at the moment it is called, and a fixture that returned
   * tomorrow's reply today would make the supersede test pass by never
   * producing an outbound-only day in the first place.
   *
   * It only ever moves forward. Rewinding the cursor re-reads old batches, but
   * it does not un-send mail — which is exactly what a replay after a restored
   * backup should see.
   */
  private horizon = 0;

  constructor() {
    this.accountEmail = gmailFixture.operator;
    this.messageBatches = (gmailFixture.batches as RawMessage[][]).map((batch) => batch.map(toMessage));
    this.eventBatches = (calendarFixture.batches as RawEvent[][]).map((batch) => batch.map(toEvent));
  }

  async listMessages(cursor: string | null): Promise<MessagePage> {
    const index = batchIndex(cursor);
    this.horizon = Math.max(this.horizon, index);
    const messages = this.messageBatches[index] ?? [];
    // Past the end, the cursor stops moving. Re-running then returns nothing
    // and changes nothing, which is what a quiet mailbox looks like and what a
    // repeated "Sync now" must do.
    const next = Math.min(index + 1, this.messageBatches.length);
    return { messages, cursor: String(next), complete: true };
  }

  async listEvents(cursor: string | null): Promise<EventPage> {
    const index = batchIndex(cursor);
    const events = this.eventBatches[index] ?? [];
    const next = Math.min(index + 1, this.eventBatches.length);
    return { events, cursor: String(next), complete: true };
  }

  /**
   * Every message in the thread that exists as of now — across earlier batches
   * as well as the current one, since a real thread does not forget its
   * earlier messages because sync last looked at it yesterday.
   */
  async getThread(threadId: string): Promise<ProviderMessage[]> {
    return this.visibleMessages()
      .filter((message) => message.threadId === threadId)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }

  private visibleMessages(): ProviderMessage[] {
    return this.messageBatches.slice(0, this.horizon + 1).flat();
  }

  async searchByAddress(address: string, options: ListOptions = {}): Promise<ProviderMessage[]> {
    const target = address.trim().toLowerCase();
    const floor = options.since ? Date.parse(options.since) : null;

    return this.visibleMessages()
      .filter((message) => {
        if (floor !== null && Date.parse(message.occurredAt) < floor) return false;
        return [message.from, ...message.to, ...message.cc].some((party) => party.address === target);
      })
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt))
      .slice(0, options.limit ?? 200);
  }
}
