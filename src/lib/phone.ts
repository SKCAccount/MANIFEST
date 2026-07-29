/**
 * Phone normalization at the application layer.
 *
 * The database has its own normalizer (fn_normalize_phone) as a backstop for
 * imports, sync jobs and direct SQL. This one runs first, on the way in, and is
 * more capable because libphonenumber-js knows every national numbering plan
 * rather than just NANP.
 *
 * Both agree on the contract: a value that cannot be normalized confidently is
 * returned trimmed rather than mangled, and v_data_quality reports it. Silently
 * inventing a country code is worse than an unnormalized value the operator can
 * see and fix.
 */

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';

const DEFAULT_COUNTRY: CountryCode = 'US';

/** Strips a trailing extension, which libphonenumber will otherwise absorb into the number. */
function stripExtension(raw: string): string {
  return raw.replace(/\s*(?:x|ext\.?|extension)\s*\d+\s*$/i, '').trim();
}

/**
 * Returns E.164 when the value parses, the trimmed input when it does not, and
 * null for empty input.
 */
export function normalizePhone(raw: string | null | undefined, country: CountryCode = DEFAULT_COUNTRY): string | null {
  if (raw === null || raw === undefined) return null;

  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const parsed = parsePhoneNumberFromString(stripExtension(trimmed), country);
  if (parsed?.isValid()) {
    return parsed.number;
  }

  return trimmed;
}

/** True when a stored value is in the canonical form the unique indexes rely on. */
export function isE164(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^\+[1-9]\d{6,14}$/.test(value);
}

/**
 * Formats for display. Stored normalized, displayed formatted — a US number
 * reads as (212) 555-0142, an international one in its own convention.
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '';
  if (!isE164(value)) return value; // unnormalized: show exactly what was entered

  const parsed = parsePhoneNumberFromString(value);
  if (!parsed) return value;

  return parsed.country === DEFAULT_COUNTRY ? parsed.formatNational() : parsed.formatInternational();
}

/** A tel: href, which is what makes the queue useful on a phone. */
export function telHref(value: string | null | undefined): string | null {
  return isE164(value) ? `tel:${value}` : null;
}
