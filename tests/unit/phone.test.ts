/**
 * Application-layer phone normalization.
 *
 * The database backstop is tested in tests/phase0/normalizers.test.ts. This
 * checks the version that runs on the way in, and that the two agree on the
 * canonical form — if they disagreed, a value would normalize differently
 * depending on whether it arrived through the form or through a sync job, and
 * the unique indexes would stop catching duplicates.
 */

import { describe, expect, it } from 'vitest';
import { formatPhone, isE164, normalizePhone, telHref } from '../../src/lib/phone.js';

describe('normalizePhone', () => {
  const cases: Array<[string, string]> = [
    ['(212) 555-0142', '+12125550142'],
    ['212-555-0142', '+12125550142'],
    ['212.555.0142', '+12125550142'],
    ['2125550142', '+12125550142'],
    ['1 212 555 0142', '+12125550142'],
    ['+1 (212) 555-0142', '+12125550142'],
    ['+12125550142', '+12125550142'],
    ['  212 555 0142  ', '+12125550142'],
    ['(212) 555-0142 x22', '+12125550142'],
    ['212-555-0142 ext. 105', '+12125550142'],
    ['+44 20 7946 0958', '+442079460958'],
  ];

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(normalizePhone(input)).toBe(expected);
    });
  }

  it('returns null for empty input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('   ')).toBeNull();
  });

  it('returns unrecognized input trimmed rather than inventing a country code', () => {
    expect(normalizePhone('  ask reception  ')).toBe('ask reception');
    expect(normalizePhone('555')).toBe('555');
  });

  it('honours a non-default country', () => {
    expect(normalizePhone('020 7946 0958', 'GB')).toBe('+442079460958');
  });
});

describe('isE164', () => {
  it('accepts canonical values', () => {
    expect(isE164('+12125550142')).toBe(true);
    expect(isE164('+442079460958')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isE164('2125550142')).toBe(false);
    expect(isE164('(212) 555-0142')).toBe(false);
    expect(isE164('ask reception')).toBe(false);
    expect(isE164(null)).toBe(false);
  });
});

describe('formatPhone', () => {
  it('shows US numbers in national form', () => {
    expect(formatPhone('+12125550142')).toBe('(212) 555-0142');
  });

  it('shows international numbers in their own convention', () => {
    expect(formatPhone('+442079460958')).toBe('+44 20 7946 0958');
  });

  it('shows unnormalized values exactly as entered', () => {
    expect(formatPhone('ask reception')).toBe('ask reception');
  });

  it('renders nothing for an absent number', () => {
    expect(formatPhone(null)).toBe('');
  });
});

describe('telHref', () => {
  it('produces a dialable link for a normalized number', () => {
    expect(telHref('+12125550142')).toBe('tel:+12125550142');
  });

  it('refuses to produce one for an unnormalized value', () => {
    expect(telHref('ask reception')).toBeNull();
  });
});
