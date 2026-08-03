/**
 * Phase 2 acceptance — Calendar.
 *
 * Calendar is the channel that can promote. `channel = 'meeting'` qualifies
 * under trg_first_contact regardless of direction, so every rule tested here is
 * ultimately about the same question: did this person actually meet the
 * operator, or does the calendar merely contain their name?
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCalendarSync, stableGroupKey, type CalendarRunResult } from '../../src/lib/sync/calendar';
import { FixtureGoogleProvider } from '../../src/lib/sync/google/fixture';
import type { SyncStore } from '../../src/lib/sync/store';
import { createHarness, type Harness } from '../helpers/db';
import { PERSON } from '../helpers/fixtures';
import { pgliteSyncStore } from '../helpers/sync-store';

const OWN_DOMAINS = ['seakingcapital.com'];

let h: Harness;
let store: SyncStore;
let run: CalendarRunResult;

async function meetingsFor(personId: string) {
  return h.sql<{
    channel: string;
    direction: string;
    substantive: boolean;
    subject: string | null;
    external_id: string | null;
    group_key: string | null;
  }>(
    `select channel::text, direction::text, substantive, subject, external_id, group_key
       from v_contact_touchpoints
      where person_id = $1 and source = 'gcal';`,
    [personId],
  );
}

beforeAll(async () => {
  h = await createHarness();
  store = pgliteSyncStore(h);
  run = await runCalendarSync({ provider: new FixtureGoogleProvider(), store, ownDomains: OWN_DOMAINS });
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe('a meeting that happened', () => {
  it('writes one touchpoint per external attendee who was there', async () => {
    const erica = await meetingsFor(PERSON.ericaGendell);
    const marcus = await meetingsFor(PERSON.marcusVance);

    expect(erica).toHaveLength(1);
    // Tentative counts. Someone who marked "maybe" and was not heard from again
    // is far more likely to have come than not, and the cost of being wrong is
    // one touchpoint the operator can supersede.
    expect(marcus).toHaveLength(1);
    expect(run.counts.inserted).toBe(2);
  });

  it('records it as a meeting, which is what makes it two-way', async () => {
    const [row] = await meetingsFor(PERSON.ericaGendell);
    expect(row).toMatchObject({ channel: 'meeting', direction: 'mutual' });
  });

  it('groups the attendees so the timeline shows one dinner, not two', async () => {
    const [erica] = await meetingsFor(PERSON.ericaGendell);
    const [marcus] = await meetingsFor(PERSON.marcusVance);
    expect(erica!.group_key).toBe(marcus!.group_key);
    expect(erica!.group_key).toBe(stableGroupKey('ev-dinner'));
  });

  it('counts a long conversation with two people as substantive', async () => {
    const [row] = await meetingsFor(PERSON.ericaGendell);
    // 90 minutes, two external attendees — a real conversation, so it resets
    // the cadence clock.
    expect(row!.substantive).toBe(true);
  });

  it('leaves the conference room out of the rolodex', async () => {
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from staging_records where external_id like 'room-%';`,
    );
    expect(Number(row!.n)).toBe(0);
  });
});

describe('a meeting that did not', () => {
  it('records nothing for an attendee who declined', async () => {
    expect(await meetingsFor(PERSON.rosalindPike)).toHaveLength(0);
    expect(run.counts.skipped_declined).toBe(1);
  });

  it('records nothing for a cancelled event', async () => {
    expect(await meetingsFor(PERSON.grantWhitfield)).toHaveLength(0);
    expect(run.counts.skipped_cancelled).toBe(1);
  });

  it('records nothing for a meeting that has not happened yet', async () => {
    expect(await meetingsFor(PERSON.beatriceSolomon)).toHaveLength(0);
    expect(run.counts.skipped_future).toBe(1);
  });

  it('records nothing for blocked time with no attendees', () => {
    expect(run.counts.skipped_internal).toBe(1);
  });
});

describe('an attendee who never replied to the invitation', () => {
  it('is asked about rather than assumed either way', async () => {
    const rows = await h.sql<{ status: string; kind: string; last_direction: string | null }>(
      `select r.status::text, r.kind::text, q.last_direction
         from staging_records r
         join v_review_queue q on q.id = r.id
        where r.external_id = 'dl@lattimoreadvisors.com';`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', kind: 'calendar_suggestion' });
    expect(rows[0]!.last_direction).toBe('unconfirmed');
  });

  it('gets no touchpoint in the meantime', async () => {
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from touchpoints where external_id = 'ev-needsaction';`,
    );
    expect(Number(row!.n)).toBe(0);
  });
});

describe('promotion', () => {
  it('a synced meeting promotes a watchlist entry', async () => {
    // The fixture calendar only involves people who are already active, so this
    // exercises the mechanism directly: the same call runCalendarSync makes,
    // against a record that has never been contacted.
    await h.sql(`
      insert into people (id, first_name, last_name, contact_status, watchlist_reason, email_work)
      values ('11111111-0000-4000-8000-0000000000f1', 'Imogen', 'Farrow', 'uncontacted',
              'Runs the receivables desk at a bank that keeps turning up on the other side of deals.',
              'imogen@farrowbank.example');
    `);

    await h.sql(`
      select fn_sync_record_touchpoint(
        'gcal', 'ev-promotion-check', '11111111-0000-4000-8000-0000000000f1',
        'meeting', 'mutual', now() - interval '1 day', 'Coffee', null, true, null, null, null
      );
    `);

    const [person] = await h.sql<{ contact_status: string; first_contact_at: string | null }>(
      `select contact_status::text, first_contact_at from people
        where id = '11111111-0000-4000-8000-0000000000f1';`,
    );

    expect(person!.contact_status).toBe('active');
    expect(person!.first_contact_at).not.toBeNull();
  });
});

describe('running again', () => {
  it('changes nothing', async () => {
    const before = await h.sql<{ n: string }>(`select count(*) as n from touchpoints;`);
    const second = await runCalendarSync({
      provider: new FixtureGoogleProvider(),
      store,
      ownDomains: OWN_DOMAINS,
    });
    const after = await h.sql<{ n: string }>(`select count(*) as n from touchpoints;`);

    expect(second.counts.inserted).toBe(0);
    expect(second.counts.superseded).toBe(0);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
  });
});
