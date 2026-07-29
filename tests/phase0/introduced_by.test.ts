/**
 * Phase 0 acceptance: setting introduced_by_person_id creates the matching
 * introductions row.
 *
 * The operator enters a referral once, on the referred person's profile. The
 * row that feeds the referrer's intros_received_count, reciprocity balance and
 * network centrality is written for them.
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

describe('trg_introduced_by', () => {
  it('writes an introductions row when the field is set at insert', async () => {
    const [row] = await h.sql<{
      perspective: string;
      introducer_person_id: string;
      party_a_person_id: string;
    }>(
      `select perspective, introducer_person_id, party_a_person_id
       from introductions where auto_from_person_id = $1;`,
      [PERSON.amandaKellerman],
    );

    expect(row).toMatchObject({
      perspective: 'received_by_me',
      introducer_person_id: PERSON.ericaGendell,
      party_a_person_id: PERSON.amandaKellerman,
    });
  });

  it('updates the row when the referrer is changed', async () => {
    await h.sql(`update people set introduced_by_person_id = $1 where id = $2;`, [
      PERSON.adrienneDeLisio,
      PERSON.amandaKellerman,
    ]);

    const rows = await h.sql<{ introducer_person_id: string }>(
      `select introducer_person_id from introductions where auto_from_person_id = $1;`,
      [PERSON.amandaKellerman],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.introducer_person_id).toBe(PERSON.adrienneDeLisio);

    await h.sql(`update people set introduced_by_person_id = $1 where id = $2;`, [
      PERSON.ericaGendell,
      PERSON.amandaKellerman,
    ]);
  });

  it('removes the row when the referrer is cleared', async () => {
    await h.sql(`update people set introduced_by_person_id = null where id = $1;`, [
      PERSON.devonRuiz,
    ]);

    const rows = await h.sql(
      `select 1 from introductions where auto_from_person_id = $1;`,
      [PERSON.devonRuiz],
    );
    expect(rows).toEqual([]);

    await h.sql(`update people set introduced_by_person_id = $1 where id = $2;`, [
      PERSON.amandaKellerman,
      PERSON.devonRuiz,
    ]);
  });

  it('is valid on an uncontacted record — the warmest available path', async () => {
    const [row] = await h.sql<{ introducer_person_id: string }>(
      `select introducer_person_id from introductions where auto_from_person_id = $1;`,
      [PERSON.yolandaBassett],
    );
    expect(row!.introducer_person_id).toBe(PERSON.ellisNakamura);
  });

  it('refuses a self-introduction', async () => {
    await expect(
      h.sql(`update people set introduced_by_person_id = id where id = $1;`, [PERSON.devonRuiz]),
    ).rejects.toThrow(/people_no_self_introduction/);
  });

  it('resolves a chain: Erica introduced Amanda, Amanda introduced Devon', async () => {
    const rows = await h.sql<{ referrer: string; referred: string }>(
      `select i.full_name as referrer, p.full_name as referred
       from people p
       join people i on i.id = p.introduced_by_person_id
       where p.id in ($1, $2)
       order by p.full_name;`,
      [PERSON.amandaKellerman, PERSON.devonRuiz],
    );

    expect(rows).toEqual([
      { referrer: 'Erica Gendell', referred: 'Amanda Kellerman' },
      { referrer: 'Amanda Kellerman', referred: 'Devon Ruiz' },
    ]);
  });

  it('credits the chain to Erica through network centrality', async () => {
    // Erica reaches Amanda directly and Devon through Amanda.
    const [erica] = await h.sql<{ network_centrality: number }>(
      `select network_centrality from v_network_centrality where person_id = $1;`,
      [PERSON.ericaGendell],
    );
    expect(erica!.network_centrality).toBeGreaterThanOrEqual(2);
  });

  it('shows the operator everyone a connector has introduced', async () => {
    // The reverse view on Erica's person detail. Frequently the difference
    // between an A and a C.
    const rows = await h.sql<{ full_name: string }>(
      `select p.full_name
       from introductions i
       join people p on p.id = i.party_a_person_id
       where i.perspective = 'received_by_me' and i.introducer_person_id = $1
       order by p.full_name;`,
      [PERSON.ericaGendell],
    );
    expect(rows.map((r) => r.full_name)).toEqual(['Amanda Kellerman', 'Priya Raghunathan']);
  });
});

describe('fn_path_to ranking', () => {
  it('ranks an explicit referrer above a shared-organization match', async () => {
    // A stated introduction is evidence. A shared badge is a guess.
    const rows = await h.sql<{ connector_name: string; path_rank: number }>(
      `select connector_name, path_rank from fn_path_to($1);`,
      [PERSON.yolandaBassett],
    );

    expect(rows[0]).toMatchObject({ connector_name: 'Ellis Nakamura', path_rank: 1 });
    expect(rows[0]!.path_rank).toBeLessThan(rows[rows.length - 1]!.path_rank);
  });

  it('finds a shared-organization path to an uncontacted target', async () => {
    // Simone Achebe's only identifier is her employer, and Marcus Vance is at
    // the same firm. This is the highest-value use of path finding.
    const rows = await h.sql<{ connector_name: string; path_rank: number; path_reason: string }>(
      `select connector_name, path_rank, path_reason from fn_path_to($1);`,
      [PERSON.simoneAchebe],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ connector_name: 'Marcus Vance', path_rank: 2 });
    expect(rows[0]!.path_reason).toMatch(/Carlton Fields/);
  });

  it('never proposes a connector the operator cannot ask', async () => {
    const rows = await h.sql<{ connector_person_id: string }>(
      `select connector_person_id from v_path_to;`,
    );
    const ids = rows.map((r) => r.connector_person_id);

    // do_not_contact, and every uncontacted person, are ineligible as connectors.
    expect(ids).not.toContain(PERSON.walterNg);
    expect(ids).not.toContain(PERSON.henrikSorensen);
  });

  it('outranks a shared event with an explicit referral', async () => {
    // Grant and Nina both met the operator at Expo East (rank 4). Give Nina an
    // explicit referrer and it must jump to rank 1.
    await h.sql(`update people set introduced_by_person_id = $1 where id = $2;`, [
      PERSON.adrienneDeLisio,
      PERSON.ninaOkafor,
    ]);

    const rows = await h.sql<{ connector_name: string; path_rank: number }>(
      `select connector_name, path_rank from fn_path_to($1) order by path_rank;`,
      [PERSON.ninaOkafor],
    );

    expect(rows[0]).toMatchObject({ connector_name: 'Adrienne DeLisio', path_rank: 1 });
    expect(rows.some((r) => r.path_rank === 4)).toBe(true);

    await h.sql(`update people set introduced_by_person_id = null where id = $1;`, [
      PERSON.ninaOkafor,
    ]);
  });
});
