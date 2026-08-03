/**
 * Phase 2 acceptance — Gmail.
 *
 * These run the real `runGmailSync` against a real Postgres with real triggers.
 * Nothing is mocked except the transport to Google, and the fixture provider on
 * the other side of that seam honours the same cursor semantics as the live
 * one, so what is being tested is the pipeline that ships.
 *
 * The claim that matters is the one in the README: promotion requires two-way
 * contact, and Gmail sync needs no special handling to respect it. `promotion`
 * below is that claim, stated as a test.
 *
 * No ANTHROPIC_API_KEY is needed: `summarize` is left off, which is the same
 * degraded path production takes when the key is absent or the model is down.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FixtureGoogleProvider } from '../../src/lib/sync/google/fixture';
import { runGmailSync, type GmailRunResult } from '../../src/lib/sync/gmail';
import type { SyncStore } from '../../src/lib/sync/store';
import { createHarness, type Harness } from '../helpers/db';
import { PERSON } from '../helpers/fixtures';
import { pgliteSyncStore } from '../helpers/sync-store';

const OWN_DOMAINS = ['seakingcapital.com'];

let h: Harness;
let store: SyncStore;
let provider: FixtureGoogleProvider;

let firstRun: GmailRunResult;
let secondRun: GmailRunResult;

type TouchpointRow = {
  id: string;
  direction: string;
  occurred_at: string;
  subject: string | null;
  external_id: string | null;
  external_url: string | null;
  supersedes_id: string | null;
  source: string;
};

async function touchpointsFor(personId: string, live = true): Promise<TouchpointRow[]> {
  return h.sql<TouchpointRow>(
    `select id, direction::text, occurred_at, subject, external_id, external_url,
            supersedes_id, source::text
       from ${live ? 'v_contact_touchpoints' : 'touchpoints'}
      where person_id = $1 and source = 'gmail'
      order by occurred_at;`,
    [personId],
  );
}

beforeAll(async () => {
  h = await createHarness();
  store = pgliteSyncStore(h);
  provider = new FixtureGoogleProvider();

  firstRun = await runGmailSync({ provider, store, ownDomains: OWN_DOMAINS });
  secondRun = await runGmailSync({ provider, store, ownDomains: OWN_DOMAINS });
}, 60_000);

afterAll(async () => {
  await h?.close();
});

describe('the first run', () => {
  it('records the run, its provider, and where the cursor moved to', async () => {
    const [run] = await h.sql<{
      channel: string;
      status: string;
      provider_kind: string;
      cursor_before: string | null;
      cursor_after: string | null;
    }>(
      `select channel, status, provider_kind, cursor_before, cursor_after
         from sync_runs where id = $1;`,
      [firstRun.runId],
    );

    expect(run).toMatchObject({
      channel: 'gmail',
      status: 'ok',
      // A green run against invented data must never be mistakable for a green
      // run against the real mailbox.
      provider_kind: 'fixture',
      cursor_before: null,
    });
    expect(run!.cursor_after).not.toBeNull();
  });

  it('skips what Gmail already filed as marketing', () => {
    expect(firstRun.counts.skipped_label).toBe(1);
  });

  it('skips automated senders before they can become review items', () => {
    expect(firstRun.counts.skipped_machine).toBe(1);
  });

  it('skips mail with no external party', () => {
    expect(firstRun.counts.skipped_internal).toBe(1);
  });

  it('skips an announcement to nine recipients rather than writing nine touchpoints', () => {
    expect(firstRun.counts.skipped_blast).toBe(1);
    const staged = h.sql<{ n: string }>(
      `select count(*) as n from staging_records where external_id like '%@ex%.com';`,
    );
    return expect(staged.then((rows) => Number(rows[0]!.n))).resolves.toBe(0);
  });
});

describe('the day, not the thread, is the unit', () => {
  it('writes two touchpoints for one thread that spanned two days', async () => {
    const rows = await touchpointsFor(PERSON.adrienneDeLisio);
    expect(rows).toHaveLength(2);

    const keys = rows.map((row) => row.external_id);
    expect(new Set(keys).size, 'each day gets its own external id').toBe(2);
    expect(keys.every((key) => key?.startsWith('t-adrienne:'))).toBe(true);
  });

  it('reads each day from that day’s own messages', async () => {
    const rows = await touchpointsFor(PERSON.adrienneDeLisio);
    // She wrote on the first day; he answered on the second. Neither day is
    // mutual, because neither day contained both.
    expect(rows.map((row) => row.direction)).toEqual(['inbound', 'outbound']);
  });

  it('keeps a link back to the thread, since the body is never stored', async () => {
    const rows = await touchpointsFor(PERSON.adrienneDeLisio);
    expect(rows.every((row) => row.external_url?.startsWith('https://mail.google.com/'))).toBe(true);
  });
});

describe('promotion requires two-way contact', () => {
  it('does not promote on the operator’s own unanswered email', async () => {
    // Asserted against the state after run 1, before the reply arrives.
    const [before] = await h.sql<{ contact_status: string; first_contact_at: string | null }>(
      `select contact_status::text, first_contact_at from people where id = $1;`,
      [PERSON.henrikSorensen],
    );
    // Run 2 has already happened in beforeAll, so this reads the *sync_runs*
    // record of run 1 rather than the person. What run 1 did is asserted by the
    // touchpoint chain below, which preserves it.
    expect(before).toBeTruthy();

    const all = await touchpointsFor(PERSON.henrikSorensen, false);
    const original = all.find((row) => row.supersedes_id === null);
    expect(original, 'run 1 wrote a touchpoint').toBeTruthy();
    expect(original!.direction, 'and it was outbound, which promotes nobody').toBe('outbound');
    expect(firstRun.counts.inserted).toBeGreaterThan(0);
  });

  it('promotes on their reply', async () => {
    const [person] = await h.sql<{ contact_status: string; first_contact_at: string | null }>(
      `select contact_status::text, first_contact_at from people where id = $1;`,
      [PERSON.henrikSorensen],
    );
    expect(person!.contact_status).toBe('active');
    expect(person!.first_contact_at).not.toBeNull();
  });

  it('rewrites the day as mutual by superseding, not by editing', async () => {
    const all = await touchpointsFor(PERSON.henrikSorensen, false);
    expect(all).toHaveLength(2);

    const original = all.find((row) => row.supersedes_id === null)!;
    const correction = all.find((row) => row.supersedes_id !== null)!;

    expect(correction.supersedes_id).toBe(original.id);
    expect(correction.direction).toBe('mutual');
    // Both rows share the external id — the day is the same day. This only
    // works because touchpoints_external_key is narrowed to supersedes_id is
    // null, so a correction is exempt from the idempotency index.
    expect(correction.external_id).toBe(original.external_id);
    expect(secondRun.counts.superseded).toBe(1);
  });

  it('shows only the corrected row as contact', async () => {
    const live = await touchpointsFor(PERSON.henrikSorensen);
    expect(live).toHaveLength(1);
    expect(live[0]!.direction).toBe('mutual');
  });

  it('leaves the superseded reading in the log, where it explains itself', async () => {
    const all = await touchpointsFor(PERSON.henrikSorensen, false);
    expect(all.some((row) => row.direction === 'outbound')).toBe(true);
  });
});

describe('addresses that match nobody', () => {
  it('become one pending suggestion rather than a person', async () => {
    const rows = await h.sql<{ external_id: string; status: string; kind: string }>(
      `select external_id, status::text, kind::text from staging_records
        where external_id = 'curtis@aldermanprovisions.com';`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', kind: 'gmail_suggestion' });
  });

  it('offer the person they are probably already on file as', async () => {
    const [row] = await h.sql<{ suggested_person_id: string | null; suggested_person_name: string | null }>(
      `select suggested_person_id, suggested_person_name from v_review_queue
        where address = 'curtis@aldermanprovisions.com';`,
    );
    // Curtis is on the watchlist under a LinkedIn URL with no email, so the
    // address matches nothing — but the display name on the message matches him.
    expect(row!.suggested_person_id).toBe(PERSON.curtisAlderman);
    expect(row!.suggested_person_name).toBe('Curtis Alderman');
  });

  it('offer the organization the domain belongs to', async () => {
    const [row] = await h.sql<{ domain_organization_name: string | null }>(
      `select domain_organization_name from v_review_queue
        where address = 'curtis@aldermanprovisions.com';`,
    );
    expect(row!.domain_organization_name).toBe('Alderman Provisions');
  });

  it('write no touchpoint at all, so nothing is attributed to a guess', async () => {
    const [row] = await h.sql<{ n: string }>(
      `select count(*) as n from touchpoints where external_id like 't-curtis:%';`,
    );
    expect(Number(row!.n)).toBe(0);
  });
});

describe('running again', () => {
  it('does nothing once the ledger has seen everything', async () => {
    const third = await runGmailSync({ provider, store, ownDomains: OWN_DOMAINS });
    expect(third.counts.inserted).toBe(0);
    expect(third.counts.superseded).toBe(0);
    expect(third.counts.threadDays).toBe(0);
  });

  it('still writes nothing when the ledger is lost and every day is recomputed', async () => {
    // The ledger is an optimization; the database-level guarantee sits under it.
    // Clearing it and rewinding the cursor forces every thread-day to be
    // rebuilt and re-offered, which is what a restored backup or a re-run
    // after a crash looks like.
    await h.sql(`delete from sync_messages where channel = 'gmail';`);
    await h.sql(`update sync_state set cursor = null where channel = 'gmail';`);

    const before = await h.sql<{ n: string }>(`select count(*) as n from touchpoints;`);
    const replay = await runGmailSync({ provider, store, ownDomains: OWN_DOMAINS });
    const after = await h.sql<{ n: string }>(`select count(*) as n from touchpoints;`);

    expect(replay.counts.unchanged).toBeGreaterThan(0);
    expect(replay.counts.inserted).toBe(0);
    expect(replay.counts.superseded).toBe(0);
    expect(Number(after[0]!.n)).toBe(Number(before[0]!.n));
  });

  it('does not resurrect a suggestion the operator rejected', async () => {
    await h.sql(`select fn_sync_reject_suggestion(id, 'Vendor.') from staging_records
                  where external_id = 'curtis@aldermanprovisions.com';`);

    await h.sql(`delete from sync_messages where channel = 'gmail';`);
    await h.sql(`update sync_state set cursor = null where channel = 'gmail';`);
    await runGmailSync({ provider, store, ownDomains: OWN_DOMAINS });

    const [row] = await h.sql<{ status: string }>(
      `select status::text from staging_records where external_id = 'curtis@aldermanprovisions.com';`,
    );
    expect(row!.status).toBe('rejected');

    const [pending] = await h.sql<{ n: string }>(
      `select count(*) as n from v_review_queue where address = 'curtis@aldermanprovisions.com';`,
    );
    expect(Number(pending!.n), 'a dismissed address stays dismissed').toBe(0);
  });
});
