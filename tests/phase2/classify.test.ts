/**
 * The reading of a message, in isolation.
 *
 * No database and no provider — these are the pure decisions, and they are the
 * ones with consequences. `direction` in particular: get it backwards and every
 * unanswered email the operator ever sent promotes its recipient to an
 * established relationship, permanently, because an active record cannot be
 * returned to the watchlist.
 */

import { describe, expect, it } from 'vitest';
import { parseAddress, parseAddressList } from '../../src/lib/sync/address';
import {
  classify,
  isMachineAddress,
  isOwnAddress,
  MAX_EXTERNAL_RECIPIENTS,
  parseOwnDomains,
} from '../../src/lib/sync/classify';
import { localDate, rollUp, type RollupInput } from '../../src/lib/sync/rollup';

const OWN = ['seakingcapital.com'];

const address = (raw: string) => parseAddress(raw)!;

function message(overrides: Partial<Parameters<typeof classify>[0]> = {}) {
  return {
    from: address('Adrienne DeLisio <adrienne@naturallyny.org>'),
    to: [address('derek@seakingcapital.com')],
    cc: [],
    labelIds: ['INBOX'],
    ...overrides,
  };
}

describe('address parsing', () => {
  it('reads a display name and an address', () => {
    expect(parseAddress('Amanda Chen <amanda.chen@bluepoch.com>')).toEqual({
      address: 'amanda.chen@bluepoch.com',
      name: 'Amanda Chen',
    });
  });

  it('lower-cases the address but not the name', () => {
    expect(parseAddress('Amanda Chen <Amanda.Chen@BluePoch.com>')?.address).toBe(
      'amanda.chen@bluepoch.com',
    );
  });

  it('drops a display name that is just the address again', () => {
    expect(parseAddress('amanda@bluepoch.com <amanda@bluepoch.com>')?.name).toBeNull();
  });

  it('keeps a quoted comma inside one recipient', () => {
    // The failure this prevents is silent: a naive split yields a valid address
    // with a mangled display name, which then drives a wrong match suggestion.
    const parsed = parseAddressList('"Chen, Amanda" <amanda@bluepoch.com>, bob@example.com');
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ address: 'amanda@bluepoch.com', name: 'Chen, Amanda' });
  });

  it('de-duplicates a repeated recipient', () => {
    expect(parseAddressList('a@x.com, A@X.com')).toHaveLength(1);
  });

  it('returns nothing rather than guessing at malformed input', () => {
    expect(parseAddress('not an address')).toBeNull();
    expect(parseAddress('bare@localhost')).toBeNull();
    expect(parseAddressList('')).toEqual([]);
  });
});

describe('own domains', () => {
  it('reads a comma-separated list, tolerating @ and case', () => {
    expect(parseOwnDomains('@SeaKingCapital.com, seakingsolutions.com')).toEqual([
      'seakingcapital.com',
      'seakingsolutions.com',
    ]);
  });

  it('is empty when unset, which is what makes the caller refuse to run', () => {
    expect(parseOwnDomains(undefined)).toEqual([]);
    expect(parseOwnDomains('   ')).toEqual([]);
  });

  it('recognizes the operator', () => {
    expect(isOwnAddress('derek@seakingcapital.com', OWN)).toBe(true);
    expect(isOwnAddress('derek@example.com', OWN)).toBe(false);
  });
});

describe('machine addresses', () => {
  it('catches the ones that cannot receive a reply', () => {
    for (const candidate of [
      'noreply@stripe.com',
      'no-reply@accounts.google.com',
      'mailer-daemon@googlemail.com',
      'bounces+7f3a-b21@sendgrid.net',
      'notifications@github.com',
    ]) {
      expect(isMachineAddress(candidate), candidate).toBe(true);
    }
  });

  it('leaves shared addresses a human might answer', () => {
    // A small firm's principal genuinely answers hello@. Refusing to record
    // that person is worse than occasionally asking about a robot.
    for (const candidate of ['hello@bluepoch.com', 'support@bluepoch.com', 'info@bluepoch.com']) {
      expect(isMachineAddress(candidate), candidate).toBe(false);
    }
  });
});

describe('direction', () => {
  it('is inbound when the sender is not us', () => {
    const verdict = classify(message(), OWN);
    expect(verdict).toMatchObject({ ok: true, direction: 'inbound' });
  });

  it('is outbound when the sender is us', () => {
    const verdict = classify(
      message({
        from: address('derek@seakingcapital.com'),
        to: [address('adrienne@naturallyny.org')],
      }),
      OWN,
    );
    expect(verdict).toMatchObject({ ok: true, direction: 'outbound' });
  });

  it('counts only the sender on inbound mail', () => {
    // Being CC'd alongside someone is not contact with them — and because
    // inbound qualifies for promotion, counting them would promote everyone on
    // an introduction email they merely appeared in.
    const verdict = classify(
      message({
        from: address('erica@gendellpartners.com'),
        to: [address('derek@seakingcapital.com')],
        cc: [address('amanda@kellermanfoods.com'), address('devon@harborlinecap.com')],
      }),
      OWN,
    );
    expect(verdict.ok && verdict.counterparties.map((c) => c.address)).toEqual([
      'erica@gendellpartners.com',
    ]);
  });

  it('counts every external recipient on outbound mail', () => {
    const verdict = classify(
      message({
        from: address('derek@seakingcapital.com'),
        to: [address('erica@gendellpartners.com')],
        cc: [address('amanda@kellermanfoods.com'), address('ops@seakingcapital.com')],
      }),
      OWN,
    );
    expect(verdict.ok && verdict.counterparties.map((c) => c.address)).toEqual([
      'erica@gendellpartners.com',
      'amanda@kellermanfoods.com',
    ]);
  });
});

describe('what is skipped', () => {
  it('anything Gmail filed as marketing or social', () => {
    expect(classify(message({ labelIds: ['CATEGORY_PROMOTIONS'] }), OWN)).toEqual({
      ok: false,
      reason: 'label',
    });
  });

  it('a message with no external party', () => {
    expect(
      classify(
        message({ from: address('derek@seakingcapital.com'), to: [address('ops@seakingcapital.com')] }),
        OWN,
      ),
    ).toEqual({ ok: false, reason: 'internal' });
  });

  it('an automated sender', () => {
    expect(classify(message({ from: address('noreply@stripe.com') }), OWN)).toEqual({
      ok: false,
      reason: 'machine',
    });
  });

  it('an announcement to more recipients than correspondence has', () => {
    const many = Array.from({ length: MAX_EXTERNAL_RECIPIENTS + 1 }, (_, index) =>
      address(`person${index}@example.com`),
    );
    expect(
      classify(message({ from: address('derek@seakingcapital.com'), to: many }), OWN),
    ).toEqual({ ok: false, reason: 'blast' });
  });

  it('but not one recipient short of that', () => {
    const many = Array.from({ length: MAX_EXTERNAL_RECIPIENTS }, (_, index) =>
      address(`person${index}@example.com`),
    );
    expect(classify(message({ from: address('derek@seakingcapital.com'), to: many }), OWN)).toMatchObject(
      { ok: true },
    );
  });
});

describe('the day boundary', () => {
  it('is the operator’s, not UTC’s', () => {
    // 02:00 UTC on the 5th is 9pm on the 4th in New York, and the touchpoint
    // belongs to the 4th — the same rule fn_local_date applies in the database.
    expect(localDate('2026-03-05T02:00:00Z')).toBe('2026-03-04');
    expect(localDate('2026-03-04T18:00:00Z')).toBe('2026-03-04');
  });
});

describe('rolling a thread into days', () => {
  const base = {
    threadId: 't1',
    subject: 'Receivables facility',
    snippet: '',
    permalink: 'https://mail.google.com/x',
    counterparty: { address: 'erica@gendellpartners.com', name: 'Erica Gendell' },
  };

  const day = (id: string, at: string, direction: 'inbound' | 'outbound'): RollupInput => ({
    ...base,
    messageId: id,
    occurredAt: at,
    direction,
  });

  it('makes a day with both sides mutual', () => {
    const [rolled] = rollUp([
      day('m1', '2026-03-04T14:00:00Z', 'outbound'),
      day('m2', '2026-03-04T20:00:00Z', 'inbound'),
    ]);
    expect(rolled!.direction).toBe('mutual');
  });

  it('leaves a day of one-sided effort one-sided', () => {
    const [rolled] = rollUp([
      day('m1', '2026-03-04T14:00:00Z', 'outbound'),
      day('m2', '2026-03-04T16:00:00Z', 'outbound'),
    ]);
    expect(rolled!.direction).toBe('outbound');
  });

  it('splits a thread that spans two days', () => {
    const rolled = rollUp([
      day('m1', '2026-03-04T14:00:00Z', 'outbound'),
      day('m2', '2026-03-05T14:00:00Z', 'inbound'),
    ]);
    expect(rolled).toHaveLength(2);
    expect(rolled.map((entry) => entry.key)).toEqual(['t1:2026-03-04', 't1:2026-03-05']);
  });

  it('dates the day to its last message, which is what recency wants', () => {
    const [rolled] = rollUp([
      day('m1', '2026-03-04T14:00:00Z', 'outbound'),
      day('m2', '2026-03-04T20:00:00Z', 'inbound'),
    ]);
    expect(rolled!.occurredAt).toBe('2026-03-04T20:00:00Z');
  });

  it('keeps one group per counterparty', () => {
    const rolled = rollUp([
      day('m1', '2026-03-04T14:00:00Z', 'outbound'),
      { ...day('m1', '2026-03-04T14:00:00Z', 'outbound'), counterparty: { address: 'b@x.com', name: null } },
    ]);
    expect(rolled).toHaveLength(2);
    expect(new Set(rolled.map((entry) => entry.address)).size).toBe(2);
  });
});
