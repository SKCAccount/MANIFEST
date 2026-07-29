/**
 * Phase 0 acceptance: uncontacted records are quarantined.
 *
 * Section 2, constraint 2 lists the surfaces they must never reach. This file
 * checks every one of them by name, because "excluded without exception" is
 * only true if it is true everywhere.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/db.js';
import { PERSON, SOURCE } from '../helpers/fixtures.js';

let h: Harness;

const WATCHLIST_IDS = [
  PERSON.curtisAlderman,
  PERSON.yolandaBassett,
  PERSON.henrikSorensen,
  PERSON.simoneAchebe,
  PERSON.percivalLang,
];

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

describe('uncontacted people are absent from every relationship surface', () => {
  const quarantined = [
    'v_queue',
    'v_never_followed_up',
    'v_directory',
    'v_relationship_value',
    'v_reciprocity',
    'v_tier_mismatch',
    'v_person_recency',
    'v_person_stage',
    'v_deal_sources',
    'v_network_centrality',
  ];

  for (const view of quarantined) {
    it(`${view} contains no uncontacted person`, async () => {
      const rows = await h.sql<{ person_id: string }>(
        `select person_id from ${view} where person_id = any($1::uuid[]);`,
        [WATCHLIST_IDS],
      );
      expect(rows).toEqual([]);
    });
  }

  it('v_directory excludes them even when they match the filters exactly', async () => {
    // Simone Achebe is an Attorney with IP specialty. The Directory must not
    // return her: the whole value of a name there is that the operator can
    // vouch for the person.
    const rows = await h.sql<{ full_name: string }>(
      `select full_name from v_directory where professional_function @> '{Attorney}';`,
    );
    expect(rows.map((r) => r.full_name)).not.toContain('Simone Achebe');
    expect(rows.map((r) => r.full_name)).toContain('Marcus Vance');
  });
});

describe('uncontacted people never enter event economics', () => {
  it('is excluded from every fn_source_metrics denominator', async () => {
    // Attach a watchlist entry to an event by force, bypassing the constraint
    // that normally forbids it, and confirm the metrics are unmoved. This is
    // the belt-and-braces check: even a corrupt row cannot inflate an event.
    const before = await h.sql<{ new_contacts: number; relationships_touched: number }>(
      `select new_contacts, relationships_touched from fn_source_metrics($1, null);`,
      [SOURCE.expoEast2025],
    );

    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, source_id)
       values ($1, 'linkedin', 'outbound', false, $2);`,
      [PERSON.curtisAlderman, SOURCE.expoEast2025],
    );

    const after = await h.sql<{ new_contacts: number; relationships_touched: number }>(
      `select new_contacts, relationships_touched from fn_source_metrics($1, null);`,
      [SOURCE.expoEast2025],
    );

    expect(after[0]!.new_contacts).toBe(before[0]!.new_contacts);
    expect(after[0]!.relationships_touched).toBe(before[0]!.relationships_touched);
  });
});

describe('uncontacted people appear exactly where they should', () => {
  it('v_watchlist holds all five and nobody else', async () => {
    const rows = await h.sql<{ person_id: string }>(`select person_id from v_watchlist;`);
    expect(rows.map((r) => r.person_id).sort()).toEqual([...WATCHLIST_IDS].sort());
  });

  it('v_geography labels them as a separate cohort', async () => {
    const rows = await h.sql<{ cohort: string; full_name: string }>(
      `select cohort, full_name from v_geography where city = 'Los Angeles' order by cohort, full_name;`,
    );

    expect(rows).toEqual([
      expect.objectContaining({ cohort: 'active', full_name: 'Ellis Nakamura' }),
      expect.objectContaining({ cohort: 'active', full_name: 'Margaret Chen' }),
      expect.objectContaining({ cohort: 'watchlist', full_name: 'Yolanda Bassett' }),
    ]);
  });

  it('carries warm paths and prior attempts on the watchlist row', async () => {
    const [yolanda] = await h.sql<{ warm_path_count: number; top_paths: string[] }>(
      `select warm_path_count, top_paths from v_watchlist where person_id = $1;`,
      [PERSON.yolandaBassett],
    );
    expect(yolanda!.warm_path_count).toBeGreaterThan(0);
    expect(yolanda!.top_paths[0]).toBe('Ellis Nakamura');
  });

  it('accepts notes and followups on an uncontacted record', async () => {
    // Research notes are exactly what a watchlist entry accumulates, and a trip
    // list is worked through followups.
    const [notes] = await h.sql<{ n: string }>(
      `select count(*) as n from notes where person_id = $1;`,
      [PERSON.curtisAlderman],
    );
    expect(Number(notes!.n)).toBeGreaterThan(0);

    const [followups] = await h.sql<{ n: string }>(
      `select count(*) as n from followups where person_id = $1;`,
      [PERSON.yolandaBassett],
    );
    expect(Number(followups!.n)).toBeGreaterThan(0);
  });

  it('has no development stage', async () => {
    const [row] = await h.sql<{ stage: string | null }>(
      `select fn_person_stage($1, now()) as stage;`,
      [PERSON.curtisAlderman],
    );
    expect(row!.stage).toBeNull();
  });
});

describe('watchlist entries never expire', () => {
  it('exposes days waiting but never flags on it', async () => {
    // Simone has been on the list for 300 days and Percival for 15. Neither is
    // stale, because elapsed time says nothing about a watchlist entry.
    const rows = await h.sql<{ full_name: string; days_waiting: number }>(
      `select full_name, days_waiting from v_watchlist order by days_waiting desc;`,
    );
    expect(rows[0]!.days_waiting).toBeGreaterThan(200);

    const flagged = await h.sql<{ entity_id: string }>(
      `select entity_id from v_data_quality where issue_kind like '%stale%' and entity_id = any($1::uuid[]);`,
      [WATCHLIST_IDS],
    );
    expect(flagged).toEqual([]);
  });
});
