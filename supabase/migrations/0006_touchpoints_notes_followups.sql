-- 0006_touchpoints_notes_followups.sql
--
-- Notes and touchpoints are different tables on purpose. Notes are durable
-- facts and are editable ("hates cold outreach", "only free Tuesdays").
-- Touchpoints are episodic events and are append-only ("March 4, call,
-- discussed the Bluepoch receivable"). Recency is derived from touchpoints and
-- is never directly editable.

-- ---------------------------------------------------------------------------
-- touchpoints (append-only)
-- ---------------------------------------------------------------------------

set search_path = manifest, public, extensions;

create table touchpoints (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references people (id) on delete cascade,
  occurred_at   timestamptz not null default now(),
  channel       touch_channel not null,
  direction     touch_direction not null,

  -- Only substantive touchpoints reset a cadence clock. A conference handshake
  -- and a forty-minute call about a live receivable are not the same event.
  substantive   boolean not null default false,

  subject       text,
  summary       text,
  outcome       text,
  source        touch_source not null default 'manual',
  external_id   text,

  -- Deep link back to the thing this row was derived from — a Gmail permalink,
  -- a Calendar event URL. Phase 2 never stores a message body, so this is the
  -- only route from a summary back to the original. Null for anything the
  -- operator typed.
  external_url  text,

  -- Group meetings write one row per person sharing a group_key, which keeps
  -- every query person-centric. The UI collapses shared keys into one entry.
  group_key     uuid,
  source_id     uuid references sources (id) on delete set null,

  -- Corrections insert a superseding row rather than editing history.
  supersedes_id uuid references touchpoints (id) on delete set null,
  created_at    timestamptz not null default now(),

  constraint touchpoints_no_self_supersede check (supersedes_id is null or supersedes_id <> id)
);

-- Sync idempotency. person_id is part of the key because a single calendar
-- event legitimately produces one row per external attendee (section 7.3);
-- without it, the second attendee of a synced meeting would be rejected.
--
-- `supersedes_id is null` narrows this to the *live* row for each key. A
-- correction necessarily shares the external id of the row it corrects — a
-- second message arriving in a thread later the same day re-derives the same
-- key — so without the second predicate, append-only correction and sync
-- idempotency would be mutually exclusive. What the index still guarantees is
-- the thing that matters: a sync re-run cannot insert a second original.
create unique index touchpoints_external_key
  on touchpoints (source, external_id, person_id)
  where external_id is not null and supersedes_id is null;

create index touchpoints_person_occurred_idx on touchpoints (person_id, occurred_at desc);
create index touchpoints_substantive_idx     on touchpoints (person_id, occurred_at desc) where substantive;
create index touchpoints_source_idx          on touchpoints (source_id) where source_id is not null;
create index touchpoints_group_idx           on touchpoints (group_key) where group_key is not null;
create index touchpoints_supersedes_idx      on touchpoints (supersedes_id) where supersedes_id is not null;
create index touchpoints_occurred_idx        on touchpoints (occurred_at desc);

comment on table touchpoints is
  'Append-only. UPDATE and DELETE are revoked at the role level and blocked by trigger. Corrections insert a row with supersedes_id set.';

-- ---------------------------------------------------------------------------
-- v_contact_touchpoints — the base every derived surface reads
-- ---------------------------------------------------------------------------
-- Two classes of row are excluded from "contact":
--
--   1. channel = 'system'. Job-change entries are written automatically so the
--      timeline explains itself, but a job change is not contact. Counting it
--      would silently reset a cadence clock and push a Card to Contact.
--   2. Rows that have been superseded by a correction.
--
-- Everything downstream (recency, stage, ratios, event metrics) reads this
-- view rather than the table, so the rule is stated once.

create view v_contact_touchpoints as
select t.*
from touchpoints t
where t.channel <> 'system'
  and not exists (
    select 1 from touchpoints s where s.supersedes_id = t.id
  );

comment on view v_contact_touchpoints is
  'Touchpoints that count as contact: excludes system ledger entries and superseded rows. All recency, stage and event math reads this, not the base table.';

-- ---------------------------------------------------------------------------
-- notes (editable, durable facts)
-- ---------------------------------------------------------------------------
-- Permitted on uncontacted records: research notes are exactly what a watchlist
-- entry accumulates.

create table notes (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references people (id) on delete cascade,
  category            note_category not null default 'professional',
  body                text not null,
  is_pinned           boolean not null default false,
  source_touchpoint_id uuid references touchpoints (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint notes_body_present check (btrim(body) <> '')
);

create index notes_person_idx on notes (person_id, created_at desc);
create index notes_pinned_idx on notes (person_id) where is_pinned;
create index notes_body_trgm_idx on notes using gin (body gin_trgm_ops);

create trigger trg_notes_updated_at
  before update on notes
  for each row execute function fn_touch_updated_at();

-- ---------------------------------------------------------------------------
-- followups
-- ---------------------------------------------------------------------------
-- Permitted on uncontacted records, which is how a trip list gets worked.

create table followups (
  id                  uuid primary key default gen_random_uuid(),
  person_id           uuid not null references people (id) on delete cascade,
  title               text not null,
  detail              text,
  due_on              date not null,
  status              followup_status not null default 'open',
  completed_at        timestamptz,
  source_touchpoint_id uuid references touchpoints (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint followups_title_present check (btrim(title) <> ''),
  constraint followups_done_has_timestamp check (status <> 'done' or completed_at is not null),
  constraint followups_open_has_no_timestamp check (status <> 'open' or completed_at is null)
);

create index followups_open_due_idx on followups (due_on) where status = 'open';
create index followups_person_idx   on followups (person_id, due_on);

create trigger trg_followups_updated_at
  before update on followups
  for each row execute function fn_touch_updated_at();
