/**
 * The seam between MANIFEST and Google.
 *
 * Everything above this interface — matching, direction, rollup, promotion,
 * idempotency, staging — is real code that runs and is tested. Everything below
 * it is either a live HTTPS call (`live.ts`) or a canned payload (`fixture.ts`),
 * and the rest of the system cannot tell which.
 *
 * That split exists because there are no Google credentials for this project
 * yet. Rather than stub the pipeline and leave Phase 2 notional, the pipeline
 * is complete and only the transport is swapped: `npm run ci` exercises the
 * whole thing against fixtures on a machine with no network access, and when
 * credentials arrive, `GOOGLE_CLIENT_ID` in .env.local is the entire change.
 *
 * The consequence to be honest about: `live.ts` is written against Google's
 * documented API and has never been run against it. The fixtures below are
 * hand-built from that documentation, so they prove the pipeline is correct
 * given well-formed input — they cannot prove the input will be well-formed.
 * The first live run should be treated as a first run.
 */

/** What Gmail returns for a message, reduced to what this system uses. */
export type ProviderMessage = {
  id: string;
  threadId: string;
  /** ISO 8601. */
  occurredAt: string;
  subject: string;
  /**
   * Google's own ~200-character extract.
   *
   * This is the *only* content that crosses the seam, and it is never stored:
   * the summarizer reads it and the summary is what lands in the database.
   * `live.ts` requests `format=metadata`, so the message body is not merely
   * unstored — it is never fetched at all. That is a stronger and more easily
   * verified guarantee than "we delete it after", and it is the reason the
   * README can say bodies are never stored without qualification.
   */
  snippet: string;
  from: { address: string; name: string | null };
  to: Array<{ address: string; name: string | null }>;
  cc: Array<{ address: string; name: string | null }>;
  permalink: string;
  labelIds: string[];
};

export type ProviderAttendee = {
  address: string;
  name: string | null;
  responseStatus: 'accepted' | 'declined' | 'tentative' | 'needsAction';
  /** True for the operator's own entry in the attendee list. */
  self: boolean;
  optional: boolean;
  organizer: boolean;
};

export type ProviderEvent = {
  id: string;
  /** Set on one instance of a repeating series; the series id. */
  recurringEventId: string | null;
  summary: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: 'confirmed' | 'tentative' | 'cancelled';
  organizer: { address: string; name: string | null } | null;
  attendees: ProviderAttendee[];
  permalink: string;
};

export type MessagePage = {
  messages: ProviderMessage[];
  /** The cursor to persist. Null means "leave the stored cursor alone". */
  cursor: string | null;
  /**
   * False when the provider could not continue incrementally and returned a
   * bounded window instead — a Gmail historyId older than Google's retention,
   * or an expired Calendar syncToken. The run is still valid; it just did not
   * see everything, and the status screen says so rather than implying it did.
   */
  complete: boolean;
};

export type EventPage = {
  events: ProviderEvent[];
  cursor: string | null;
  complete: boolean;
};

export type ListOptions = {
  /** Hard cap per run, so one enormous backfill cannot run for an hour. */
  limit?: number;
  /** Floor for a first run or a recovered cursor. ISO 8601. */
  since?: string;
};

export interface GoogleProvider {
  /** Surfaced on every run and on the status screen. Fixture runs prove nothing about the real mailbox. */
  readonly kind: 'live' | 'fixture';
  readonly accountEmail: string;
  readonly scopes: string[];

  listMessages(cursor: string | null, options?: ListOptions): Promise<MessagePage>;
  listEvents(cursor: string | null, options?: ListOptions): Promise<EventPage>;

  /**
   * Every message in one thread.
   *
   * The rollup unit is a day of a thread, so when a reply arrives in a thread a
   * previous run already recorded, the day has to be rebuilt from all of its
   * messages — not merged with a half-remembered version of what was there
   * before. Fetching the thread makes that a re-derivation from source rather
   * than a reconciliation, which removes an entire class of bug: there is no
   * "what did we think yesterday" state to get wrong.
   *
   * It is also cheaper than it looks. `threads.get` returns every message's
   * metadata in one call, so a run that touches four threads makes four
   * requests regardless of how many messages moved.
   */
  getThread(threadId: string): Promise<ProviderMessage[]>;

  /**
   * Targeted history for one address.
   *
   * Used when the operator accepts a review suggestion. Sync has already moved
   * its cursor past that person's earlier mail, and a newly created record
   * would otherwise start with an empty timeline — which is exactly backwards,
   * since the reason they were suggested is that there was correspondence. A
   * bounded `from:x OR to:x` search is cheap and gives the new record the
   * history that justified creating it.
   */
  searchByAddress(address: string, options?: ListOptions): Promise<ProviderMessage[]>;
}

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';

/** Read-only, both services. Sync never writes to Google and never needs to. */
export const REQUIRED_SCOPES = [GMAIL_SCOPE, CALENDAR_SCOPE] as const;

export function hasScope(scopes: readonly string[], scope: string): boolean {
  return scopes.includes(scope);
}
