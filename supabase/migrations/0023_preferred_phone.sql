-- 0023_preferred_phone.sql
-- Which number to reach someone on, when they have more than one.
--
-- Nullable on purpose: with one number there is nothing to prefer, and a
-- preference simply stops mattering (rather than being cleared) if the
-- preferred number is later removed — the display guards on the number
-- existing, so a stale preference can never point at nothing.
--
-- First forward-only migration since the 2026-08-03 deploy. Applied to the
-- hosted project over a direct connection or the SQL editor, then recorded in
-- manifest.schema_migrations by hand — never `supabase db push` (README).

set search_path = manifest, public, extensions;

alter table people
  add column preferred_phone text
  constraint people_preferred_phone_valid
  check (preferred_phone is null or preferred_phone in ('mobile', 'office'));

comment on column people.preferred_phone is
  'Which number to dial first: mobile or office. Null when there is no preference or only one number.';

-- fn_create_active_person inserts through an explicit column list, so the new
-- column must join that list or a preference set at creation would be silently
-- dropped. Body identical to 0019 apart from preferred_phone.
create or replace function fn_create_active_person(p_person jsonb, p_touchpoint jsonb)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_channel    touch_channel := (p_touchpoint->>'channel')::touch_channel;
  v_direction  touch_direction := (p_touchpoint->>'direction')::touch_direction;
  v_occurred   timestamptz := coalesce((p_touchpoint->>'occurred_at')::timestamptz, now());
  v_person_id  uuid;
begin
  if not (v_direction in ('inbound', 'mutual') or v_channel = 'meeting') then
    raise exception
      'manifest: an active record requires a qualifying touchpoint — inbound, mutual, or a meeting. Add them to the watchlist and log the attempt instead.'
      using errcode = 'check_violation';
  end if;

  insert into people (
    first_name, last_name, preferred_name, name_pronunciation, position, organization_id,
    professional_function, specialties, relationship_to_me,
    city, state, country,
    contact_status, first_contact_at,
    met_at_source_id, met_on, introduced_by_person_id, introduced_by_external,
    tier, cadence_days_override,
    email_work, email_personal, phone_mobile, phone_office, preferred_phone, linkedin_url, other_url,
    do_not_contact, summary, tags
  )
  select
    r.first_name, r.last_name, r.preferred_name, r.name_pronunciation, r.position, r.organization_id,
    coalesce(r.professional_function, '{}'), coalesce(r.specialties, '{}'), coalesce(r.relationship_to_me, '{}'),
    r.city, r.state, r.country,
    'active', v_occurred,
    r.met_at_source_id, r.met_on, r.introduced_by_person_id, r.introduced_by_external,
    coalesce(r.tier, 'C'), r.cadence_days_override,
    r.email_work, r.email_personal, r.phone_mobile, r.phone_office, r.preferred_phone, r.linkedin_url, r.other_url,
    coalesce(r.do_not_contact, false), r.summary, coalesce(r.tags, '{}')
  from jsonb_populate_record(null::people, p_person) r
  returning id into v_person_id;

  insert into touchpoints (
    person_id, occurred_at, channel, direction, substantive, subject, summary, source, source_id
  )
  values (
    v_person_id,
    v_occurred,
    v_channel,
    v_direction,
    coalesce((p_touchpoint->>'substantive')::boolean, false),
    p_touchpoint->>'subject',
    p_touchpoint->>'summary',
    coalesce((p_touchpoint->>'source')::touch_source, 'manual'),
    (p_touchpoint->>'source_id')::uuid
  );

  return v_person_id;
end;
$$;

comment on function fn_create_active_person(jsonb, jsonb) is
  'Creates an active person and its establishing touchpoint atomically. Rejects any touchpoint that would not promote a watchlist entry.';
