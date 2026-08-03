/**
 * Email address handling for sync.
 *
 * Deliberately small and deliberately conservative. This is not an RFC 5322
 * parser and does not try to be — it handles the shapes Gmail's API actually
 * returns in a `From` / `To` / `Cc` header, and returns nothing rather than
 * guessing when it sees something else.
 *
 * The reason for the caution is downstream: an address is what decides which
 * person a message belongs to, and matching the wrong person writes a
 * touchpoint onto a real relationship's timeline. A dropped address costs one
 * pending review item. A wrong one costs trust in the record.
 */

export type EmailAddress = {
  /** Lower-cased local@domain. */
  address: string;
  /** Display name as sent, if any. Used for the review screen's match hint. */
  name: string | null;
};

/** Shape check, not validation. Anything failing this is not routed anywhere. */
const ADDRESS_SHAPE = /^[^\s@,<>"]+@[^\s@,<>".]+\.[^\s@,<>"]+$/;

export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase().replace(/^<|>$/g, '');
  return ADDRESS_SHAPE.test(trimmed) ? trimmed : null;
}

export function domainOf(address: string | null | undefined): string | null {
  const normalized = normalizeAddress(address);
  if (!normalized) return null;
  const at = normalized.lastIndexOf('@');
  return at === -1 ? null : normalized.slice(at + 1);
}

/**
 * Parses one RFC 5322 address, e.g.
 *   Amanda Chen <amanda.chen@bluepoch.com>
 *   "Chen, Amanda" <amanda.chen@bluepoch.com>
 *   amanda.chen@bluepoch.com
 */
export function parseAddress(raw: string): EmailAddress | null {
  const value = raw.trim();
  if (!value) return null;

  const angled = value.match(/^(.*)<([^>]+)>\s*$/);
  if (angled) {
    const address = normalizeAddress(angled[2]);
    if (!address) return null;
    return { address, name: cleanDisplayName(angled[1]!, address) };
  }

  const address = normalizeAddress(value);
  return address ? { address, name: null } : null;
}

/**
 * Splits an address-list header on commas that are not inside quotes.
 *
 * The quoting matters more than it looks: `"Chen, Amanda" <a@b.com>` is a
 * single recipient, and a naive split turns it into two — one of which is the
 * fragment `"Chen` and the other a valid address with a mangled display name.
 * The address still parses, so the failure is silent and shows up much later as
 * a review item whose suggested match is wrong.
 */
export function parseAddressList(header: string | null | undefined): EmailAddress[] {
  if (!header) return [];

  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of header) {
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
    } else if (char === ',' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);

  const seen = new Set<string>();
  const out: EmailAddress[] = [];
  for (const part of parts) {
    const parsed = parseAddress(part);
    if (!parsed || seen.has(parsed.address)) continue;
    seen.add(parsed.address);
    out.push(parsed);
  }
  return out;
}

/**
 * A display name is only worth keeping if it is a name.
 *
 * Mail clients routinely set it to the address itself, which would make the
 * review screen's "Amanda Chen?" hint read "amanda.chen@bluepoch.com?" and its
 * trigram match run against an email address. Null is more useful than that.
 */
function cleanDisplayName(raw: string, address: string): string | null {
  const name = raw.trim().replace(/^"(.*)"$/s, '$1').replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (name.toLowerCase() === address) return null;
  if (normalizeAddress(name)) return null;
  return name;
}
