import 'server-only';

/**
 * The real Google client.
 *
 * Written against Google's documented Gmail and Calendar v3 APIs. It has never
 * been run against them — this project has no OAuth credentials yet — so it is
 * written to be conservative about the two things that are hardest to recover
 * from once they have happened:
 *
 *   1. Never fetch a message body. Every `messages.get` here asks for
 *      `format=metadata` with an explicit header allowlist. That is not a
 *      convention this code follows; it is the shape of the request, and Gmail
 *      will not return a body in response to it. The claim "bodies are never
 *      stored" is therefore true by construction rather than by discipline.
 *
 *   2. Never advance a cursor past work that was not done. The cursor is
 *      returned to the caller alongside the messages and is only persisted once
 *      those messages have been written. A crash mid-run costs a re-read, which
 *      is free, rather than a silent gap, which is invisible.
 *
 * Both cursor types can go stale — Gmail retains history for roughly a week,
 * Calendar sync tokens expire — and both failures return a normal-looking
 * response rather than an error. They are handled by falling back to a bounded
 * date window and reporting `complete: false`, so the status screen can say the
 * run was partial rather than implying it saw everything.
 */

import {
  type EventPage,
  type GoogleProvider,
  type ListOptions,
  type MessagePage,
  type ProviderAttendee,
  type ProviderEvent,
  type ProviderMessage,
} from './provider';
import { parseAddress, parseAddressList } from '../address';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary';

/**
 * Headers requested from `messages.get`. This list *is* the privacy boundary —
 * Gmail returns exactly these and nothing else when format=metadata.
 */
const METADATA_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'] as const;

const DEFAULT_LIMIT = 500;
const DEFAULT_BACKFILL_DAYS = 180;
/** Concurrent messages.get calls. Gmail's per-user limit is 250 quota units/sec; a get costs 5. */
const FETCH_CONCURRENCY = 8;

export type LiveCredentials = {
  accountEmail: string;
  refreshToken: string;
  accessToken?: string | null;
  accessTokenExpiresAt?: string | null;
  scopes?: string[];
};

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function authorizeUrl(options: { clientId: string; redirectUri: string; scopes: readonly string[]; state: string }): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scopes.join(' '),
    // Without both of these Google issues no refresh token on a re-consent,
    // and the connection silently lasts one hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: options.state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(options: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ refreshToken: string; accessToken: string; expiresAt: string; scopes: string[] }> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new GoogleApiError(`Token exchange failed (${response.status})`, response.status, text);
  }

  const payload = JSON.parse(text) as {
    refresh_token?: string;
    access_token: string;
    expires_in: number;
    scope?: string;
  };

  if (!payload.refresh_token) {
    // Google omits the refresh token when the user has already granted consent
    // and `prompt=consent` was not sent. Worth its own message: the symptom
    // otherwise is a connection that works until the access token expires.
    throw new GoogleApiError(
      'Google returned no refresh token. That happens when consent was already granted — revoke MANIFEST at myaccount.google.com/permissions and connect again.',
      response.status,
      text,
    );
  }

  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scopes: (payload.scope ?? '').split(' ').filter(Boolean),
  };
}

async function refreshAccessToken(options: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<{ accessToken: string; expiresAt: string; scopes: string[] }> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: options.refreshToken,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new GoogleApiError(
      response.status === 400 || response.status === 401
        ? 'Google rejected the refresh token. It was revoked, or the password changed. Reconnect from the Sync screen.'
        : `Token refresh failed (${response.status})`,
      response.status,
      text,
    );
  }

  const payload = JSON.parse(text) as { access_token: string; expires_in: number; scope?: string };
  return {
    accessToken: payload.access_token,
    expiresAt: new Date(Date.now() + payload.expires_in * 1000).toISOString(),
    scopes: (payload.scope ?? '').split(' ').filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// The provider
// ---------------------------------------------------------------------------

export class LiveGoogleProvider implements GoogleProvider {
  readonly kind = 'live' as const;
  readonly accountEmail: string;
  scopes: string[];

  private accessToken: string | null;
  private expiresAt: number;

  /** Set when a token was refreshed mid-run, so the caller can persist it. */
  refreshed: { accessToken: string; expiresAt: string; scopes: string[] } | null = null;

  constructor(
    credentials: LiveCredentials,
    private readonly oauth: { clientId: string; clientSecret: string },
  ) {
    this.accountEmail = credentials.accountEmail;
    this.scopes = credentials.scopes ?? [];
    this.accessToken = credentials.accessToken ?? null;
    this.expiresAt = credentials.accessTokenExpiresAt ? Date.parse(credentials.accessTokenExpiresAt) : 0;
    this.refreshToken = credentials.refreshToken;
  }

  private refreshToken: string;

  /** 60s of slack: a token that expires mid-request is a failure the retry cannot distinguish from a revocation. */
  private async token(): Promise<string> {
    if (this.accessToken && this.expiresAt > Date.now() + 60_000) return this.accessToken;

    const fresh = await refreshAccessToken({
      refreshToken: this.refreshToken,
      clientId: this.oauth.clientId,
      clientSecret: this.oauth.clientSecret,
    });

    this.accessToken = fresh.accessToken;
    this.expiresAt = Date.parse(fresh.expiresAt);
    if (fresh.scopes.length > 0) this.scopes = fresh.scopes;
    this.refreshed = fresh;
    return fresh.accessToken;
  }

  private async get<T>(url: string): Promise<T> {
    // Three attempts on the transient classes only. 429 and 5xx are Google
    // being busy; 4xx is this code being wrong and retrying it just wastes
    // quota and delays the real error.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${await this.token()}`, accept: 'application/json' },
      });

      if (response.ok) return (await response.json()) as T;

      const body = await response.text();
      const error = new GoogleApiError(`${response.status} from ${new URL(url).pathname}`, response.status, body);

      if (response.status === 429 || response.status >= 500) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1000));
        continue;
      }
      throw error;
    }
    throw lastError;
  }

  // -------------------------------------------------------------------------
  // Gmail
  // -------------------------------------------------------------------------

  async listMessages(cursor: string | null, options: ListOptions = {}): Promise<MessagePage> {
    const limit = options.limit ?? DEFAULT_LIMIT;

    if (cursor) {
      try {
        return await this.listMessagesIncremental(cursor, limit);
      } catch (error) {
        // Gmail retains history for about a week. A 404 here means the stored
        // historyId predates that, which is normal after any pause longer than
        // a holiday — not an error state, just a reason to fall back.
        if (!(error instanceof GoogleApiError) || error.status !== 404) throw error;
      }
    }

    return this.listMessagesWindow(options.since, limit, cursor !== null);
  }

  private async listMessagesIncremental(cursor: string, limit: number): Promise<MessagePage> {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latestHistoryId = cursor;

    do {
      const params = new URLSearchParams({
        startHistoryId: cursor,
        historyTypes: 'messageAdded',
        maxResults: '500',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await this.get<{
        history?: Array<{ id: string; messagesAdded?: Array<{ message: { id: string } }> }>;
        nextPageToken?: string;
        historyId?: string;
      }>(`${GMAIL_BASE}/history?${params.toString()}`);

      for (const record of page.history ?? []) {
        for (const added of record.messagesAdded ?? []) ids.add(added.message.id);
      }
      if (page.historyId) latestHistoryId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken && ids.size < limit);

    const messages = await this.fetchMessages([...ids].slice(0, limit));
    return { messages, cursor: latestHistoryId, complete: ids.size <= limit };
  }

  /**
   * First run, or recovery from an expired history id.
   *
   * The profile's historyId is read *before* the message list, not after. Read
   * after, any message arriving during the listing would fall between the two
   * calls and never be seen again — a permanent one-message gap that nothing
   * would ever report.
   */
  private async listMessagesWindow(since: string | undefined, limit: number, recovering: boolean): Promise<MessagePage> {
    const profile = await this.get<{ emailAddress: string; historyId: string }>(`${GMAIL_BASE}/profile`);

    const floor = since
      ? new Date(since)
      : new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000);
    const query = `after:${floor.getUTCFullYear()}/${floor.getUTCMonth() + 1}/${floor.getUTCDate()}`;

    const ids = await this.listMessageIds(query, limit);
    const messages = await this.fetchMessages(ids);

    // `complete` is false on recovery even when the window returned everything:
    // the window is bounded by date and the gap it is covering for is not, so
    // "we saw everything since the floor" is not "we saw everything".
    return { messages, cursor: profile.historyId, complete: !recovering && ids.length < limit };
  }

  private async listMessageIds(query: string, limit: number): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({ q: query, maxResults: '500' });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await this.get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
        `${GMAIL_BASE}/messages?${params.toString()}`,
      );
      for (const message of page.messages ?? []) ids.push(message.id);
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < limit);

    return ids.slice(0, limit);
  }

  private async fetchMessages(ids: string[]): Promise<ProviderMessage[]> {
    const out: ProviderMessage[] = [];

    // A fixed-size worker pool rather than Promise.all over everything: a
    // thousand simultaneous requests is a rate-limit incident, not throughput.
    // Gmail's batch endpoint would be faster still; it is multipart/mixed and
    // not worth the parsing until volume justifies it.
    const queue = [...ids];
    const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const id = queue.shift();
        if (!id) return;
        const message = await this.fetchMessage(id);
        if (message) out.push(message);
      }
    });

    await Promise.all(workers);
    return out.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }

  private async fetchMessage(id: string): Promise<ProviderMessage | null> {
    const params = new URLSearchParams({ format: 'metadata' });
    for (const header of METADATA_HEADERS) params.append('metadataHeaders', header);

    const raw = await this.get<GmailMessageResource>(`${GMAIL_BASE}/messages/${id}?${params.toString()}`);
    return toProviderMessage(raw);
  }

  async getThread(threadId: string): Promise<ProviderMessage[]> {
    const params = new URLSearchParams({ format: 'metadata' });
    for (const header of METADATA_HEADERS) params.append('metadataHeaders', header);

    const raw = await this.get<{ messages?: GmailMessageResource[] }>(
      `${GMAIL_BASE}/threads/${threadId}?${params.toString()}`,
    );

    return (raw.messages ?? [])
      .map(toProviderMessage)
      .filter((message): message is ProviderMessage => message !== null)
      .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  }

  async searchByAddress(address: string, options: ListOptions = {}): Promise<ProviderMessage[]> {
    const limit = options.limit ?? 200;
    const escaped = address.replace(/["\\]/g, '');
    const clauses = [`{from:"${escaped}" to:"${escaped}" cc:"${escaped}"}`];
    if (options.since) {
      const floor = new Date(options.since);
      clauses.push(`after:${floor.getUTCFullYear()}/${floor.getUTCMonth() + 1}/${floor.getUTCDate()}`);
    }

    const ids = await this.listMessageIds(clauses.join(' '), limit);
    return this.fetchMessages(ids);
  }

  // -------------------------------------------------------------------------
  // Calendar
  // -------------------------------------------------------------------------

  async listEvents(cursor: string | null, options: ListOptions = {}): Promise<EventPage> {
    if (cursor) {
      try {
        return await this.listEventsPaged({ syncToken: cursor }, options.limit ?? DEFAULT_LIMIT, true);
      } catch (error) {
        // 410 Gone is Google's documented signal that a sync token has expired.
        if (!(error instanceof GoogleApiError) || error.status !== 410) throw error;
      }
    }

    const floor =
      options.since ?? new Date(Date.now() - DEFAULT_BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Deliberately no timeMax. A sync token inherits the query that produced
    // it, so pinning an upper bound to "now" would produce a token that never
    // returns anything newer than this moment — a sync that appears to work and
    // silently stops seeing new meetings. Future events come back instead and
    // are filtered by the caller, which is cheap and cannot go stale.
    return this.listEventsPaged({ timeMin: floor }, options.limit ?? DEFAULT_LIMIT, cursor === null);
  }

  private async listEventsPaged(
    base: Record<string, string>,
    limit: number,
    incremental: boolean,
  ): Promise<EventPage> {
    const events: ProviderEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;

    do {
      const params = new URLSearchParams({
        ...base,
        // Expands a repeating meeting into its instances. Must stay identical
        // between the initial call and every syncToken call after it, or
        // Google rejects the token.
        singleEvents: 'true',
        maxResults: '250',
        // Cancellations arrive as status=cancelled rows and matter: an event
        // that was called off should not become a meeting touchpoint.
        showDeleted: 'true',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const page = await this.get<{
        items?: CalendarEventResource[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(`${CALENDAR_BASE}/events?${params.toString()}`);

      for (const item of page.items ?? []) {
        const event = toProviderEvent(item);
        if (event) events.push(event);
      }
      pageToken = page.nextPageToken;
      if (page.nextSyncToken) nextSyncToken = page.nextSyncToken;
    } while (pageToken && events.length < limit);

    return {
      events: events.slice(0, limit),
      cursor: nextSyncToken,
      complete: !pageToken && (incremental || events.length < limit),
    };
  }
}

// ---------------------------------------------------------------------------
// Google's wire shapes → ours
// ---------------------------------------------------------------------------

type GmailMessageResource = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: Array<{ name: string; value: string }> };
};

type CalendarEventResource = {
  id: string;
  recurringEventId?: string;
  summary?: string;
  status?: string;
  htmlLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    optional?: boolean;
    organizer?: boolean;
    resource?: boolean;
  }>;
};

export function toProviderMessage(raw: GmailMessageResource): ProviderMessage | null {
  const headers = new Map(
    (raw.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
  );

  const from = parseAddress(headers.get('from') ?? '');
  if (!from) return null;

  // internalDate is Gmail's own receipt timestamp in epoch milliseconds, and is
  // preferred over the Date header — which is set by the sending client and is
  // routinely wrong, occasionally by years.
  const occurredAt = raw.internalDate
    ? new Date(Number(raw.internalDate)).toISOString()
    : new Date(headers.get('date') ?? Date.now()).toISOString();

  return {
    id: raw.id,
    threadId: raw.threadId,
    occurredAt,
    subject: headers.get('subject') ?? '',
    snippet: raw.snippet ?? '',
    from,
    to: parseAddressList(headers.get('to')),
    cc: parseAddressList(headers.get('cc')),
    permalink: `https://mail.google.com/mail/u/0/#all/${raw.id}`,
    labelIds: raw.labelIds ?? [],
  };
}

export function toProviderEvent(raw: CalendarEventResource): ProviderEvent | null {
  const startAt = raw.start?.dateTime ?? (raw.start?.date ? `${raw.start.date}T00:00:00Z` : null);
  const endAt = raw.end?.dateTime ?? (raw.end?.date ? `${raw.end.date}T00:00:00Z` : null);
  if (!startAt || !endAt) return null;

  const organizerAddress = raw.organizer?.email?.toLowerCase() ?? null;

  const attendees: ProviderAttendee[] = (raw.attendees ?? [])
    // Conference rooms and equipment are attendees as far as the API is
    // concerned, and would otherwise become watchlist suggestions.
    .filter((attendee) => attendee.email && !attendee.resource)
    .map((attendee) => ({
      address: attendee.email!.toLowerCase(),
      name: attendee.displayName ?? null,
      responseStatus: (attendee.responseStatus as ProviderAttendee['responseStatus']) ?? 'needsAction',
      self: attendee.self === true,
      optional: attendee.optional === true,
      organizer: attendee.organizer === true || attendee.email!.toLowerCase() === organizerAddress,
    }));

  return {
    id: raw.id,
    recurringEventId: raw.recurringEventId ?? null,
    summary: raw.summary ?? '',
    startAt,
    endAt,
    allDay: Boolean(raw.start?.date),
    status: (raw.status as ProviderEvent['status']) ?? 'confirmed',
    organizer: raw.organizer?.email
      ? { address: raw.organizer.email.toLowerCase(), name: raw.organizer.displayName ?? null }
      : null,
    attendees,
    permalink: raw.htmlLink ?? '',
  };
}
