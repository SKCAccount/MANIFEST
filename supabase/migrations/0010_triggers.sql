-- 0010_triggers.sql
-- The behavioural core of the schema. Everything here enforces an invariant
-- from section 2 or automates a record the operator must never have to keep by
-- hand.

-- ---------------------------------------------------------------------------
-- Touchpoints are append-only
-- ---------------------------------------------------------------------------
-- Privileges are revoked from the client roles in 0018, but privileges alone
-- would leave the invariant dependent on which role happens to be connected.
-- This trigger closes it for every role.
--
-- The single escape hatch exists for merge and merge-reversal, which have to
-- reassign a loser's touchpoints to the winner. It runs server-side only, and
-- the setting is transaction-local (set_config(..., true)).

create or replace function fn_touchpoints_append_only()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('manifest.allow_touchpoint_rewrite', true), 'off') = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception
    'manifest: touchpoints are append-only (attempted % on touchpoint %). Insert a superseding row instead.',
    tg_op, old.id
    using errcode = 'restrict_violation';
end;
$$;

create trigger trg_touchpoints_append_only
  before update or delete on touchpoints
  for each row execute function fn_touchpoints_append_only();

-- ---------------------------------------------------------------------------
-- Phone normalization
-- ---------------------------------------------------------------------------

create or replace function fn_people_normalize_phone()
returns trigger
language plpgsql
as $$
begin
  new.phone_mobile := fn_normalize_phone(new.phone_mobile);
  new.phone_office := fn_normalize_phone(new.phone_office);
  return new;
end;
$$;

create trigger trg_phone_normalize
  before insert or update on people
  for each row execute function fn_people_normalize_phone();

-- ---------------------------------------------------------------------------
-- Taxonomy validation + status transition guard
-- ---------------------------------------------------------------------------

create or replace function fn_people_validate()
returns trigger
language plpgsql
as $$
begin
  perform fn_validate_taxonomy('professional_function', new.professional_function, 'people.professional_function');
  perform fn_validate_taxonomy('specialty',             new.specialties,           'people.specialties');
  perform fn_validate_taxonomy('relationship_to_me',    new.relationship_to_me,    'people.relationship_to_me');

  if new.watchlist_source is not null then
    perform fn_validate_taxonomy('watchlist_source', array[new.watchlist_source], 'people.watchlist_source');
  end if;

  -- You cannot un-meet someone. Demoting an active record back to the
  -- watchlist would silently erase an established relationship and let the
  -- record slip out of the queue.
  if tg_op = 'UPDATE'
     and old.contact_status = 'active'
     and new.contact_status = 'uncontacted' then
    raise exception 'manifest: an active person cannot be returned to the watchlist (person %)', new.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger trg_people_validate
  before insert or update on people
  for each row execute function fn_people_validate();

-- ---------------------------------------------------------------------------
-- trg_first_contact — promotion requires two-way contact
-- ---------------------------------------------------------------------------
-- A touchpoint alone does not promote a record. contact_status flips to active
-- only on a touchpoint that proves the other party participated: direction
-- inbound or mutual, or channel = meeting (a meeting is two-way by definition).
--
-- An outbound LinkedIn message to someone in Colorado Springs that goes
-- unanswered stays exactly what it was: a watchlist entry with an attempt
-- logged against it.
--
-- This also makes Gmail sync correct with no special handling. An outbound
-- email promotes nothing. Their reply promotes them.

create or replace function fn_touchpoint_first_contact()
returns trigger
language plpgsql
as $$
declare
  qualifies boolean;
  p         record;
begin
  qualifies := new.direction in ('inbound', 'mutual') or new.channel = 'meeting';

  if not qualifies then
    return null;
  end if;

  select contact_status, first_contact_at into p from people where id = new.person_id;

  if p.contact_status = 'uncontacted' then
    update people
       set contact_status   = 'active',
           first_contact_at = new.occurred_at
     where id = new.person_id;

  elsif p.first_contact_at is null or new.occurred_at < p.first_contact_at then
    -- Backfill can surface an earlier qualifying contact than the one that
    -- originally promoted the record. First contact is the earliest, not the
    -- first one we happened to learn about.
    update people
       set first_contact_at = new.occurred_at
     where id = new.person_id;
  end if;

  return null;
end;
$$;

create trigger trg_first_contact
  after insert on touchpoints
  for each row execute function fn_touchpoint_first_contact();

-- ---------------------------------------------------------------------------
-- trg_introduced_by — referral attribution writes the introduction for you
-- ---------------------------------------------------------------------------
-- Setting introduced_by_person_id on Amanda's record and selecting Erica
-- records that Erica made the introduction. The operator never enters an
-- introduction twice, and the row stays in sync with the field rather than
-- being edited independently.

create or replace function fn_people_sync_introduced_by()
returns trigger
language plpgsql
as $$
begin
  if new.introduced_by_person_id is null then
    delete from introductions where auto_from_person_id = new.id;
    return null;
  end if;

  insert into introductions (
    perspective, introducer_person_id, party_a_person_id,
    occurred_on, auto_from_person_id, note
  )
  values (
    'received_by_me',
    new.introduced_by_person_id,
    new.id,
    coalesce(new.met_on, new.first_contact_at::date, new.watchlist_added_on, current_date),
    new.id,
    'Auto-generated from the referred-by field on the person record.'
  )
  on conflict (auto_from_person_id) where auto_from_person_id is not null
  do update set
    introducer_person_id = excluded.introducer_person_id,
    occurred_on          = excluded.occurred_on,
    updated_at           = now();

  return null;
end;
$$;

create trigger trg_introduced_by_insert
  after insert on people
  for each row
  when (new.introduced_by_person_id is not null)
  execute function fn_people_sync_introduced_by();

create trigger trg_introduced_by_update
  after update of introduced_by_person_id on people
  for each row
  when (old.introduced_by_person_id is distinct from new.introduced_by_person_id)
  execute function fn_people_sync_introduced_by();

-- ---------------------------------------------------------------------------
-- trg_tier_history
-- ---------------------------------------------------------------------------

create or replace function fn_people_log_tier()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into tier_history (person_id, from_tier, to_tier, changed_at, reason)
    values (new.id, null, new.tier, coalesce(new.created_at, now()), 'initial assignment');
  else
    insert into tier_history (person_id, from_tier, to_tier, changed_at, reason)
    values (new.id, old.tier, new.tier, now(), null);
  end if;
  return null;
end;
$$;

create trigger trg_tier_history_insert
  after insert on people
  for each row execute function fn_people_log_tier();

create trigger trg_tier_history_update
  after update of tier on people
  for each row
  when (old.tier is distinct from new.tier)
  execute function fn_people_log_tier();

-- ---------------------------------------------------------------------------
-- trg_affiliation_history — job changes
-- ---------------------------------------------------------------------------
-- Writes the prior affiliation and logs a system touchpoint so the timeline
-- explains itself. The system touchpoint is channel = 'system' and therefore
-- excluded from v_contact_touchpoints: a job change is a fact about a person,
-- not contact with them, and must not reset a cadence clock, advance a
-- development stage, or promote a watchlist entry.

create or replace function fn_people_log_affiliation()
returns trigger
language plpgsql
as $$
declare
  old_org_name text;
  new_org_name text;
  descr        text;
begin
  select name::text into old_org_name from organizations where id = old.organization_id;
  select name::text into new_org_name from organizations where id = new.organization_id;

  insert into affiliation_history (
    person_id, organization_id, organization_name, position, ended_on, note
  )
  values (
    new.id, old.organization_id, old_org_name, old.position, current_date,
    'Closed automatically on job change.'
  );

  descr := coalesce(old.position, 'unknown role')
        || coalesce(' at ' || old_org_name, '')
        || ' → '
        || coalesce(new.position, 'unknown role')
        || coalesce(' at ' || new_org_name, '');

  insert into touchpoints (person_id, occurred_at, channel, direction, substantive, subject, summary, source)
  values (
    new.id, now(), 'system', 'outbound', false,
    'Job change detected',
    descr,
    'system'
  );

  return null;
end;
$$;

create trigger trg_affiliation_history
  after update of organization_id, position on people
  for each row
  when (
    old.organization_id is distinct from new.organization_id
    or old.position is distinct from new.position
  )
  execute function fn_people_log_affiliation();
