/**
 * Phase 2 configuration, and what each value being wrong actually costs.
 *
 * Same principle as lib/config.ts: a surface that cannot work should explain
 * itself rather than fail. The difference here is that one of these values —
 * MANIFEST_OWN_DOMAINS — cannot merely fail. It can succeed incorrectly, and
 * the damage is not reversible, so it gets a hard gate rather than a warning.
 */

import { parseOwnDomains } from './classify';

export type SyncConfig = {
  ownDomains: string[];
  /** Empty means all mail, which is the settled choice — see README §11. */
  gmailLabel: string;
  google: { clientId: string; clientSecret: string; redirectUri: string } | null;
};

export type SyncConfigStatus =
  | { ok: true; config: SyncConfig }
  | { ok: false; reason: 'no_own_domains'; detail: string };

export function syncConfig(): SyncConfigStatus {
  const ownDomains = parseOwnDomains(process.env.MANIFEST_OWN_DOMAINS);

  if (ownDomains.length === 0) {
    // Refusing to run is the entire point of this branch.
    //
    // With no own-domains every message the operator sent reads as inbound,
    // because "inbound" is defined as "the sender is not us". Every one of
    // those would qualify for promotion under trg_first_contact, and the whole
    // watchlist would flip to active on the strength of the operator's own
    // unanswered outreach — the exact failure the contact_status split exists
    // to prevent.
    //
    // And it does not undo. trg_people_validate forbids an active record from
    // returning to the watchlist ("you cannot un-meet someone"), so fixing the
    // variable and re-running does not repair it; every affected record has to
    // be reconstructed by hand. A sync that does nothing is recoverable. This
    // is not.
    return {
      ok: false,
      reason: 'no_own_domains',
      detail:
        'MANIFEST_OWN_DOMAINS is not set. Sync will not run without it: with no own-domains ' +
        'every message you sent reads as inbound, and inbound promotes. That would flip the ' +
        'entire watchlist to active, and an active record cannot be returned to the watchlist.',
    };
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  return {
    ok: true,
    config: {
      ownDomains,
      gmailLabel: (process.env.MANIFEST_GMAIL_LABEL ?? '').trim(),
      // All three or none. A client id without a secret is a half-configured
      // OAuth app that fails at the token exchange — after the operator has
      // gone through Google's consent screen, which is the worst place to
      // discover it.
      google:
        clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null,
    },
  };
}

/**
 * How far back a first run reaches.
 *
 * Six months is a compromise between two real costs. Shorter, and a
 * relationship whose last exchange was in the spring looks dead on the first
 * queue the operator sees. Longer, and the first run fetches tens of thousands
 * of messages, most of which are about people who are not in the rolodex and
 * never will be, generating a review queue nobody will ever finish.
 */
export const BACKFILL_DAYS = 180;

/** Per-run ceiling. A run that hits this is not broken; it resumes next time. */
export const MAX_MESSAGES_PER_RUN = 500;

/**
 * Above this many attendees, a calendar entry is an event rather than a meeting.
 *
 * Channel 'meeting' promotes, so a fifty-person webinar on the calendar would
 * otherwise promote fifty watchlist entries to active on the strength of an
 * invitation list. Genuine group meetings — both sides of a deal plus counsel —
 * do not reach twelve. Anything larger is what the Sources screen and bulk
 * event logging already exist to handle, deliberately by hand.
 */
export const MAX_MEETING_ATTENDEES = 12;
