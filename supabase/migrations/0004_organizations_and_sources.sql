-- 0004_organizations_and_sources.sql
-- Two lookups. Neither is a thing the operator maintains; both exist so
-- descriptor values stay consistent and so attributes that genuinely belong to
-- the org or the event are not retyped onto every person record.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
-- Created inline from the person form. Never required to be complete: name is
-- the only thing that must be present.

set search_path = manifest, public, extensions;

create table organizations (
  id                uuid primary key default gen_random_uuid(),
  name              citext not null,
  organization_type text,
  industry_category text,
  sub_industry      text,
  city              text,
  state             text,
  country           text,
  domain            citext,
  website           text,
  linkedin_url      text,
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint organizations_name_present check (btrim(name::text) <> '')
);

-- citext unique index: "Naturally New York" and "naturally new york" collide,
-- which is the point. "Naturally NY" does not, and v_data_quality reports it.
create unique index organizations_name_key on organizations (name);
create unique index organizations_domain_key on organizations (domain) where domain is not null;
create index organizations_name_trgm_idx on organizations using gin (name gin_trgm_ops);
create index organizations_industry_idx on organizations (industry_category) where industry_category is not null;

create trigger trg_organizations_updated_at
  before update on organizations
  for each row execute function fn_touch_updated_at();

create or replace function fn_organizations_validate()
returns trigger
language plpgsql
as $$
begin
  if new.organization_type is not null then
    perform fn_validate_taxonomy('organization_type', array[new.organization_type], 'organizations.organization_type');
  end if;
  if new.industry_category is not null then
    perform fn_validate_taxonomy('industry_category', array[new.industry_category], 'organizations.industry_category');
  end if;
  return new;
end;
$$;

create trigger trg_organizations_validate
  before insert or update on organizations
  for each row execute function fn_organizations_validate();

-- ---------------------------------------------------------------------------
-- sources  (the "Met At" lookup)
-- ---------------------------------------------------------------------------
-- Cost is stored exactly once, here. Editing it moves every derived metric at
-- once because there is only one copy — no backfill job, no denormalized cost
-- on person records.
--
-- event_name and event_year are separate columns so the series is simply the
-- distinct event_name. There is no separate series key to maintain or mistype.

create table sources (
  id                uuid primary key default gen_random_uuid(),
  event_name        text not null,
  event_year        integer,
  display_name      text generated always as (
                      btrim(event_name) ||
                      case when event_year is null then '' else ' ' || event_year::text end
                    ) stored,
  kind              text not null,
  occurred_on       date,
  ends_on           date,
  city              text,
  state             text,
  url               text,
  plunder_ref       text,
  attended          boolean not null default true,

  cost_pass_cents    bigint,
  cost_travel_cents  bigint,
  cost_lodging_cents bigint,
  cost_meals_cents   bigint,
  cost_other_cents   bigint,
  cost_total_cents   bigint generated always as (
                       case
                         when cost_pass_cents is null
                          and cost_travel_cents is null
                          and cost_lodging_cents is null
                          and cost_meals_cents is null
                          and cost_other_cents is null
                         then null
                         else coalesce(cost_pass_cents, 0)
                            + coalesce(cost_travel_cents, 0)
                            + coalesce(cost_lodging_cents, 0)
                            + coalesce(cost_meals_cents, 0)
                            + coalesce(cost_other_cents, 0)
                       end
                     ) stored,
  cost_note         text,
  retro_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint sources_event_name_present check (btrim(event_name) <> ''),
  constraint sources_event_year_sane check (event_year is null or event_year between 1980 and 2100),
  constraint sources_dates_ordered check (ends_on is null or occurred_on is null or ends_on >= occurred_on),
  constraint sources_costs_non_negative check (
    coalesce(cost_pass_cents, 0)    >= 0 and
    coalesce(cost_travel_cents, 0)  >= 0 and
    coalesce(cost_lodging_cents, 0) >= 0 and
    coalesce(cost_meals_cents, 0)   >= 0 and
    coalesce(cost_other_cents, 0)   >= 0
  )
);

create unique index sources_name_year_key
  on sources (lower(event_name), event_year)
  where event_year is not null;

create index sources_kind_idx on sources (kind);
create index sources_occurred_idx on sources (occurred_on desc nulls last);

create trigger trg_sources_updated_at
  before update on sources
  for each row execute function fn_touch_updated_at();

-- The cost requirement is enforced by trigger rather than CHECK because whether
-- a kind belongs to the event family lives in `taxonomies`, and a CHECK
-- constraint cannot read another table. This keeps the event family extensible:
-- the operator can add "summit" as an event kind without a migration and the
-- cost requirement follows automatically.
create or replace function fn_sources_validate()
returns trigger
language plpgsql
as $$
declare
  -- cost_total_cents is a STORED generated column, which Postgres computes
  -- *after* BEFORE triggers run. Reading it here would always see null, so the
  -- components are checked directly.
  has_cost boolean := (
    new.cost_pass_cents    is not null or
    new.cost_travel_cents  is not null or
    new.cost_lodging_cents is not null or
    new.cost_meals_cents   is not null or
    new.cost_other_cents   is not null
  );
begin
  perform fn_validate_taxonomy('source_kind', array[new.kind], 'sources.kind');

  if fn_source_kind_is_event(new.kind) then
    if new.event_year is null then
      raise exception 'manifest: % is an event kind and requires event_year', new.kind
        using errcode = 'check_violation';
    end if;
    if not has_cost then
      raise exception 'manifest: % is an event kind and requires a cost breakdown before save', new.kind
        using errcode = 'check_violation';
    end if;
    -- Horizon-matched comparison (section 4.7) measures every event at the same
    -- age. Without a date there is no age, so the event could never be ranked
    -- fairly against another — and days_since_event, which is displayed beside
    -- every present-day ratio, would be blank.
    if new.occurred_on is null then
      raise exception 'manifest: % is an event kind and requires occurred_on', new.kind
        using errcode = 'check_violation';
    end if;
  elsif has_cost then
    raise exception 'manifest: % is not an event kind and must not carry cost', new.kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_sources_validate
  before insert or update on sources
  for each row execute function fn_sources_validate();
