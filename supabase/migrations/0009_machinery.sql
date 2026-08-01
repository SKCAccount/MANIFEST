-- 0009_machinery.sql
-- The import/sync machinery gets its own tables so nothing half-matched ever
-- lands in `people` by accident.
--
-- Bulk-mail machinery is deliberately absent. MANIFEST manages outreach to
-- people the operator actually knows, one at a time; it is not a mailing-list
-- tool and holds no subscription, consent or suppression state. Sending is
-- somebody else's job, and modeling half of it here would invite the other
-- half.

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- staging_records
-- ---------------------------------------------------------------------------
-- Everything that a sync or an import could not resolve with confidence.
-- Nothing here is a person until the operator promotes it one at a time.

create table staging_records (
  id               uuid primary key default gen_random_uuid(),
  kind             staging_kind not null,
  status           staging_status not null default 'pending',
  payload          jsonb not null default '{}'::jsonb,
  confidence       numeric(4, 3),
  matched_person_id uuid references people (id) on delete set null,
  dedupe_target_id uuid references people (id) on delete set null,
  source           touch_source not null default 'import',
  external_id      text,
  note             text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint staging_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint staging_resolved_has_timestamp check (status = 'pending' or resolved_at is not null)
);

create unique index staging_external_key on staging_records (kind, source, external_id)
  where external_id is not null;
create index staging_pending_idx on staging_records (kind, created_at desc) where status = 'pending';

create trigger trg_staging_records_updated_at
  before update on staging_records
  for each row execute function fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- merge_log
-- ---------------------------------------------------------------------------
-- Reversible for 30 days. The snapshot holds the loser's full row plus the ids
-- of every child row that was reassigned, which is what reversal replays.

create table merge_log (
  id              uuid primary key default gen_random_uuid(),
  winner_person_id uuid not null references people (id) on delete cascade,
  loser_person_id  uuid not null,
  loser_snapshot   jsonb not null,
  reassigned       jsonb not null default '{}'::jsonb,
  merged_at        timestamptz not null default now(),
  reverted_at      timestamptz,
  -- A plain default rather than a generated column: casting timestamptz to date
  -- depends on the session TimeZone and so is not immutable.
  expires_on       date not null default (now() + interval '30 days')::date,
  note             text,

  constraint merge_log_distinct check (winner_person_id <> loser_person_id)
);

create index merge_log_winner_idx on merge_log (winner_person_id);
create index merge_log_open_idx   on merge_log (merged_at desc) where reverted_at is null;

-- ---------------------------------------------------------------------------
-- sync_state
-- ---------------------------------------------------------------------------
-- One row per sync channel. `cursor` holds the Gmail historyId or the Calendar
-- syncToken. Jobs are idempotent and read this rather than a date range.

create table sync_state (
  id           uuid primary key default gen_random_uuid(),
  channel      text not null unique,
  cursor       text,
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint sync_state_channel_present check (btrim(channel) <> '')
);

create trigger trg_sync_state_updated_at
  before update on sync_state
  for each row execute function fn_touch_updated_at();
