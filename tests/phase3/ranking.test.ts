/**
 * Phase 3 acceptance — what the Sources screen ranks on.
 *
 * The horizon *mechanism* is already asserted in tests/phase0/horizons.test.ts,
 * which covers tier-as-of, cohort exclusion, the day-90 inversion and the
 * series rollup. What is new here is the choice the screen makes on top of it:
 * which of the computed ratios decides the order, and what happens to the
 * events that have no ratio yet.
 *
 * That choice is worth a test rather than a comment, because both candidate
 * rankings are plausible, they disagree on real data, and the wrong one fails
 * silently — it just quietly recommends the wrong conferences.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  byCostPerNewContact,
  rankEvents,
  type RankableSource,
} from '../../src/lib/sources';
import { createHarness, type Harness } from '../helpers/db';

function source(partial: Partial<RankableSource> & { source_id: string }): RankableSource {
  return {
    new_contacts: 0,
    active_or_better: 0,
    cost_total_cents: null,
    cost_per_new_contact_cents: null,
    cost_per_active_or_better_cents: null,
    ...partial,
  };
}

describe('the ranking comparator', () => {
  it('puts the cheapest real relationship first', () => {
    const ranked = rankEvents([
      source({ source_id: 'dear', cost_per_active_or_better_cents: 90_000, active_or_better: 1 }),
      source({ source_id: 'cheap', cost_per_active_or_better_cents: 12_000, active_or_better: 5 }),
      source({ source_id: 'middling', cost_per_active_or_better_cents: 40_000, active_or_better: 2 }),
    ]);
    expect(ranked.map((row) => row.source_id)).toEqual(['cheap', 'middling', 'dear']);
  });

  it('sorts an event that produced nothing last, not first', () => {
    // The failure this prevents: null is not a small number. Sorted naively it
    // becomes one, and a list headed "cheapest per relationship" opens with
    // every event that produced no relationships at all.
    const ranked = rankEvents([
      source({ source_id: 'nothing-yet', cost_per_active_or_better_cents: null, new_contacts: 3 }),
      source({ source_id: 'expensive', cost_per_active_or_better_cents: 250_000, active_or_better: 1 }),
    ]);
    expect(ranked.map((row) => row.source_id)).toEqual(['expensive', 'nothing-yet']);
  });

  it('falls back to new contacts among events that have produced nothing', () => {
    const ranked = rankEvents([
      source({ source_id: 'quiet', cost_per_active_or_better_cents: null, new_contacts: 1 }),
      source({ source_id: 'busy', cost_per_active_or_better_cents: null, new_contacts: 9 }),
    ]);
    expect(ranked.map((row) => row.source_id)).toEqual(['busy', 'quiet']);
  });

  it('does not mutate what it is given', () => {
    const rows = [
      source({ source_id: 'b', cost_per_active_or_better_cents: 200 }),
      source({ source_id: 'a', cost_per_active_or_better_cents: 100 }),
    ];
    rankEvents(rows);
    expect(rows.map((row) => row.source_id)).toEqual(['b', 'a']);
  });

  it('would rank a card-collecting event top on cost per contact', () => {
    // The whole argument for the choice, as a case. A cheap event where forty
    // people were met and nobody stayed in touch wins decisively on cost per
    // contact, and loses on the ratio the screen actually uses.
    const cardCollector = source({
      source_id: 'expo-with-a-fishbowl',
      new_contacts: 40,
      active_or_better: 0,
      cost_per_new_contact_cents: 1_000,
      cost_per_active_or_better_cents: null,
    });
    const realRelationships = source({
      source_id: 'small-dinner',
      new_contacts: 4,
      active_or_better: 3,
      cost_per_new_contact_cents: 25_000,
      cost_per_active_or_better_cents: 33_000,
    });

    expect([cardCollector, realRelationships].sort(byCostPerNewContact)[0]!.source_id).toBe(
      'expo-with-a-fishbowl',
    );
    expect(rankEvents([cardCollector, realRelationships])[0]!.source_id).toBe('small-dinner');
  });
});

describe('against the fixtures', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  }, 60_000);

  afterAll(async () => {
    await h?.close();
  });

  it('the two rankings actually disagree on this data', async () => {
    // If they agreed, the choice would be academic and this screen could sort
    // on either. They do not, which is what makes it a decision.
    const rows = await h.sql<{
      source_id: string;
      display_name: string;
      new_contacts: number;
      active_or_better: number;
      cost_total_cents: string | null;
      cost_per_new_contact_cents: string | null;
      cost_per_active_or_better_cents: string | null;
    }>(`
      select source_id, display_name, new_contacts, active_or_better, cost_total_cents,
             cost_per_new_contact_cents, cost_per_active_or_better_cents
        from v_source_roi
       where cost_total_cents is not null;
    `);

    // Postgres returns bigint over the wire as a string.
    const events: Array<RankableSource & { display_name: string }> = rows.map((row) => ({
      source_id: row.source_id,
      display_name: row.display_name,
      new_contacts: row.new_contacts,
      active_or_better: row.active_or_better,
      cost_total_cents: row.cost_total_cents === null ? null : Number(row.cost_total_cents),
      cost_per_new_contact_cents:
        row.cost_per_new_contact_cents === null ? null : Number(row.cost_per_new_contact_cents),
      cost_per_active_or_better_cents:
        row.cost_per_active_or_better_cents === null
          ? null
          : Number(row.cost_per_active_or_better_cents),
    }));

    expect(events.length).toBeGreaterThan(1);

    const byActive = rankEvents(events).map((row) => row.display_name);
    const byContact = [...events].sort(byCostPerNewContact).map((row) => row.display_name);

    expect(byActive).not.toEqual(byContact);
  });

  it('ranks only events that have reached the horizon', async () => {
    const rows = await h.sql<{
      source_id: string;
      new_contacts: number;
      active_or_better: number;
      cost_total_cents: string | null;
      cost_per_new_contact_cents: string | null;
      cost_per_active_or_better_cents: string | null;
    }>(`select * from v_source_cohort where horizon_days = 365;`);

    // The cohort view has already dropped the immature ones; the screen ranks
    // exactly what it returns and lists the rest separately.
    const ranked = rankEvents(
      rows.map((row) => ({
        source_id: row.source_id,
        new_contacts: row.new_contacts,
        active_or_better: row.active_or_better,
        cost_total_cents: row.cost_total_cents === null ? null : Number(row.cost_total_cents),
        cost_per_new_contact_cents:
          row.cost_per_new_contact_cents === null ? null : Number(row.cost_per_new_contact_cents),
        cost_per_active_or_better_cents:
          row.cost_per_active_or_better_cents === null
            ? null
            : Number(row.cost_per_active_or_better_cents),
      })),
    );

    expect(ranked.length).toBe(rows.length);
    expect(ranked.length).toBeGreaterThan(0);
  });
});
