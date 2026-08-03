-- 0020_sync_tables.sql
-- Phase 2 — Gmail and Calendar sync.
--
-- Three tables, each answering a question the existing schema could not:
--
--   google_credentials  who are we signed in as, and with what refresh token
--   sync_runs           did the job run, when, and what did it do
--   sync_messages       which individual messages have we already accounted for
--
-- `sync_state` (0009) already holds the per-channel cursor and is not
-- duplicated here. The split is deliberate: `sync_state` is current position,
-- `sync_runs` is history. A cursor that has not moved in a week and a job that
-- has not run in a week look identical from `sync_state` alone.

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- google_credentials
-- ---------------------------------------------------------------------------
-- One row per connected Google account. Realistically one row ever — this is a
-- single-operator system — but keyed by address rather than assumed singular,
-- so reconnecting as a different account is a row rather than a migration.
--
-- The refresh token is the most dangerous value in this database. It is a
-- standing grant to read the operator's entire mailbox and calendar, it does
-- not expire on its own, and unlike a Supabase session it cannot be revoked
-- from inside this app. It must therefore be readable by strictly less than
-- the rest of the schema — see the grant block at the bottom of this file.

create table google_credentials (
  id                       uuid primary key default gen_random_uuid(),
  account_email            citext not null unique,

  -- The standing grant. Long-lived, and the only thing here that cannot be
  -- re-derived: losing it means the operator reconnects, losing the access
  -- token means one refresh call.
  refresh_token            text not null,

  -- Cached so a sync run that starts inside the hour skips the refresh round
  -- trip. Always safe to null out.
  access_token             text,
  access_token_expires_at  timestamptz,

  -- What Google actually granted, which is not necessarily what was asked for:
  -- the consent screen lets someone tick the Gmail box and not the Calendar
  -- one. Recorded so the status screen can say "Calendar is not connected"
  -- rather than letting the calendar job fail with a 403 every hour.
  scopes                   text[] not null default '{}',

  connected_at             timestamptz not null default now(),
  revoked_at               timestamptz,
  last_refresh_at          timestamptz,
  last_refresh_error       text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint google_credentials_refresh_token_present check (btrim(refresh_token) <> '')
);

comment on table google_credentials is
  'Google OAuth grant for Phase 2 sync. The token columns are deliberately excluded from the authenticated role''s column grants: the operator''s UI can see that a connection exists without being able to read the credential behind it.';

-- At most one live connection at a time. A unique index over a constant
-- expression is the standard way to say "at most one row matching this
-- predicate": every live row indexes the same value, so the second one is
-- rejected. Connecting a different account therefore has to revoke the first,
-- which is the intended discipline — two live grants would mean sync silently
-- reads whichever mailbox the code happened to pick.
create unique index google_credentials_live_key on google_credentials ((true))
  where revoked_at is null;

create trigger trg_google_credentials_updated_at
  before update on google_credentials
  for each row execute function fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- sync_runs
-- ---------------------------------------------------------------------------
-- One row per execution of one channel. Written at the start with status
-- 'running' and closed out at the end, so a job that dies mid-flight leaves a
-- visible open row rather than no evidence at all.
--
-- `counts` is jsonb rather than a column per metric because the interesting
-- numbers differ by channel — Gmail counts threads and messages, Calendar
-- counts events and attendees — and neither set is worth a migration to
-- extend.

create table sync_runs (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null,
  status         text not null default 'running',

  -- 'live' or 'fixture'. Recorded per run because a run against canned data
  -- proves nothing about the real mailbox, and six months from now nobody will
  -- remember which runs were which.
  provider_kind  text not null default 'live',

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  cursor_before  text,
  cursor_after   text,
  counts         jsonb not null default '{}'::jsonb,
  error          text,
  created_at     timestamptz not null default now(),

  constraint sync_runs_channel_present check (btrim(channel) <> ''),
  constraint sync_runs_status_known check (status in ('running', 'ok', 'error', 'skipped')),
  constraint sync_runs_provider_known check (provider_kind in ('live', 'fixture')),
  constraint sync_runs_finished_has_status check (status = 'running' or finished_at is not null),
  constraint sync_runs_error_has_message check (status <> 'error' or error is not null)
);

create index sync_runs_channel_idx on sync_runs (channel, started_at desc);
create index sync_runs_open_idx    on sync_runs (started_at desc) where status = 'running';

comment on table sync_runs is
  'History of sync executions. sync_state holds the current cursor; this holds what happened. A stalled cursor and a job that stopped running are indistinguishable without it.';

-- ---------------------------------------------------------------------------
-- sync_messages
-- ---------------------------------------------------------------------------
-- The ledger of every individual message or event the sync has accounted for.
--
-- This is what makes the thread-day rollup work. One touchpoint represents a
-- whole day of one email thread, so when a later message lands in that same
-- thread on that same day, the correction has to be computed from *every*
-- message in the group — including the ones a previous run already processed
-- and would otherwise never look at again. Without this table the only way to
-- recompute would be to re-fetch the entire thread from Google on every run.
--
-- Deliberately holds no content: message ids, timing and direction only. No
-- subject, no snippet, no addresses. The addresses that matter (the ones that
-- matched nobody) go to `staging_records` where the operator can act on them;
-- the rest are not this system's business.

create table sync_messages (
  id             uuid primary key default gen_random_uuid(),
  channel        text not null,

  -- Gmail message id, or Calendar event id.
  external_id    text not null,

  -- What the rollup groups by: Gmail threadId, or the Calendar event id again
  -- (a calendar event is its own group of one — it needs no rollup, and is
  -- recorded here purely so a re-run can tell "already handled" from "new").
  thread_key     text not null,

  -- Null when no person matched. The row is still written, so a re-run does
  -- not re-stage an address the operator has already dismissed.
  person_id      uuid references people (id) on delete cascade,

  occurred_at    timestamptz not null,

  -- Generated rather than passed in, so the rollup boundary is the operator's
  -- day as defined in exactly one place (fn_local_date). A message at 9pm on
  -- the 4th belongs to the 4th.
  local_date     date generated always as (fn_local_date(occurred_at)) stored,

  direction      touch_direction not null,
  touchpoint_id  uuid references touchpoints (id) on delete set null,
  seen_at        timestamptz not null default now(),

  constraint sync_messages_channel_present check (btrim(channel) <> ''),
  constraint sync_messages_external_id_present check (btrim(external_id) <> '')
);

-- NULLS NOT DISTINCT is doing real work here.
--
-- person_id is null for every message sync could not match to anybody, and
-- Postgres treats nulls as distinct by default — so a plain unique index would
-- cheerfully accept the same unmatched message a hundred times, once per run.
-- The obvious alternative is a pair of partial indexes (one for matched rows,
-- one for unmatched), and that was the first shape this took. It is wrong for a
-- reason that only shows up against a real PostgREST: an upsert can only infer
-- its arbiter from a *total* unique index, so `on_conflict=channel,external_id,
-- person_id` fails with "no unique or exclusion constraint matching the ON
-- CONFLICT specification" — while passing against a test adapter that writes
-- bare `on conflict do nothing`.
--
-- One total index keeps both write paths honest and says the intended thing
-- outright: one row per message per person, and one row per message that
-- belongs to nobody.
create unique index sync_messages_key
  on sync_messages (channel, external_id, person_id) nulls not distinct;

create index sync_messages_group_idx on sync_messages (channel, thread_key, person_id, local_date);
create index sync_messages_touchpoint_idx on sync_messages (touchpoint_id) where touchpoint_id is not null;

comment on table sync_messages is
  'Every message or event the sync has accounted for. Holds ids and timing only — never subjects, snippets or addresses. Exists so a thread-day correction can be recomputed from the whole group without re-fetching from Google.';

-- ---------------------------------------------------------------------------
-- Access control
-- ---------------------------------------------------------------------------
-- 0017's policy loop ran over the tables that existed at the time, so these
-- three get nothing by default — which is the safe direction, and exactly what
-- that migration's comment promised: a new table without a policy is
-- unreachable rather than public.

alter table google_credentials enable row level security;
alter table sync_runs          enable row level security;
alter table sync_messages      enable row level security;

-- sync_runs and sync_messages follow the ordinary pattern: the owner reads,
-- and the jobs (service_role) write.
create policy sync_runs_owner_select on sync_runs
  for select to authenticated using (fn_is_owner());
create policy sync_messages_owner_select on sync_messages
  for select to authenticated using (fn_is_owner());

grant select on sync_runs, sync_messages to authenticated;
grant all    on sync_runs, sync_messages to service_role;

-- google_credentials does not.
--
-- The status screen needs to answer "are we connected, as whom, since when,
-- and did the last refresh fail" — none of which requires the token. RLS is
-- row-level and cannot express that, so the restriction is a column grant:
-- `authenticated` is granted SELECT on the metadata columns and on nothing
-- else. `refresh_token` and `access_token` are simply absent from the list, so
-- a compromised anon key, a mistaken `select *` in a server component, or a
-- PostgREST request naming the column all fail at the privilege layer rather
-- than depending on nobody having asked.
--
-- Writes are service_role only. The connect flow runs server-side.
create policy google_credentials_owner_select on google_credentials
  for select to authenticated using (fn_is_owner());

grant select (
  id, account_email, scopes, connected_at, revoked_at,
  last_refresh_at, last_refresh_error, access_token_expires_at,
  created_at, updated_at
) on google_credentials to authenticated;

grant all on google_credentials to service_role;

revoke all on google_credentials, sync_runs, sync_messages from anon;
