/**
 * Phase 0 / Phase 3 acceptance: the stage ladder at historical dates, and
 * horizon-matched event economics.
 *
 * The point of the whole horizon mechanism: economics improve as relationships
 * mature, so ranking events on today's numbers systematically favours older
 * ones. An event from two years ago has had two years for cards to become deal
 * sources. Every metric is therefore computed at fixed ages as well as at
 * present, and events are ranked against each other at the same age.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/db.js';
import { PERSON, SOURCE } from '../helpers/fixtures.js';
import type { SourceMetricsRow } from '../../src/lib/db/database.types.js';

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h?.close();
});

async function stageAt(personId: string, daysAgo: number): Promise<string | null> {
  const [row] = await h.sql<{ stage: string | null }>(
    `select fn_person_stage($1, now() - make_interval(days => $2::int)) as stage;`,
    [personId, daysAgo],
  );
  return row!.stage;
}

describe('fn_person_stage across all four rungs', () => {
  it('climbs Card → Active for a contact who develops late', async () => {
    // Nina met the operator at Expo East 400 days ago and had one substantive
    // conversation 100 days ago.
    expect(await stageAt(PERSON.ninaOkafor, 410)).toBeNull(); // before first contact
    expect(await stageAt(PERSON.ninaOkafor, 300)).toBe('card');
    expect(await stageAt(PERSON.ninaOkafor, 220)).toBe('card');
    expect(await stageAt(PERSON.ninaOkafor, 0)).toBe('active');
  });

  it('climbs Card → Producing for a contact who sources a deal', async () => {
    // Grant met the operator at Expo East, then referred the Bluepoch
    // receivable 80 days ago. No edit was made to the event record.
    expect(await stageAt(PERSON.grantWhitfield, 300)).toBe('card');
    expect(await stageAt(PERSON.grantWhitfield, 200)).toBe('card');
    expect(await stageAt(PERSON.grantWhitfield, 0)).toBe('producing');
  });

  it('reports Contact for two touches with nothing substantive', async () => {
    expect(await stageAt(PERSON.hollisTran, 390)).toBe('card');
    expect(await stageAt(PERSON.hollisTran, 0)).toBe('contact');
  });

  it('lets Producing win over Active', async () => {
    // Adrienne has recent substantive contact *and* has made introductions.
    // Evaluated in descending order, so Producing wins.
    expect(await stageAt(PERSON.adrienneDeLisio, 0)).toBe('producing');
  });

  it('falls back from Active when substantive contact ages past twelve months', async () => {
    // Rosalind's only substantive touch was 400 days ago. She was Active then
    // and is not now.
    expect(await stageAt(PERSON.rosalindPike, 380)).toBe('active');
    expect(await stageAt(PERSON.rosalindPike, 0)).toBe('contact');
  });
});

describe('horizon-matched event comparison', () => {
  // Postgres returns bigint as a string over the wire, so the numeric columns
  // are typed as strings here rather than reusing SourceMetricsRow.
  type Metrics = Omit<
    SourceMetricsRow,
    | 'cost_total_cents'
    | 'funded_dollars_cents'
    | 'commissions_earned_cents'
    | 'cost_per_new_contact_cents'
    | 'cost_per_active_or_better_cents'
    | 'cost_per_producing_cents'
    | 'return_multiple'
  > & {
    cost_total_cents: string | null;
    funded_dollars_cents: string;
    commissions_earned_cents: string;
    cost_per_new_contact_cents: string | null;
    cost_per_active_or_better_cents: string | null;
    cost_per_producing_cents: string | null;
    return_multiple: string | null;
  };

  async function metrics(sourceId: string, horizon: number | null): Promise<Metrics> {
    const [row] = await h.sql<Metrics>(`select * from fn_source_metrics($1, $2);`, [
      sourceId,
      horizon,
    ]);
    return row!;
  }

  it('shows an event looking worse at day 180 than at present', async () => {
    // Expo East's contacts developed late: two of them crossed into
    // Active/Producing after day 180. Measuring at 180 must see that.
    const at180 = await metrics(SOURCE.expoEast2025, 180);
    const now = await metrics(SOURCE.expoEast2025, null);

    expect(at180.active_or_better).toBeLessThan(now.active_or_better);
    expect(at180.stage_card).toBeGreaterThan(now.stage_card);
    expect(now.stage_producing).toBeGreaterThan(at180.stage_producing);

    expect(Number(at180.cost_per_active_or_better_cents)).toBeGreaterThan(
      Number(now.cost_per_active_or_better_cents),
    );
  });

  it('inverts the ranking of two events between day 90 and the present', async () => {
    // This is the entire reason horizons exist. Expo East is 400 days old and
    // slow; Broker Fest 2026 is 100 days old and fast.
    const expoAt90 = await metrics(SOURCE.expoEast2025, 90);
    const brokerAt90 = await metrics(SOURCE.brokerFest2026, 90);

    // At the same age, the newer event is doing better per dollar.
    expect(Number(brokerAt90.cost_per_active_or_better_cents)).toBeLessThan(
      Number(expoAt90.cost_per_active_or_better_cents),
    );

    const expoNow = await metrics(SOURCE.expoEast2025, null);
    const brokerNow = await metrics(SOURCE.brokerFest2026, null);

    // Judged on today's numbers the older event wins — which is exactly the
    // bias horizon matching exists to remove.
    expect(Number(expoNow.cost_per_active_or_better_cents)).toBeLessThan(
      Number(brokerNow.cost_per_active_or_better_cents),
    );
  });

  it('resolves tier from history rather than from today', async () => {
    // Promote a contact today. The day-90 tier count must not move.
    const at90Before = (await metrics(SOURCE.expoEast2025, 90)).tier_ab_contacts;
    const presentBefore = (await metrics(SOURCE.expoEast2025, null)).tier_ab_contacts;

    await h.sql(`update people set tier = 'A' where id = $1;`, [PERSON.ninaOkafor]);

    // The day-90 figure is a statement about what was true 90 days after the
    // event. Promoting someone today cannot change it.
    expect((await metrics(SOURCE.expoEast2025, 90)).tier_ab_contacts).toBe(at90Before);

    // The present-day figure is the current picture, and does move.
    expect((await metrics(SOURCE.expoEast2025, null)).tier_ab_contacts).toBe(presentBefore + 1);

    await h.sql(`update people set tier = 'C' where id = $1;`, [PERSON.ninaOkafor]);
  });

  it('marks an event younger than the horizon as immature', async () => {
    const winter = await metrics(SOURCE.winterDinner2026, 365); // 60 days old
    expect(winter.is_mature).toBe(false);
    expect(winter.days_since_event).toBeLessThan(365);
  });

  it('excludes immature events from the cohort surface entirely', async () => {
    const rows = await h.sql<{ display_name: string }>(
      `select display_name from v_source_cohort where horizon_days = 365;`,
    );
    const names = rows.map((r) => r.display_name);

    expect(names).toContain('Expo East 2025');
    expect(names).not.toContain('Broker Fest 2026'); // 100 days old
    expect(names).not.toContain('Naturally NY Winter Dinner 2026'); // 60 days old
  });

  it('counts relationships touched separately from new contacts', async () => {
    // Seeing fifteen existing relationships at a conference is a legitimate
    // reason to attend, and must never flatter the new-contact denominator.
    const before = await metrics(SOURCE.brokerFest2026, null);

    await h.sql(
      `insert into touchpoints (person_id, occurred_at, channel, direction, substantive, source_id)
       values ($1, now() - interval '100 days', 'meeting', 'mutual', true, $2);`,
      [PERSON.beatriceSolomon, SOURCE.brokerFest2026],
    );

    const after = await metrics(SOURCE.brokerFest2026, null);
    expect(after.relationships_touched).toBe(before.relationships_touched + 1);
    expect(after.new_contacts).toBe(before.new_contacts);
  });

  it('shows days since event beside every present-day ratio', async () => {
    // A three-week-old event with one attributed contact must read as
    // incomplete, not as a failure.
    const rows = await h.sql<{ days_since_event: number; new_contacts: number }>(
      `select days_since_event, new_contacts from v_source_roi where source_id = $1;`,
      [SOURCE.winterDinner2026],
    );
    expect(rows[0]!.days_since_event).toBeGreaterThan(0);
    expect(rows[0]!.new_contacts).toBeGreaterThan(0);
  });

  it('rolls a series up across years by event name alone', async () => {
    const [series] = await h.sql<{ editions: number; first_year: number; last_year: number }>(
      `select editions, first_year, last_year from v_source_series where event_name = 'Broker Fest';`,
    );
    expect(series).toMatchObject({ editions: 2, first_year: 2025, last_year: 2026 });
  });
});
