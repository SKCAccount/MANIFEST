/**
 * Normalization is what makes the dedupe indexes real. If two spellings of the
 * same phone number do not collide, the unique index is decoration.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/db.js';
import { PERSON } from '../helpers/fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

async function normalizePhone(raw: string | null): Promise<string | null> {
  const [row] = await h.sql<{ v: string | null }>(`select fn_normalize_phone($1) as v;`, [raw]);
  return row!.v;
}

async function normalizeLinkedIn(raw: string | null): Promise<string | null> {
  const [row] = await h.sql<{ v: string | null }>(`select fn_normalize_linkedin($1) as v;`, [raw]);
  return row!.v;
}

describe('phone normalization to E.164', () => {
  const cases: Array<[string, string]> = [
    ['(212) 555-0142', '+12125550142'],
    ['212-555-0142', '+12125550142'],
    ['212.555.0142', '+12125550142'],
    ['2125550142', '+12125550142'],
    ['1 212 555 0142', '+12125550142'],
    ['+1 (212) 555-0142', '+12125550142'],
    ['+12125550142', '+12125550142'],
    ['  +1 212 555 0142  ', '+12125550142'],
    ['+44 20 7946 0958', '+442079460958'],
    ['011 44 20 7946 0958', '+442079460958'],
    ['00 44 20 7946 0958', '+442079460958'],
    ['(212) 555-0142 x22', '+12125550142'],
    ['212-555-0142 ext. 105', '+12125550142'],
  ];

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, async () => {
      expect(await normalizePhone(input)).toBe(expected);
    });
  }

  it('returns null for empty input', async () => {
    expect(await normalizePhone(null)).toBeNull();
    expect(await normalizePhone('   ')).toBeNull();
  });

  it('returns unrecognized input verbatim rather than inventing a country code', async () => {
    expect(await normalizePhone('call the front desk')).toBe('call the front desk');
  });

  it('reports unrecognized values through v_data_quality', async () => {
    const [person] = await h.sql<{ id: string }>(
      `insert into people (first_name, last_name, contact_status, first_contact_at, phone_office, region)
       values ('Bad', 'Number', 'active', now(), 'ask reception', 'us')
       returning id;`,
    );

    const rows = await h.sql<{ issue_kind: string }>(
      `select issue_kind from v_data_quality where entity_id = $1;`,
      [person!.id],
    );
    expect(rows.map((r) => r.issue_kind)).toContain('unnormalized_phone');

    await h.sql(`delete from people where id = $1;`, [person!.id]);
  });

  it('normalizes on write, not just on read', async () => {
    const [row] = await h.sql<{ phone_mobile: string }>(
      `select phone_mobile from people where id = $1;`,
      [PERSON.adrienneDeLisio],
    );
    expect(row!.phone_mobile).toBe('+12125550142');
  });
});

describe('LinkedIn URL normalization', () => {
  const cases: Array<[string, string]> = [
    ['https://www.linkedin.com/in/marcusvance/', 'linkedin.com/in/marcusvance'],
    ['http://linkedin.com/in/marcusvance', 'linkedin.com/in/marcusvance'],
    ['linkedin.com/in/marcusvance', 'linkedin.com/in/marcusvance'],
    ['LinkedIn.com/IN/MarcusVance', 'linkedin.com/in/marcusvance'],
    ['https://uk.linkedin.com/in/marcusvance?originalSubdomain=uk', 'linkedin.com/in/marcusvance'],
    ['https://www.linkedin.com/in/marcusvance/#experience', 'linkedin.com/in/marcusvance'],
    ['in/marcusvance', 'linkedin.com/in/marcusvance'],
    ['marcusvance', 'linkedin.com/in/marcusvance'],
    ['https://www.linkedin.com/company/carlton-fields', 'linkedin.com/company/carlton-fields'],
  ];

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, async () => {
      expect(await normalizeLinkedIn(input)).toBe(expected);
    });
  }

  it('returns null for empty input', async () => {
    expect(await normalizeLinkedIn(null)).toBeNull();
    expect(await normalizeLinkedIn('')).toBeNull();
  });

  it('stores the key as a generated column', async () => {
    const [row] = await h.sql<{ linkedin_key: string }>(
      `select linkedin_key from people where id = $1;`,
      [PERSON.henrikSorensen],
    );
    // Entered as https://www.linkedin.com/in/henriksorensen/
    expect(row!.linkedin_key).toBe('linkedin.com/in/henriksorensen');
  });
});

describe('name normalization for the last-resort dedupe key', () => {
  const cases: Array<[string, string]> = [
    ['Adrienne DeLisio', 'adrienne delisio'],
    ['  Adrienne   DeLisio  ', 'adrienne delisio'],
    ["Beatrice O'Connor", 'beatrice o connor'],
    ['José Ramírez', 'jose ramirez'],
    ['Anne-Marie Sørensen', 'anne marie sorensen'],
  ];

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, async () => {
      const [row] = await h.sql<{ v: string }>(`select fn_normalize_name($1) as v;`, [input]);
      expect(row!.v).toBe(expected);
    });
  }
});

describe('data quality detection', () => {
  it('flags near-duplicate organization names that no unique index can catch', async () => {
    const [org] = await h.sql<{ id: string }>(
      `insert into organizations (name) values ('Naturally New York LLC') returning id;`,
    );

    const rows = await h.sql<{ issue_kind: string; detail: string }>(
      `select issue_kind, detail from v_data_quality where issue_kind = 'duplicate_organization';`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.detail.includes('Naturally New York'))).toBe(true);

    await h.sql(`delete from organizations where id = $1;`, [org!.id]);
  });

  it('flags an active person with no way to reach them', async () => {
    const [person] = await h.sql<{ id: string }>(
      `insert into people (first_name, last_name, contact_status, first_contact_at, region)
       values ('Unreachable', 'Person', 'active', now(), 'us') returning id;`,
    );

    const rows = await h.sql<{ issue_kind: string }>(
      `select issue_kind from v_data_quality where entity_id = $1;`,
      [person!.id],
    );
    expect(rows.map((r) => r.issue_kind)).toContain('missing_contact_info');

    await h.sql(`delete from people where id = $1;`, [person!.id]);
  });

  it('flags a thin watchlist identifier without treating it as an error', async () => {
    const [row] = await h.sql<{ severity: string }>(
      `select severity from v_data_quality where issue_kind = 'thin_watchlist_identifier' and entity_id = $1;`,
      [PERSON.simoneAchebe],
    );
    expect(row!.severity).toBe('info');
  });
});
