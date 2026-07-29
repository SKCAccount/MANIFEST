/**
 * Zod schemas — no unvalidated input reaches the database.
 *
 * These mirror database constraints rather than replacing them. What they add
 * is a message the operator can act on, so each test here asserts both that
 * the wrong input is rejected *and* that the rejection says something useful.
 */

import { describe, expect, it } from 'vitest';
import {
  bulkEventLogSchema,
  createActivePersonSchema,
  createWatchlistEntrySchema,
  databaseErrorToMessage,
  formToObject,
  logAttemptSchema,
  nullableCents,
  qualifiesAsContact,
  snoozeSchema,
  sourceSchema,
} from '../../src/lib/validation';

const validTouchpoint = { channel: 'call', direction: 'mutual', substantive: 'on', summary: 'Talked.' };

describe('createActivePersonSchema', () => {
  const base = {
    first_name: 'Nina',
    last_name: 'Okafor',
    email_work: 'nina@example.com',
    first_touchpoint: validTouchpoint,
  };

  it('accepts a person with a qualifying touchpoint', () => {
    const parsed = createActivePersonSchema.parse(base);
    expect(parsed.first_name).toBe('Nina');
    expect(parsed.tier).toBe('C');
    expect(parsed.first_touchpoint.substantive).toBe(true);
  });

  it('rejects an outbound-only first touchpoint, and says what to do instead', () => {
    const result = createActivePersonSchema.safeParse({
      ...base,
      first_touchpoint: { channel: 'email', direction: 'outbound', substantive: 'on' },
    });

    expect(result.success).toBe(false);
    const message = result.error!.issues[0]!.message;
    expect(message).toMatch(/two-way contact/i);
    expect(message).toMatch(/watchlist/i);
  });

  it('accepts an outbound meeting, because a meeting is two-way by definition', () => {
    const result = createActivePersonSchema.safeParse({
      ...base,
      first_touchpoint: { channel: 'meeting', direction: 'outbound' },
    });
    expect(result.success).toBe(true);
  });

  it('trims whitespace and drops empty optional fields to null', () => {
    const parsed = createActivePersonSchema.parse({
      ...base,
      first_name: '  Nina  ',
      position: '   ',
      city: '',
    });
    expect(parsed.first_name).toBe('Nina');
    expect(parsed.position).toBeNull();
    expect(parsed.city).toBeNull();
  });

  it('deduplicates array fields', () => {
    const parsed = createActivePersonSchema.parse({
      ...base,
      specialties: ['CPG', 'CPG', ' Tax ', ''],
    });
    expect(parsed.specialties).toEqual(['CPG', 'Tax']);
  });
});

describe('createWatchlistEntrySchema', () => {
  const base = {
    first_name: 'Curtis',
    last_name: 'Alderman',
    watchlist_reason:
      'Built a $40M shelf-stable brand without outside capital and wants to buy his co-packer.',
    linkedin_url: 'linkedin.com/in/curtisalderman',
  };

  it('accepts a reason plus one identifier', () => {
    expect(createWatchlistEntrySchema.safeParse(base).success).toBe(true);
  });

  it('rejects a missing reason', () => {
    const result = createWatchlistEntrySchema.safeParse({ ...base, watchlist_reason: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/reason is required/i);
  });

  it('rejects a reason too short to be a reason', () => {
    // The requirement exists to make bulk entry tedious. "worth meeting" is
    // not a reason, and accepting it would defeat the point.
    const result = createWatchlistEntrySchema.safeParse({ ...base, watchlist_reason: 'worth it' });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/in your own words/i);
  });

  it('rejects a record with no identifier at all', () => {
    const { linkedin_url, ...withoutIdentifier } = base;
    void linkedin_url;
    const result = createWatchlistEntrySchema.safeParse(withoutIdentifier);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/note, not a record/i);
  });

  it('accepts a phone number as the sole identifier', () => {
    const { linkedin_url, ...rest } = base;
    void linkedin_url;
    expect(createWatchlistEntrySchema.safeParse({ ...rest, phone_mobile: '(719) 555-0134' }).success).toBe(
      true,
    );
  });

  it('accepts an organization as the sole identifier', () => {
    const { linkedin_url, ...rest } = base;
    void linkedin_url;
    expect(
      createWatchlistEntrySchema.safeParse({ ...rest, new_organization_name: 'Alderman Provisions' })
        .success,
    ).toBe(true);
  });
});

describe('qualifiesAsContact', () => {
  const cases: Array<[string, string, boolean]> = [
    ['email', 'inbound', true],
    ['email', 'mutual', true],
    ['email', 'outbound', false],
    ['linkedin', 'outbound', false],
    ['meeting', 'outbound', true],
    ['call', 'mutual', true],
    ['system', 'outbound', false],
  ];

  for (const [channel, direction, expected] of cases) {
    it(`${direction} ${channel} → ${expected ? 'promotes' : 'does not promote'}`, () => {
      expect(qualifiesAsContact({ channel, direction })).toBe(expected);
    });
  }
});

describe('logAttemptSchema', () => {
  it('accepts an outbound channel', () => {
    expect(logAttemptSchema.safeParse({ person_id: crypto.randomUUID(), channel: 'linkedin' }).success).toBe(
      true,
    );
  });

  it('refuses "meeting", which would promote the record', () => {
    // Logging an attempt must never promote. The schema excludes the one
    // channel that would, so the UI cannot produce a promoting "attempt".
    const result = logAttemptSchema.safeParse({ person_id: crypto.randomUUID(), channel: 'meeting' });
    expect(result.success).toBe(false);
  });
});

describe('sourceSchema', () => {
  const event = {
    event_name: 'Broker Fest',
    event_year: '2026',
    kind: 'Conference',
    is_event_kind: 'on',
    occurred_on: '2026-03-04',
    cost_pass_cents: '1,890',
  };

  it('accepts an event with cost, year and date', () => {
    const parsed = sourceSchema.parse(event);
    expect(parsed.cost_pass_cents).toBe(189000);
    expect(parsed.event_year).toBe(2026);
  });

  it('rejects an event with no cost entered at all', () => {
    const { cost_pass_cents, ...withoutCost } = event;
    void cost_pass_cents;
    const result = sourceSchema.safeParse(withoutCost);
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/Zero is a valid answer/i);
  });

  it('accepts a cost of zero — blank and zero are different answers', () => {
    expect(sourceSchema.safeParse({ ...event, cost_pass_cents: '0' }).success).toBe(true);
  });

  it('rejects an event with no year', () => {
    const result = sourceSchema.safeParse({ ...event, event_year: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => /needs a year/i.test(i.message))).toBe(true);
  });

  it('rejects an event with no date, which horizon comparison needs', () => {
    const result = sourceSchema.safeParse({ ...event, occurred_on: '' });
    expect(result.success).toBe(false);
    expect(result.error!.issues.some((i) => /matched horizon/i.test(i.message))).toBe(true);
  });

  it('rejects cost on a non-event kind', () => {
    const result = sourceSchema.safeParse({
      event_name: 'Warm intro',
      kind: 'Referral',
      is_event_kind: '',
      cost_pass_cents: '500',
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/Only event kinds carry cost/i);
  });

  it('rejects an end date before the start', () => {
    const result = sourceSchema.safeParse({ ...event, ends_on: '2026-03-01' });
    expect(result.success).toBe(false);
  });
});

describe('nullableCents', () => {
  const cases: Array<[string, number | null]> = [
    ['4200', 420000],
    ['4,200', 420000],
    ['$4,200.00', 420000],
    ['0', 0],
    ['12.34', 1234],
    ['', null],
  ];

  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${expected}`, () => {
      expect(nullableCents.parse(input)).toBe(expected);
    });
  }

  it('rejects a negative amount', () => {
    expect(nullableCents.safeParse('-5').success).toBe(false);
  });

  it('rejects text', () => {
    expect(nullableCents.safeParse('a lot').success).toBe(false);
  });
});

describe('snoozeSchema', () => {
  it('accepts the three offered durations', () => {
    for (const days of [30, 60, 90]) {
      expect(snoozeSchema.safeParse({ person_id: crypto.randomUUID(), days }).success).toBe(true);
    }
  });

  it('rejects anything else', () => {
    expect(snoozeSchema.safeParse({ person_id: crypto.randomUUID(), days: 45 }).success).toBe(false);
  });
});

describe('bulkEventLogSchema', () => {
  it('requires at least one attendee', () => {
    const result = bulkEventLogSchema.safeParse({ source_id: crypto.randomUUID(), person_ids: [] });
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/at least one/i);
  });
});

describe('formToObject', () => {
  it('keeps a single value scalar and collapses repeats into an array', () => {
    const form = new FormData();
    form.set('first_name', 'Nina');
    form.append('specialties', 'CPG');
    form.append('specialties', 'Tax');

    const result = formToObject(form);
    expect(result.first_name).toBe('Nina');
    expect(result.specialties).toEqual(['CPG', 'Tax']);
  });

  it('round-trips a single array value through stringArray', () => {
    // A one-item checkbox group arrives as a scalar, which must still parse
    // as an array — otherwise selecting exactly one specialty would break.
    const form = new FormData();
    form.set('first_name', 'Nina');
    form.append('specialties', 'CPG');
    form.set('email_work', 'n@example.com');
    form.set('tp_channel', 'call');
    form.set('tp_direction', 'mutual');

    const raw = formToObject(form);
    const parsed = createActivePersonSchema.parse({
      ...raw,
      first_touchpoint: { channel: raw.tp_channel, direction: raw.tp_direction },
    });
    expect(parsed.specialties).toEqual(['CPG']);
  });
});

describe('databaseErrorToMessage', () => {
  const cases: Array<[string, RegExp]> = [
    ['new row violates check constraint "people_uncontacted_requires_reason"', /written reason/i],
    ['violates check constraint "people_uncontacted_requires_identifier"', /at least one identifier/i],
    ['manifest: touchpoints are append-only (attempted UPDATE on ...)', /cannot be edited/i],
    ['manifest: an active person cannot be returned to the watchlist', /cannot un-meet/i],
    ['duplicate key value violates unique constraint "people_email_work_key"', /already has that email/i],
    ['manifest: Trade Show is an event kind and requires a cost breakdown', /what this event cost/i],
  ];

  for (const [raw, expected] of cases) {
    it(`translates ${raw.slice(0, 45)}…`, () => {
      expect(databaseErrorToMessage(raw)).toMatch(expected);
    });
  }

  it('strips the manifest prefix from anything it does not recognize', () => {
    expect(databaseErrorToMessage('manifest: something unusual')).toBe('something unusual');
  });
});
