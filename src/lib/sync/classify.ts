/**
 * What a message means, before anything is written.
 *
 * Everything here is pure: no database, no network, no environment reads. That
 * is deliberate — these are the decisions that determine whether a watchlist
 * entry gets promoted, and they need to be testable exhaustively without a
 * Google account. `tests/phase2/classify.test.ts` is the real specification of
 * this file.
 *
 * The rule this all serves is the one in the README: promotion requires
 * two-way contact. Sync never has to know that rule, because it falls out of
 * getting `direction` right — an outbound email promotes nothing, and their
 * reply promotes them, enforced by trigger. So `direction` is the single most
 * consequential value this file produces, and getting `MANIFEST_OWN_DOMAINS`
 * wrong inverts it silently for every message at once.
 */

import { domainOf, normalizeAddress, type EmailAddress } from './address';

export type SkipReason =
  /** Gmail itself filed this as promotions, social, forums, spam or trash. */
  | 'label'
  /** Sender or every counterparty is an automated address. */
  | 'machine'
  /** Nobody outside the operator's own domains is involved. */
  | 'internal'
  /** More external recipients than correspondence plausibly has. */
  | 'blast'
  /** Nothing in the headers parsed as an address. */
  | 'unparseable';

export type Classified =
  | { ok: true; direction: 'inbound' | 'outbound'; counterparties: EmailAddress[] }
  | { ok: false; reason: SkipReason };

/**
 * Gmail's own categorisation, reused rather than re-derived.
 *
 * Google has already spent enormous effort deciding that a message is a
 * marketing blast, and it applies that judgement before the message reaches
 * this system. Ignoring it and writing a heuristic here would be strictly
 * worse. CATEGORY_UPDATES is deliberately *not* in this list — it holds
 * receipts and confirmations, but also a good deal of genuine one-to-one mail
 * from small senders, and excluding it loses real relationships.
 */
export const SKIPPED_LABELS = new Set([
  'SPAM',
  'TRASH',
  'CATEGORY_PROMOTIONS',
  'CATEGORY_SOCIAL',
  'CATEGORY_FORUMS',
]);

/**
 * Local parts that are never a person.
 *
 * Kept short and exact on purpose. It is tempting to add `support`, `sales`,
 * `info` and `hello` — but a small firm's principal genuinely answers
 * `hello@`, and a rolodex that silently refuses to record that person is worse
 * than one that occasionally asks about a robot. Everything here either cannot
 * receive replies or is a delivery-layer address.
 */
const MACHINE_LOCAL_PARTS = new Set([
  'noreply',
  'no-reply',
  'no_reply',
  'donotreply',
  'do-not-reply',
  'do_not_reply',
  'mailer-daemon',
  'mailerdaemon',
  'postmaster',
  'bounce',
  'bounces',
  'notification',
  'notifications',
  'automated',
  'auto-confirm',
  'calendar-notification',
]);

/** VERP and similar: `bounces+7f3a-b21@`, `no-reply-abc123@`. */
const MACHINE_PREFIXES = [/^bounces?[+\-_]/, /^no[-_.]?reply[+\-_]/, /^mailer-daemon[+\-_]/];

export function isMachineAddress(address: string | null | undefined): boolean {
  const normalized = normalizeAddress(address);
  if (!normalized) return false;
  const local = normalized.slice(0, normalized.lastIndexOf('@'));
  if (MACHINE_LOCAL_PARTS.has(local)) return true;
  return MACHINE_PREFIXES.some((pattern) => pattern.test(local));
}

export function isOwnAddress(address: string | null | undefined, ownDomains: readonly string[]): boolean {
  const domain = domainOf(address);
  return domain !== null && ownDomains.includes(domain);
}

/**
 * Above this many external recipients on one outbound message, it is an
 * announcement rather than correspondence.
 *
 * MANIFEST is explicitly not a mailing-list tool (README §11), and the surest
 * way to turn it into one by accident would be to let a single "we've moved
 * offices" email write forty touchpoints and forty review items. Eight is
 * generous for a real thread — a deal call with both sides and counsel on it
 * rarely exceeds six.
 */
export const MAX_EXTERNAL_RECIPIENTS = 8;

export type ClassifiableMessage = {
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  labelIds?: string[];
};

/**
 * Reads one message from the operator's point of view.
 *
 * The asymmetry between inbound and outbound is intentional and is the most
 * important judgement here:
 *
 *   outbound — every external address in To and Cc is a counterparty. The
 *              operator chose to write to each of them; that is a real, if
 *              one-sided, act of outreach and belongs on each record.
 *
 *   inbound  — only the sender. Being CC'd alongside someone is not contact
 *              with them. Counting other recipients would mean one introduction
 *              email from a third party silently created contact records for
 *              everyone on it — and because inbound qualifies for promotion,
 *              those records would be promoted to `active` on the strength of a
 *              message they merely appeared in.
 */
export function classify(message: ClassifiableMessage, ownDomains: readonly string[]): Classified {
  const labels = message.labelIds ?? [];
  if (labels.some((label) => SKIPPED_LABELS.has(label))) {
    return { ok: false, reason: 'label' };
  }

  const from = normalizeAddress(message.from?.address);
  if (!from) return { ok: false, reason: 'unparseable' };

  const fromIsOwn = isOwnAddress(from, ownDomains);

  if (!fromIsOwn) {
    if (isMachineAddress(from)) return { ok: false, reason: 'machine' };
    return { ok: true, direction: 'inbound', counterparties: [message.from] };
  }

  const recipients = [...message.to, ...message.cc].filter(
    (recipient) =>
      !isOwnAddress(recipient.address, ownDomains) && normalizeAddress(recipient.address) !== null,
  );

  if (recipients.length === 0) return { ok: false, reason: 'internal' };
  if (recipients.length > MAX_EXTERNAL_RECIPIENTS) return { ok: false, reason: 'blast' };

  const human = recipients.filter((recipient) => !isMachineAddress(recipient.address));
  if (human.length === 0) return { ok: false, reason: 'machine' };

  return { ok: true, direction: 'outbound', counterparties: human };
}

/**
 * Reads MANIFEST_OWN_DOMAINS.
 *
 * Returns an empty list rather than a default when unset. The caller must
 * refuse to sync on an empty list: with no own-domains, every message the
 * operator sent would read as inbound, every one of them would qualify for
 * promotion, and the entire watchlist would be promoted on the operator's own
 * unanswered effort. That is not a degraded sync — it is a corrupted rolodex,
 * and it is not recoverable by re-running with the right value, because
 * `contact_status` cannot go backwards (trg_people_validate).
 */
export function parseOwnDomains(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
    .filter((entry) => entry.length > 0 && entry.includes('.'));
}
