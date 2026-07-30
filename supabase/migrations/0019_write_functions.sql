-- 0019_write_functions.sql
-- Atomic writes for the two operations that span more than one table.
--
-- PostgREST gives each statement its own transaction, so a server action that
-- inserted a person and then a touchpoint could leave an active record with no
-- qualifying touchpoint behind if the second call failed. These functions make
-- the application rule in §4.9 a database guarantee instead of a convention.

-- ---------------------------------------------------------------------------
-- fn_create_active_person
-- ---------------------------------------------------------------------------
-- An active record is rejected unless a qualifying touchpoint is written in the
-- same transaction. The check here is the same one trg_first_contact applies to
-- promotion, stated once more at the point of creation: without it, "active"
-- could come to mean "I found their name", which is the failure mode the whole
-- contact_status split exists to prevent.

set search_path = manifest, public, extensions;

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
    city, state, country, region,
    contact_status, first_contact_at,
    met_at_source_id, met_on, introduced_by_person_id, introduced_by_external,
    tier, cadence_days_override,
    email_work, email_personal, phone_mobile, phone_office, linkedin_url, other_url,
    do_not_contact, summary, tags
  )
  select
    r.first_name, r.last_name, r.preferred_name, r.name_pronunciation, r.position, r.organization_id,
    coalesce(r.professional_function, '{}'), coalesce(r.specialties, '{}'), coalesce(r.relationship_to_me, '{}'),
    r.city, r.state, r.country, r.region,
    'active', v_occurred,
    r.met_at_source_id, r.met_on, r.introduced_by_person_id, r.introduced_by_external,
    coalesce(r.tier, 'C'), r.cadence_days_override,
    r.email_work, r.email_personal, r.phone_mobile, r.phone_office, r.linkedin_url, r.other_url,
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

-- ---------------------------------------------------------------------------
-- fn_log_bulk_event
-- ---------------------------------------------------------------------------
-- Pick a source, check off everyone spoken to. One touchpoint per person
-- sharing a group_key, so every query stays person-centric and the UI can
-- collapse the group into one entry.
--
-- Channel is 'meeting': a conversation at an event is two-way by definition,
-- which is what promotes any watchlist entries in the list. That promotion is
-- the whole reason the watchlist is worth working at a conference.

create or replace function fn_log_bulk_event(
  p_source_id   uuid,
  p_person_ids  uuid[],
  p_occurred_at timestamptz default now(),
  p_substantive boolean default false,
  p_summary     text default null,
  p_set_met_at  boolean default true
)
returns table (person_id uuid, promoted boolean, met_at_set boolean)
language plpgsql
security invoker
as $$
declare
  v_group_key uuid := gen_random_uuid();
  v_source    sources;
  v_person    people;
  v_id        uuid;
begin
  select * into v_source from sources where id = p_source_id;
  if not found then
    raise exception 'manifest: unknown source %', p_source_id using errcode = 'foreign_key_violation';
  end if;

  foreach v_id in array p_person_ids loop
    select * into v_person from people where id = v_id;
    if not found then
      continue;
    end if;

    insert into touchpoints (
      person_id, occurred_at, channel, direction, substantive, subject, summary,
      source, source_id, group_key
    )
    values (
      v_id, p_occurred_at, 'meeting', 'mutual', p_substantive,
      v_source.display_name, p_summary, 'bulk_event', p_source_id, v_group_key
    );

    -- Only for people who have no Met At yet, and never for someone who was
    -- already in the rolodex before this event — overwriting their origin would
    -- silently re-attribute a relationship to the wrong room.
    if p_set_met_at
       and v_person.met_at_source_id is null
       and v_person.first_contact_at is null then
      update people
         set met_at_source_id = p_source_id,
             met_on = coalesce(v_source.occurred_on, fn_local_date(p_occurred_at))
       where id = v_id;
      met_at_set := true;
    else
      met_at_set := false;
    end if;

    person_id := v_id;
    promoted := v_person.contact_status = 'uncontacted';
    return next;
  end loop;
end;
$$;

comment on function fn_log_bulk_event(uuid, uuid[], timestamptz, boolean, text, boolean) is
  'Writes one meeting touchpoint per attendee with a shared group_key. Promotes watchlist entries, because a conversation at an event is two-way contact.';

grant execute on function fn_create_active_person(jsonb, jsonb) to authenticated, service_role;
grant execute on function fn_log_bulk_event(uuid, uuid[], timestamptz, boolean, text, boolean) to authenticated, service_role;
