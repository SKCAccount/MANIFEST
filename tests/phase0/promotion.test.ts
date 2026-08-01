/**
 * Phase 0 acceptance: promotion requires two-way contact.
 *
 * A touchpoint alone does not promote a record. This is the rule that keeps the
 * watchlist from quietly turning into a lead list, and the reason Gmail sync
 * needs no special handling: an outbound email promotes nothing, and their
 * reply promotes them.
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

/** Creates a fresh watchlist entry and returns its id. */
async function addWatchlistEntry(suffix: string): Promise<string> {
  const [row] = await h.sql<{ id: string }>(
    `insert into people (first_name, last_name, contact_status, watchlist_reason, linkedin_url, city)
     values ('Test', $1, 'uncontacted', 'Worth meeting for the purposes of this test.', $2, 'Denver')
     returning id;`,
    [suffix, `linkedin.com/in/test-${suffix.toLowerCase()}`],
  );
  return row!.id;
}

async function statusOf(id: string) {
  const [row] = await h.sql<{ contact_status: string; first_contact_at: string | null }>(
    `select contact_status, first_contact_at from people where id = $1;`,
    [id],
  );
  return row!;
}

describe('outbound-only contact does not promote', () => {
  it('leaves an uncontacted record uncontacted after an outbound LinkedIn message', async () => {
    const id = await addWatchlistEntry('OutboundLinkedIn');

    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, summary)
       values ($1, 'linkedin', 'outbound', false, 'Sent a connection request.');`,
      [id],
    );

    expect(await statusOf(id)).toMatchObject({
      contact_status: 'uncontacted',
      first_contact_at: null,
    });
  });

  it('leaves it uncontacted after an outbound email', async () => {
    const id = await addWatchlistEntry('OutboundEmail');

    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, summary)
       values ($1, 'email', 'outbound', true, 'Long cold email about the co-packer news.');`,
      [id],
    );

    expect((await statusOf(id)).contact_status).toBe('uncontacted');
  });

  it('leaves it uncontacted after repeated outbound attempts', async () => {
    const id = await addWatchlistEntry('Persistent');

    for (const days of [120, 90, 60, 30]) {
      await h.sql(
        `insert into touchpoints (person_id, occurred_at, channel, direction, substantive)
         values ($1, now() - make_interval(days => $2::int), 'linkedin', 'outbound', false);`,
        [id, days],
      );
    }

    expect((await statusOf(id)).contact_status).toBe('uncontacted');
  });

  it('holds for the Colorado Springs fixture, which has two attempts on record', async () => {
    // The spec's own example: a LinkedIn message to someone in Colorado Springs
    // that goes unanswered stays exactly that — a watchlist entry with an
    // attempt on the record.
    const curtis = await statusOf(PERSON.curtisAlderman);
    expect(curtis).toMatchObject({ contact_status: 'uncontacted', first_contact_at: null });

    const [attempts] = await h.sql<{ outreach_attempts: number; last_attempt_channel: string }>(
      `select outreach_attempts, last_attempt_channel from v_watchlist where person_id = $1;`,
      [PERSON.curtisAlderman],
    );
    expect(attempts!.outreach_attempts).toBe(2);
    expect(attempts!.last_attempt_channel).toBe('linkedin');
  });
});

describe('two-way contact promotes', () => {
  it('promotes on an inbound reply, stamping first contact at the reply', async () => {
    const id = await addWatchlistEntry('InboundReply');

    await h.sql(
      `insert into touchpoints (person_id, occurred_at, channel, direction, substantive, summary)
       values ($1, now() - interval '40 days', 'email', 'outbound', false, 'Cold outreach.');`,
      [id],
    );
    expect((await statusOf(id)).contact_status).toBe('uncontacted');

    await h.sql(
      `insert into touchpoints (person_id, occurred_at, channel, direction, substantive, summary)
       values ($1, now() - interval '38 days', 'email', 'inbound', true, 'He replied.');`,
      [id],
    );

    const after = await statusOf(id);
    expect(after.contact_status).toBe('active');
    expect(after.first_contact_at).not.toBeNull();

    // Stamped at the reply, not at the outbound attempt that preceded it.
    const [check] = await h.sql<{ matches: boolean }>(
      `select p.first_contact_at = t.occurred_at as matches
       from people p
       join touchpoints t on t.person_id = p.id and t.direction = 'inbound'
       where p.id = $1;`,
      [id],
    );
    expect(check!.matches).toBe(true);
  });

  it('promotes on a mutual touchpoint', async () => {
    const id = await addWatchlistEntry('Mutual');
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive)
       values ($1, 'call', 'mutual', true);`,
      [id],
    );
    expect((await statusOf(id)).contact_status).toBe('active');
  });

  it('promotes on a meeting, which is two-way by definition', async () => {
    // Direction is outbound — the operator set it up — but a meeting still
    // promotes, which is what makes calendar sync correct with no special case.
    const id = await addWatchlistEntry('Meeting');
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive)
       values ($1, 'meeting', 'outbound', true);`,
      [id],
    );
    expect((await statusOf(id)).contact_status).toBe('active');
  });

  it('does not promote on a system touchpoint', async () => {
    const id = await addWatchlistEntry('SystemOnly');
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive, source)
       values ($1, 'system', 'outbound', false, 'system');`,
      [id],
    );
    expect((await statusOf(id)).contact_status).toBe('uncontacted');
  });

  it('pulls first contact back when backfill surfaces an earlier qualifying touch', async () => {
    const id = await addWatchlistEntry('Backfill');

    await h.sql(
      `insert into touchpoints (person_id, occurred_at, channel, direction, substantive)
       values ($1, now() - interval '30 days', 'call', 'inbound', true);`,
      [id],
    );
    const promoted = await statusOf(id);

    await h.sql(
      `insert into touchpoints (person_id, occurred_at, channel, direction, substantive)
       values ($1, now() - interval '400 days', 'meeting', 'mutual', true);`,
      [id],
    );
    const backfilled = await statusOf(id);

    expect(new Date(backfilled.first_contact_at!).getTime()).toBeLessThan(
      new Date(promoted.first_contact_at!).getTime(),
    );
  });

  it('keeps the watchlist reason after promotion', async () => {
    // "I wanted to meet this person because X, and now I have" is signal worth
    // keeping. The UI stops showing it; the record does not lose it.
    const id = await addWatchlistEntry('KeepsReason');
    await h.sql(
      `insert into touchpoints (person_id, channel, direction, substantive) values ($1, 'call', 'inbound', true);`,
      [id],
    );

    const [row] = await h.sql<{ contact_status: string; watchlist_reason: string }>(
      `select contact_status, watchlist_reason from people where id = $1;`,
      [id],
    );
    expect(row!.contact_status).toBe('active');
    expect(row!.watchlist_reason).toMatch(/Worth meeting/);
  });
});
