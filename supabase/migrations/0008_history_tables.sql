-- 0008_history_tables.sql
-- Both tables are written exclusively by trigger. Neither is ever manually
-- entered, and neither is snapshotted state: they are the append-only record
-- that makes point-in-time reconstruction possible.

-- ---------------------------------------------------------------------------
-- tier_history
-- ---------------------------------------------------------------------------
-- Makes point-in-time event economics honest. Ranking an event on the tier its
-- contacts hold today would credit the event for two years of subsequent
-- relationship-building; fn_source_metrics resolves tier as of the horizon
-- date from this table instead.

set search_path = manifest, public, extensions;

create table tier_history (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references people (id) on delete cascade,
  from_tier  tier,                       -- null on initial assignment
  to_tier    tier not null,
  changed_at timestamptz not null default now(),
  reason     text,
  created_at timestamptz not null default now(),

  constraint tier_history_actually_changed check (from_tier is null or from_tier <> to_tier)
);

create index tier_history_person_idx on tier_history (person_id, changed_at desc);

-- ---------------------------------------------------------------------------
-- affiliation_history
-- ---------------------------------------------------------------------------
-- organization_name is stored alongside organization_id deliberately: if an org
-- record is later merged or renamed, the history of where someone actually
-- worked should not silently change underneath it.

create table affiliation_history (
  id                uuid primary key default gen_random_uuid(),
  person_id         uuid not null references people (id) on delete cascade,
  organization_id   uuid references organizations (id) on delete set null,
  organization_name text,
  position          text,
  started_on        date,
  ended_on          date,
  note              text,
  created_at        timestamptz not null default now(),

  constraint affiliation_history_dates_ordered check (
    ended_on is null or started_on is null or ended_on >= started_on
  )
);

create index affiliation_history_person_idx on affiliation_history (person_id, created_at desc);
create index affiliation_history_org_idx    on affiliation_history (organization_id) where organization_id is not null;

-- Powers the "changed jobs" list, which is the best available pretext for a
-- warm touch, and the +1.0 recent-job-change term in the queue score.
create index affiliation_history_recent_idx on affiliation_history (created_at desc);
