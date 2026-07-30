-- 0003_taxonomies.sql
-- Backs every list the operator is expected to extend, so a new specialty or a
-- new kind of source never requires a migration.
--
-- The set of *domains* is closed (adding one is a code change, because code has
-- to read it), but the set of values inside a domain is open.

set search_path = manifest, public, extensions;

create table taxonomies (
  id          uuid primary key default gen_random_uuid(),
  domain      text not null,
  value       text not null,
  label       text not null,
  meta        jsonb not null default '{}'::jsonb,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint taxonomies_domain_known check (
    domain in (
      'professional_function',
      'specialty',
      'relationship_to_me',
      'organization_type',
      'industry_category',
      'source_kind',
      'watchlist_source'
    )
  ),
  constraint taxonomies_value_present check (btrim(value) <> ''),
  constraint taxonomies_label_present check (btrim(label) <> '')
);

create unique index taxonomies_domain_value_key on taxonomies (domain, lower(value));
create index taxonomies_domain_active_idx on taxonomies (domain, sort_order) where is_active;

create trigger trg_taxonomies_updated_at
  before update on taxonomies
  for each row execute function fn_touch_updated_at();

comment on column taxonomies.meta is
  'Domain-specific attributes. For source_kind, meta->>''family'' = ''event'' marks the kinds that require a cost breakdown and an event year.';

-- ---------------------------------------------------------------------------
-- Validation used by the write triggers on people / organizations / sources
-- ---------------------------------------------------------------------------

create or replace function fn_taxonomy_has(p_domain text, p_value text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from taxonomies
    where domain = p_domain
      and lower(value) = lower(btrim(p_value))
      and is_active
  );
$$;

-- Raises on the first unknown value, naming it, so the operator sees which word
-- was rejected rather than "constraint violated".
create or replace function fn_validate_taxonomy(p_domain text, p_values text[], p_column text)
returns void
language plpgsql
stable
as $$
declare
  v text;
begin
  if p_values is null then
    return;
  end if;

  foreach v in array p_values loop
    if v is null or btrim(v) = '' then
      raise exception 'manifest: % contains an empty value', p_column
        using errcode = 'check_violation';
    end if;

    if not fn_taxonomy_has(p_domain, v) then
      raise exception 'manifest: "%" is not a known % (column %). Add it to taxonomies first.',
        v, p_domain, p_column
        using errcode = 'check_violation';
    end if;
  end loop;
end;
$$;

create or replace function fn_source_kind_is_event(p_kind text)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select meta->>'family' = 'event'
       from taxonomies
      where domain = 'source_kind'
        and lower(value) = lower(btrim(p_kind))
      limit 1),
    false
  );
$$;
