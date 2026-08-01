/**
 * Phase 1 acceptance.
 *
 * Two criteria from the spec, checked against the exact SQL the screens issue:
 *
 *   - capability search returns correct results for a two-dimensional query
 *   - an uncontacted record with two logged attempts appears correctly in the
 *     watchlist and geography screens while remaining absent from the queue
 *     and directory
 *
 * The screens reach these views through supabase-js, which cannot run against
 * PGlite — so what is asserted here is the query each screen builds. The
 * PostgREST call `.contains('specialties', ['CPG'])` is `specialties @> ...`,
 * and that predicate is what determines whether the answer is right.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/db';
import { PERSON } from '../helpers/fixtures';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

describe('capability search — the two-dimensional query', () => {
  it('answers "do you know a good CPG accountant" in one query', async () => {
    // Directory: .contains('professional_function', ['Accountant'])
    //            .contains('specialties', ['CPG'])
    const rows = await h.sql<{ full_name: string; organization_name: string }>(
      `select full_name, organization_name
       from v_directory
       where professional_function @> $1::text[]
         and specialties @> $2::text[];`,
      [['Accountant'], ['CPG']],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.full_name).toBe('Priya Raghunathan');
    expect(rows[0]!.organization_name).toBe('Raghunathan CPA Group');
  });

  it('does not match on either dimension alone', async () => {
    // The point of keeping function and specialty separate: an accountant who
    // does not do CPG, and a CPG person who is not an accountant, both exist
    // and neither is the answer.
    const accountants = await h.sql(
      `select full_name from v_directory where professional_function @> '{Accountant}';`,
    );
    const cpg = await h.sql(`select full_name from v_directory where specialties @> '{CPG}';`);

    expect(accountants.length).toBeGreaterThanOrEqual(1);
    expect(cpg.length).toBeGreaterThan(accountants.length);
  });

  it('finds structured finance inside a general-practice firm', async () => {
    // The case that makes person-level specialty non-negotiable: Carlton
    // Fields is a general-practice firm, and exactly one attorney there does
    // structured finance. Filtering on the organization's industry would
    // return the firm, not the person.
    const rows = await h.sql<{ full_name: string; organization_name: string; industry_category: string }>(
      `select full_name, organization_name, industry_category
       from v_directory
       where professional_function @> '{Attorney}' and specialties @> '{"Structured Finance"}';`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      full_name: 'Marcus Vance',
      organization_name: 'Carlton Fields',
      industry_category: 'Legal',
    });
  });

  it('searches relationship independently of profession', async () => {
    // The other query direction: deal sources, ignoring what they do.
    const rows = await h.sql<{ full_name: string }>(
      `select full_name from v_directory where relationship_to_me @> '{"Deal Source"}' order by full_name;`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.map((r) => r.full_name)).toContain('Grant Whitfield');
  });
});

describe('an uncontacted record with two logged attempts', () => {
  const curtis = PERSON.curtisAlderman;

  it('is on the watchlist, with both attempts visible', async () => {
    const [row] = await h.sql<{
      full_name: string;
      city: string;
      watchlist_reason: string;
      watchlist_priority: string;
      outreach_attempts: number;
      last_attempt_channel: string;
      days_waiting: number;
    }>(`select * from v_watchlist where person_id = $1;`, [curtis]);

    expect(row).toBeDefined();
    expect(row!.full_name).toBe('Curtis Alderman');
    expect(row!.city).toBe('Colorado Springs');
    expect(row!.outreach_attempts).toBe(2);
    expect(row!.last_attempt_channel).toBe('linkedin');
    expect(row!.watchlist_reason).toMatch(/shelf-stable/);
    // Displayed, but the screen never sorts or flags on it.
    expect(row!.days_waiting).toBeGreaterThan(0);
  });

  it('appears in geography under the watchlist cohort, not the active one', async () => {
    const rows = await h.sql<{ cohort: string; full_name: string; outreach_attempts: number }>(
      `select cohort, full_name, outreach_attempts
       from v_geography where city = 'Colorado Springs';`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cohort: 'watchlist', full_name: 'Curtis Alderman' });
    expect(rows[0]!.outreach_attempts).toBe(2);
  });

  it('is absent from the queue', async () => {
    expect(await h.sql(`select 1 from v_queue where person_id = $1;`, [curtis])).toEqual([]);
  });

  it('is absent from the directory', async () => {
    expect(await h.sql(`select 1 from v_directory where person_id = $1;`, [curtis])).toEqual([]);
  });

  it('is absent from the directory even when he matches the filters', async () => {
    // He is an Operator with CPG specialty — exactly what this query asks for.
    const rows = await h.sql<{ full_name: string }>(
      `select full_name from v_directory
       where professional_function @> '{Operator}' and specialties @> '{CPG}';`,
    );
    expect(rows.map((r) => r.full_name)).not.toContain('Curtis Alderman');
  });

  it('stays uncontacted after a third outbound attempt', async () => {
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, summary)
       values ($1, 'email', 'outbound', false, 'Third try, after the podcast episode.');`,
      [curtis],
    );

    const [person] = await h.sql<{ contact_status: string; first_contact_at: string | null }>(
      `select contact_status, first_contact_at from people where id = $1;`,
      [curtis],
    );
    expect(person).toMatchObject({ contact_status: 'uncontacted', first_contact_at: null });

    const [row] = await h.sql<{ outreach_attempts: number }>(
      `select outreach_attempts from v_watchlist where person_id = $1;`,
      [curtis],
    );
    expect(row!.outreach_attempts).toBe(3);
  });

  it('moves to the active surfaces the moment he replies', async () => {
    // A short reply — two-way, so it promotes, but not substantive.
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, summary)
       values ($1, 'email', 'inbound', false, 'He replied: "who is this?"');`,
      [curtis],
    );

    const [person] = await h.sql<{ contact_status: string }>(
      `select contact_status from people where id = $1;`,
      [curtis],
    );
    expect(person!.contact_status).toBe('active');

    expect(await h.sql(`select 1 from v_watchlist where person_id = $1;`, [curtis])).toEqual([]);
    expect(await h.sql(`select 1 from v_directory where person_id = $1;`, [curtis])).toHaveLength(1);

    // He is a Card: one real interaction. The three unanswered attempts that
    // preceded first contact are on the record but do not count as
    // development — otherwise the operator's own unanswered effort would look
    // like a relationship that had progressed.
    const [stage] = await h.sql<{ s: string }>(`select fn_person_stage($1) as s;`, [curtis]);
    expect(stage!.s).toBe('card');

    const [counts] = await h.sql<{ total: string }>(
      `select count(*) as total from v_contact_touchpoints where person_id = $1;`,
      [curtis],
    );
    expect(Number(counts!.total)).toBe(4); // 3 attempts + the reply, all on the record

    const [geo] = await h.sql<{ cohort: string }>(
      `select cohort from v_geography where person_id = $1;`,
      [curtis],
    );
    expect(geo!.cohort).toBe('active');
  });
});

describe('usable by hand with zero integrations', () => {
  it('creates an active person and its establishing touchpoint in one call', async () => {
    const created = await h.sql<{ id: string }>(
      `select fn_create_active_person($1::jsonb, $2::jsonb) as id;`,
      [
        JSON.stringify({
          first_name: 'Hand',
          last_name: 'Entered',
          tier: 'B',
          city: 'Boston',
          email_work: 'hand@example.com',
          professional_function: ['Consultant'],
          specialties: ['CPG'],
          relationship_to_me: ['Prospect'],
        }),
        JSON.stringify({ channel: 'meeting', direction: 'mutual', substantive: true, summary: 'Coffee.' }),
      ],
    );
    const id = created[0]!.id;

    const [row] = await h.sql<{ contact_status: string; stage: string; full_name: string }>(
      `select contact_status, fn_person_stage(id) as stage, full_name from people where id = $1;`,
      [id],
    );
    // A substantive first meeting puts them straight at Active — the ladder
    // reads the conversation, not the number of rows.
    expect(row).toMatchObject({ contact_status: 'active', stage: 'active', full_name: 'Hand Entered' });

    // Immediately searchable on both dimensions.
    const found = await h.sql(
      `select 1 from v_directory
       where person_id = $1 and professional_function @> '{Consultant}' and specialties @> '{CPG}';`,
      [id],
    );
    expect(found).toHaveLength(1);
  });

  it('logs a whole event in one pass and promotes the watchlist entries in it', async () => {
    const before = await h.sql<{ n: string }>(`select count(*) as n from v_watchlist;`);

    const rows = await h.sql<{ person_id: string; promoted: boolean; met_at_set: boolean }>(
      `select * from fn_log_bulk_event(
         '33333333-0000-4000-8000-000000000004',
         $1::uuid[], now(), true, 'Winter dinner conversations.', true);`,
      [[PERSON.henrikSorensen, PERSON.marcusVance]],
    );

    expect(rows).toHaveLength(2);
    const henrik = rows.find((r) => r.person_id === PERSON.henrikSorensen);
    expect(henrik).toMatchObject({ promoted: true, met_at_set: true });

    const after = await h.sql<{ n: string }>(`select count(*) as n from v_watchlist;`);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n) - 1);

    // One touchpoint per attendee, sharing a group key.
    const [group] = await h.sql<{ keys: number; rows: number }>(
      `select count(distinct group_key)::int as keys, count(*)::int as rows
       from touchpoints where source_id = '33333333-0000-4000-8000-000000000004'
         and occurred_at > now() - interval '1 minute';`,
    );
    expect(group).toMatchObject({ keys: 1, rows: 2 });
  });

  it('keeps the queue answerable in one read', async () => {
    // The ten-second test: fifteen rows, each with an opener.
    const rows = await h.sql<{ full_name: string; suggested_opener: string; queue_rank: number }>(
      `select full_name, suggested_opener, queue_rank from v_queue where queue_rank <= 15 order by queue_rank;`,
    );

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(15);
    expect(rows.every((r) => r.suggested_opener.length > 0)).toBe(true);
  });
});
