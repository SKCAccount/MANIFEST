/**
 * The ten-second test: on a phone, who is overdue and what do I say to them.
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

describe('cadence', () => {
  it('applies the tier default when there is no override', async () => {
    const rows = await h.sql<{ tier: string; effective_cadence_days: number | null }>(
      `select tier, effective_cadence_days from v_person_recency
       where person_id = any($1::uuid[]) order by tier;`,
      [[PERSON.jamalWhitaker, PERSON.marcusVance, PERSON.ninaOkafor, PERSON.hollisTran]],
    );

    expect(rows).toEqual([
      { tier: 'A', effective_cadence_days: 45 },
      { tier: 'B', effective_cadence_days: 90 },
      { tier: 'C', effective_cadence_days: 180 },
      { tier: 'D', effective_cadence_days: null },
    ]);
  });

  it('runs the clock from the last substantive touch, not the last touch', async () => {
    // Devon's most recent touch is a non-substantive quarterly note 35 days
    // ago; his last substantive contact was 180 days ago. The clock runs from
    // the latter, because only substantive touchpoints reset a cadence clock.
    const [row] = await h.sql<{
      last_touch_at: string;
      last_substantive_at: string;
      next_due_at: string;
      effective_cadence_days: number;
    }>(
      `select last_touch_at, last_substantive_at, next_due_at, effective_cadence_days
       from v_person_recency where person_id = $1;`,
      [PERSON.devonRuiz],
    );

    expect(new Date(row!.last_touch_at).getTime()).toBeGreaterThan(
      new Date(row!.last_substantive_at).getTime(),
    );

    // next_due_at = last_substantive_at + cadence. If the non-substantive note
    // had reset the clock, the due date would be 145 days later than this.
    const expected =
      new Date(row!.last_substantive_at).getTime() + row!.effective_cadence_days * 86_400_000;
    expect(new Date(row!.next_due_at).getTime()).toBe(expected);
  });

  it('honours a per-person override', async () => {
    await h.sql(`update people set cadence_days_override = 14 where id = $1;`, [PERSON.ninaOkafor]);
    const [row] = await h.sql<{ effective_cadence_days: number }>(
      `select effective_cadence_days from v_person_recency where person_id = $1;`,
      [PERSON.ninaOkafor],
    );
    expect(row!.effective_cadence_days).toBe(14);
    await h.sql(`update people set cadence_days_override = null where id = $1;`, [PERSON.ninaOkafor]);
  });
});

describe('v_queue exclusions', () => {
  const cases: Array<[string, string]> = [
    ['tier D is archived and never queued', PERSON.hollisTran],
    ['a paused record is skipped until the pause lapses', PERSON.ellisNakamura],
    ['do_not_contact is honoured', PERSON.walterNg],
    ['uncontacted people never reach the queue', PERSON.curtisAlderman],
  ];

  for (const [name, personId] of cases) {
    it(name, async () => {
      const rows = await h.sql(`select 1 from v_queue where person_id = $1;`, [personId]);
      expect(rows).toEqual([]);
    });
  }

  it('drops someone who is not yet due', async () => {
    // Beatrice is tier A with substantive contact 20 days ago, well inside 45.
    const rows = await h.sql(`select 1 from v_queue where person_id = $1;`, [
      PERSON.beatriceSolomon,
    ]);
    expect(rows).toEqual([]);
  });
});

describe('v_queue scoring', () => {
  it('adds 2.0 for an unanswered inbound', async () => {
    const [margaret] = await h.sql<{ inbound_unanswered: boolean; opener_kind: string }>(
      `select inbound_unanswered, opener_kind from v_queue where person_id = $1;`,
      [PERSON.margaretChen],
    );
    expect(margaret!.inbound_unanswered).toBe(true);
    expect(margaret!.opener_kind).toBe('inbound_unanswered');
  });

  it('clears the unanswered flag once the operator replies', async () => {
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, summary)
       values ($1, 'email', 'outbound', true, 'Replied about the new series.');`,
      [PERSON.margaretChen],
    );

    const [row] = await h.sql<{ inbound_unanswered: boolean }>(
      `select inbound_unanswered from v_person_recency where person_id = $1;`,
      [PERSON.margaretChen],
    );
    expect(row!.inbound_unanswered).toBe(false);
  });

  it('surfaces a recent job change as the opener', async () => {
    const [dana] = await h.sql<{ opener_kind: string; suggested_opener: string }>(
      `select opener_kind, suggested_opener from v_queue where person_id = $1;`,
      [PERSON.danaFerraro],
    );
    expect(dana!.opener_kind).toBe('job_change');
    expect(dana!.suggested_opener).toMatch(/Sea King Capital/);
  });

  it('surfaces an outstanding reciprocity debt', async () => {
    const [erica] = await h.sql<{ opener_kind: string; suggested_opener: string }>(
      `select opener_kind, suggested_opener from v_queue where person_id = $1;`,
      [PERSON.ericaGendell],
    );
    expect(erica!.opener_kind).toBe('reciprocity');
    expect(erica!.suggested_opener).toMatch(/3 favors down/);
  });

  it('surfaces a due followup', async () => {
    const [tobias] = await h.sql<{ opener_kind: string; suggested_opener: string }>(
      `select opener_kind, suggested_opener from v_queue where person_id = $1;`,
      [PERSON.tobiasReyes],
    );
    expect(tobias!.opener_kind).toBe('followup');
    expect(tobias!.suggested_opener).toMatch(/govcon note/);
  });

  it('gives every row an opener', async () => {
    const rows = await h.sql<{ suggested_opener: string | null }>(
      `select suggested_opener from v_queue;`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => (r.suggested_opener ?? '').length > 0)).toBe(true);
  });

  it('ranks by score, highest first', async () => {
    const rows = await h.sql<{ queue_rank: number; score: string }>(
      `select queue_rank, score from v_queue order by queue_rank;`,
    );
    const scores = rows.map((r) => Number(r.score));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(rows[0]!.queue_rank).toBe(1);
  });
});

describe('v_never_followed_up', () => {
  it('holds people met once and never contacted again, inside 120 days', async () => {
    const rows = await h.sql<{ person_id: string; days_since: number }>(
      `select person_id, days_since from v_never_followed_up order by days_since desc;`,
    );
    const ids = rows.map((r) => r.person_id);

    expect(ids).toContain(PERSON.rubenDiaz);
    expect(ids).toContain(PERSON.camilleBoucher);
    // Sorted by days elapsed descending.
    expect(rows[0]!.days_since).toBeGreaterThanOrEqual(rows[rows.length - 1]!.days_since);
  });

  it('drops someone once they are followed up', async () => {
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, summary)
       values ($1, 'call', 'mutual', true, 'Finally called him back.');`,
      [PERSON.rubenDiaz],
    );

    const rows = await h.sql(`select 1 from v_never_followed_up where person_id = $1;`, [
      PERSON.rubenDiaz,
    ]);
    expect(rows).toEqual([]);
  });
});

describe('v_tier_mismatch', () => {
  it('surfaces a genuinely mis-tiered relationship', async () => {
    const rows = await h.sql<{
      full_name: string;
      assigned_tier: string;
      implied_tier: string;
      verdict: string;
    }>(`select full_name, assigned_tier, implied_tier, verdict from v_tier_mismatch;`);

    expect(rows.length).toBeGreaterThan(0);

    // Tobias has sourced two funded deals and made an introduction, and is
    // still sitting at C.
    const tobias = rows.find((r) => r.full_name === 'Tobias Reyes');
    expect(tobias).toMatchObject({ assigned_tier: 'C', verdict: 'underrated' });
    expect(['A', 'B']).toContain(tobias!.implied_tier);
  });
});

describe('v_reciprocity', () => {
  it('flags the people the operator owes', async () => {
    const [erica] = await h.sql<{ favors_given: number; favors_received: number; net_balance: number; is_owed: boolean }>(
      `select favors_given, favors_received, net_balance, is_owed from v_reciprocity where person_id = $1;`,
      [PERSON.ericaGendell],
    );
    expect(erica).toMatchObject({ favors_given: 0, favors_received: 3, net_balance: -3, is_owed: true });
  });

  it('does not flag a balanced relationship', async () => {
    const [marcus] = await h.sql<{ is_owed: boolean }>(
      `select is_owed from v_reciprocity where person_id = $1;`,
      [PERSON.marcusVance],
    );
    expect(marcus!.is_owed).toBe(false);
  });
});
