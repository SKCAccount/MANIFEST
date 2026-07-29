-- 0005_people.sql
-- The spine. Every entry is one individual.
--
-- The hard constraint of the whole system lives in this file: a person is
-- either `active` (there is a real relationship, established by a qualifying
-- two-way touchpoint) or `uncontacted` (a deliberately curated watchlist entry,
-- quarantined from everything that assumes a relationship exists).

create table people (
  id                  uuid primary key default gen_random_uuid(),

  -- Identity ---------------------------------------------------------------
  first_name          text not null,
  last_name           text,
  preferred_name      text,
  name_pronunciation  text,
  full_name           text generated always as (
                        btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
                      ) stored,
  name_key            text generated always as (
                        fn_normalize_name(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
                      ) stored,

  -- Descriptors ------------------------------------------------------------
  position            text,
  organization_id     uuid references organizations (id) on delete set null,

  -- Three orthogonal classification fields. What someone does for a living,
  -- what they actually know, and what they are to the operator are different
  -- questions; collapsing any two of them destroys both queries.
  professional_function text[] not null default '{}',   -- accountant, attorney, lender...
  specialties           text[] not null default '{}',   -- CPG, structured finance, M&A...
  relationship_to_me    text[] not null default '{}',   -- deal source, client, community...

  -- Geography --------------------------------------------------------------
  city                text,
  state               text,
  country             text,
  region              region_code,

  -- Contact status ---------------------------------------------------------
  contact_status      contact_status not null default 'active',
  first_contact_at    timestamptz,

  -- Watchlist (uncontacted only) -------------------------------------------
  watchlist_reason    text,
  watchlist_source    text,
  watchlist_priority  watch_priority,
  watchlist_added_on  date,

  -- Provenance -------------------------------------------------------------
  met_at_source_id    uuid references sources (id) on delete set null,
  met_on              date,
  introduced_by_person_id uuid references people (id) on delete set null,
  introduced_by_external  text,

  -- Cadence ----------------------------------------------------------------
  tier                tier not null default 'C',
  cadence_days_override integer,
  cadence_paused_until timestamptz,

  -- Reachability -----------------------------------------------------------
  email_work          citext,
  email_personal      citext,
  phone_mobile        text,
  phone_office        text,
  linkedin_url        text,
  linkedin_key        text generated always as (fn_normalize_linkedin(linkedin_url)) stored,
  other_url           text,
  do_not_contact      boolean not null default false,

  summary             text,
  tags                text[] not null default '{}',
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- -------------------------------------------------------------------------
  -- Section 4.9 — the watchlist contract, enforced in code as required
  -- -------------------------------------------------------------------------

  -- Why this person is worth meeting, in the operator's own words. This
  -- requirement exists to make bulk entry tedious. Do not relax or default it.
  constraint people_uncontacted_requires_reason check (
    contact_status <> 'uncontacted'
    or (watchlist_reason is not null and btrim(watchlist_reason) <> '')
  ),

  -- You did not meet them anywhere.
  constraint people_uncontacted_has_no_met_at check (
    contact_status <> 'uncontacted'
    or (met_at_source_id is null and met_on is null)
  ),

  -- A name with no handle is a note, not a record.
  constraint people_uncontacted_requires_identifier check (
    contact_status <> 'uncontacted'
    or (
      linkedin_url    is not null or
      email_work      is not null or
      email_personal  is not null or
      phone_mobile    is not null or
      phone_office    is not null or
      organization_id is not null
    )
  ),

  -- An active record means contact actually happened, and we know when.
  -- The server action additionally rejects creating an active person unless a
  -- qualifying touchpoint is written in the same transaction (section 4.9).
  constraint people_active_requires_first_contact check (
    contact_status <> 'active' or first_contact_at is not null
  ),

  -- Watchlist fields are deliberately *not* cleared on promotion. "I wanted to
  -- meet this person because X, and now I have" is signal worth keeping; the UI
  -- simply stops showing them once contact_status is active.

  constraint people_no_self_introduction check (
    introduced_by_person_id is null or introduced_by_person_id <> id
  ),
  constraint people_cadence_override_positive check (
    cadence_days_override is null or cadence_days_override > 0
  ),
  constraint people_first_name_present check (btrim(first_name) <> ''),
  constraint people_met_on_needs_source check (met_on is null or met_at_source_id is not null)
);

-- ---------------------------------------------------------------------------
-- Deterministic dedupe keys (section 7.5, in matcher order)
-- ---------------------------------------------------------------------------

create unique index people_email_work_key     on people (email_work)     where email_work    is not null;
create unique index people_email_personal_key on people (email_personal) where email_personal is not null;
create unique index people_linkedin_key       on people (linkedin_key)   where linkedin_key  is not null;
create unique index people_phone_mobile_key   on people (phone_mobile)   where phone_mobile  is not null;

-- ---------------------------------------------------------------------------
-- Query indexes
-- ---------------------------------------------------------------------------

create index people_professional_function_idx on people using gin (professional_function);
create index people_specialties_idx           on people using gin (specialties);
create index people_relationship_to_me_idx    on people using gin (relationship_to_me);
create index people_tags_idx                  on people using gin (tags);
create index people_full_name_trgm_idx        on people using gin (full_name gin_trgm_ops);

create index people_contact_status_idx on people (contact_status);
create index people_organization_idx   on people (organization_id) where organization_id is not null;
create index people_met_at_idx         on people (met_at_source_id) where met_at_source_id is not null;
create index people_introduced_by_idx  on people (introduced_by_person_id) where introduced_by_person_id is not null;
create index people_city_idx           on people (lower(city)) where city is not null;
create index people_tier_idx           on people (tier);
create index people_name_key_idx       on people (name_key) where name_key is not null;

create trigger trg_people_updated_at
  before update on people
  for each row execute function fn_touch_updated_at();

comment on column people.specialties is
  'What the person actually knows, at person grain. Deliberately not on the organization: Carlton Fields is a general-practice firm and exactly one attorney there does structured finance.';
comment on column people.relationship_to_me is
  'What they are to the operator. "retained service provider" means the operator writes this person checks — it is not a synonym for "is an accountant".';
comment on column people.watchlist_reason is
  'Required for uncontacted records. The tedium is the feature: it is what prevents the watchlist from becoming a lead list.';
