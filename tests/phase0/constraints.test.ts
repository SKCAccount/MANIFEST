/**
 * Phase 0 acceptance: the hard constraints from section 2, enforced in code.
 *
 * Every assertion here is a philosophy statement the schema is supposed to make
 * impossible to violate — not a preference the application layer is trusted to
 * remember.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/db.js';
import { ORG, PERSON, SOURCE } from '../helpers/fixtures.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

describe('the touchpoint log is append-only', () => {
  it('rejects UPDATE at the database level', async () => {
    await expect(
      h.sql(`update touchpoints set summary = 'rewritten' where person_id = $1;`, [
        PERSON.marcusVance,
      ]),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects DELETE at the database level', async () => {
    await expect(
      h.sql(`delete from touchpoints where person_id = $1;`, [PERSON.marcusVance]),
    ).rejects.toThrow(/append-only/i);
  });

  it('rejects UPDATE for the authenticated role too', async () => {
    await expect(
      h.asOperator(`update touchpoints set substantive = true where person_id = $1;`, [
        PERSON.marcusVance,
      ]),
    ).rejects.toThrow();
  });

  it('grants no update or delete privilege to the client role', async () => {
    const rows = await h.sql<{ privilege_type: string }>(`
      select privilege_type from information_schema.role_table_grants
      where grantee = 'authenticated' and table_name = 'touchpoints';
    `);
    const privileges = rows.map((r) => r.privilege_type);
    expect(privileges).toContain('SELECT');
    expect(privileges).toContain('INSERT');
    expect(privileges).not.toContain('UPDATE');
    expect(privileges).not.toContain('DELETE');
  });

  it('accepts a correction as a superseding row, and hides the superseded one', async () => {
    const [original] = await h.sql<{ id: string }>(
      `select id from touchpoints where person_id = $1 and substantive order by occurred_at limit 1;`,
      [PERSON.ninaOkafor],
    );

    await h.sql(
      `insert into touchpoints (person_id, occurred_at, channel, direction, substantive, summary, supersedes_id)
       values ($1, now(), 'call', 'mutual', true, 'Corrected: it was Q3, not Q2.', $2);`,
      [PERSON.ninaOkafor, original!.id],
    );

    const visible = await h.sql<{ id: string }>(
      `select id from v_contact_touchpoints where person_id = $1;`,
      [PERSON.ninaOkafor],
    );
    expect(visible.map((r) => r.id)).not.toContain(original!.id);
  });
});

describe('event sources carry their cost', () => {
  it('rejects an event-kind source with no cost breakdown', async () => {
    await expect(
      h.sql(
        `insert into sources (event_name, event_year, kind, occurred_on)
         values ('Fancy Food Show', 2026, 'Trade Show', current_date - 30);`,
      ),
    ).rejects.toThrow(/requires a cost breakdown/i);
  });

  it('rejects an event-kind source with no year', async () => {
    await expect(
      h.sql(
        `insert into sources (event_name, kind, occurred_on, cost_pass_cents)
         values ('Fancy Food Show', 'Trade Show', current_date - 30, 100000);`,
      ),
    ).rejects.toThrow(/requires event_year/i);
  });

  it('rejects an event-kind source with no date, which horizon math depends on', async () => {
    await expect(
      h.sql(
        `insert into sources (event_name, event_year, kind, cost_pass_cents)
         values ('Fancy Food Show', 2026, 'Trade Show', 100000);`,
      ),
    ).rejects.toThrow(/requires occurred_on/i);
  });

  it('rejects cost on a non-event source, whose form does not render cost fields', async () => {
    await expect(
      h.sql(
        `insert into sources (event_name, kind, cost_pass_cents) values ('Warm intro', 'Referral', 50000);`,
      ),
    ).rejects.toThrow(/must not carry cost/i);
  });

  it('sums the cost breakdown into one stored total', async () => {
    const [row] = await h.sql<{ cost_total_cents: string; display_name: string }>(
      `select cost_total_cents, display_name from sources where id = $1;`,
      [SOURCE.expoEast2025],
    );
    expect(Number(row!.cost_total_cents)).toBe(295000 + 118000 + 210000 + 42000 + 15000);
    expect(row!.display_name).toBe('Expo East 2025');
  });

  it('editing cost moves every derived metric at once, with no backfill', async () => {
    const before = await h.sql<{ cost_per_new_contact_cents: string }>(
      `select cost_per_new_contact_cents from fn_source_metrics($1, null);`,
      [SOURCE.expoEast2025],
    );

    await h.sql(`update sources set cost_travel_cents = cost_travel_cents + 100000 where id = $1;`, [
      SOURCE.expoEast2025,
    ]);

    const after = await h.sql<{ cost_per_new_contact_cents: string }>(
      `select cost_per_new_contact_cents from fn_source_metrics($1, null);`,
      [SOURCE.expoEast2025],
    );

    expect(Number(after[0]!.cost_per_new_contact_cents)).toBeGreaterThan(
      Number(before[0]!.cost_per_new_contact_cents),
    );

    await h.sql(`update sources set cost_travel_cents = cost_travel_cents - 100000 where id = $1;`, [
      SOURCE.expoEast2025,
    ]);
  });

  it('keeps one row per event name and year', async () => {
    await expect(
      h.sql(
        `insert into sources (event_name, event_year, kind, occurred_on, cost_pass_cents)
         values ('expo east', 2025, 'Trade Show', current_date - 400, 100000);`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('the watchlist contract', () => {
  it('rejects an uncontacted record with no written reason', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, linkedin_url)
         values ('Nameless', 'Prospect', 'uncontacted', 'linkedin.com/in/nameless');`,
      ),
    ).rejects.toThrow(/people_uncontacted_requires_reason/);
  });

  it('rejects an uncontacted record whose reason is only whitespace', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, watchlist_reason, linkedin_url)
         values ('Nameless', 'Prospect', 'uncontacted', '   ', 'linkedin.com/in/nameless2');`,
      ),
    ).rejects.toThrow(/people_uncontacted_requires_reason/);
  });

  it('rejects an uncontacted record with no identifier at all', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, watchlist_reason)
         values ('Just', 'AName', 'uncontacted', 'Someone mentioned them once.');`,
      ),
    ).rejects.toThrow(/people_uncontacted_requires_identifier/);
  });

  it('accepts a phone-only uncontacted record', async () => {
    const rows = await h.sql<{ id: string; phone_mobile: string }>(
      `insert into people (first_name, last_name, contact_status, watchlist_reason, phone_mobile)
       values ('Phone', 'Only', 'uncontacted', 'Recommended by a co-packer at the winter dinner.', '(415) 555-0122')
       returning id, phone_mobile;`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.phone_mobile).toBe('+14155550122');
    await h.sql(`delete from people where id = $1;`, [rows[0]!.id]);
  });

  it('accepts an organization-only uncontacted record', async () => {
    const [row] = await h.sql<{ id: string }>(
      `insert into people (first_name, last_name, contact_status, watchlist_reason, organization_id)
       values ('Org', 'Only', 'uncontacted', 'Runs the desk that clears our paper.', $1)
       returning id;`,
      [ORG.carltonFields],
    );
    expect(row).toBeDefined();
    await h.sql(`delete from people where id = $1;`, [row!.id]);
  });

  it('rejects a Met At on an uncontacted record — you did not meet them anywhere', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, watchlist_reason, linkedin_url, met_at_source_id)
         values ('Never', 'Met', 'uncontacted', 'Spoke on a panel I watched online.', 'linkedin.com/in/nevermet', $1);`,
        [SOURCE.expoEast2025],
      ),
    ).rejects.toThrow(/people_uncontacted_has_no_met_at/);
  });

  it('rejects an active record with no first contact timestamp', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status)
         values ('Claimed', 'Relationship', 'active');`,
      ),
    ).rejects.toThrow(/people_active_requires_first_contact/);
  });

  it('refuses to return an active person to the watchlist', async () => {
    await expect(
      h.sql(
        `update people set contact_status = 'uncontacted', watchlist_reason = 'changed my mind' where id = $1;`,
        [PERSON.marcusVance],
      ),
    ).rejects.toThrow(/cannot be returned to the watchlist/i);
  });
});

describe('deterministic dedupe keys', () => {
  it('rejects a duplicate work email regardless of case', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, first_contact_at, email_work)
         values ('Impostor', 'Vance', 'active', now(), 'MVANCE@carltonfields.com');`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects a duplicate LinkedIn URL written a different way', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, first_contact_at, linkedin_url)
         values ('Impostor', 'Vance', 'active', now(), 'https://www.linkedin.com/in/marcusvance/?trk=nav');`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('rejects a duplicate phone written a different way', async () => {
    await expect(
      h.sql(
        `insert into people (first_name, last_name, contact_status, first_contact_at, phone_mobile)
         values ('Impostor', 'Vance', 'active', now(), '813-555-0117');`,
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('history is written automatically, never by hand', () => {
  it('logs the initial tier assignment', async () => {
    const [row] = await h.sql<{ from_tier: string | null; to_tier: string }>(
      `select from_tier, to_tier from tier_history where person_id = $1 order by changed_at limit 1;`,
      [PERSON.marcusVance],
    );
    expect(row!.from_tier).toBeNull();
    expect(row!.to_tier).toBe('B');
  });

  it('logs a tier change and preserves the trajectory', async () => {
    await h.sql(`update people set tier = 'A' where id = $1;`, [PERSON.ninaOkafor]);

    const rows = await h.sql<{ from_tier: string | null; to_tier: string }>(
      `select from_tier, to_tier from tier_history where person_id = $1 order by changed_at;`,
      [PERSON.ninaOkafor],
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ from_tier: 'C', to_tier: 'A' });

    await h.sql(`update people set tier = 'C' where id = $1;`, [PERSON.ninaOkafor]);
  });

  it('closes the prior affiliation and logs a system touchpoint on a job change', async () => {
    const [affiliation] = await h.sql<{ organization_name: string; position: string }>(
      `select organization_name, position from affiliation_history where person_id = $1;`,
      [PERSON.danaFerraro],
    );
    expect(affiliation!.organization_name).toBe('Ferraro Insurance Group');
    expect(affiliation!.position).toBe('Principal');

    const [touch] = await h.sql<{ channel: string; summary: string }>(
      `select channel, summary from touchpoints where person_id = $1 and channel = 'system';`,
      [PERSON.danaFerraro],
    );
    expect(touch!.summary).toMatch(/Ferraro Insurance Group.*Sea King Capital/);
  });

  it('does not let a system touchpoint count as contact', async () => {
    // A job change is a fact about a person, not contact with them. Counting it
    // would silently reset a cadence clock and advance a development stage.
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from v_contact_touchpoints where person_id = $1 and channel = 'system';`,
      [PERSON.danaFerraro],
    );
    expect(Number(row!.n)).toBe(0);
  });
});
