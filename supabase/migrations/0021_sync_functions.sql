-- 0021_sync_functions.sql
-- The parts of Phase 2 that have to be atomic, and are therefore in the
-- database rather than in TypeScript.
--
-- The division of labour throughout Phase 2: anything that decides *what a
-- message means* — which side of a thread is the operator, whether an address
-- belongs to a machine, how a day's messages roll up — is pure TypeScript and
-- is unit-tested without a database. Anything that decides *what gets written*
-- is here, because PostgREST gives each statement its own transaction and a
-- half-applied sync is worse than no sync.

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- fn_sync_record_touchpoint — insert, correct, or do nothing
-- ---------------------------------------------------------------------------
-- The idempotent write at the centre of sync. Called once per (thread, person,
-- day) for Gmail and once per (event, attendee) for Calendar, with whatever the
-- current best understanding of that group is. It resolves to exactly one of
-- three outcomes:
--
--   inserted    nothing existed for this key — write the first row
--   superseded  something existed and the facts have changed — write a
--               correction pointing at it
--   unchanged   something existed and nothing has changed — write nothing
--
-- The third outcome is the one that matters most. Sync re-reads overlapping
-- windows constantly: Gmail history ids are advisory, cron fires on a schedule
-- that has no relationship to when mail arrives, and the operator can press
-- "Sync now" twice. Without a genuine no-op path, every re-run would append a
-- correction that corrected nothing, and a person's timeline would fill with
-- identical rows.
--
-- Why a correction rather than an update: touchpoints are append-only, and a
-- thread genuinely changes meaning as the day goes on. A message the operator
-- sent at 9am is an outbound attempt. The reply at 4pm makes that same day a
-- two-way exchange — which is not an edit to what happened at 9am, it is a
-- later, better-informed record of the day. Superseding says exactly that, and
-- keeps the 9am reading visible in the log for anyone who wonders why the
-- record was not promoted sooner.

create or replace function fn_sync_record_touchpoint(
  p_source       touch_source,
  p_external_id  text,
  p_person_id    uuid,
  p_channel      touch_channel,
  p_direction    touch_direction,
  p_occurred_at  timestamptz,
  p_subject      text default null,
  p_summary      text default null,
  p_substantive  boolean default false,
  p_external_url text default null,
  p_source_id    uuid default null,
  p_group_key    uuid default null
)
returns table (touchpoint_id uuid, action text)
language plpgsql
security invoker
as $$
declare
  v_live touchpoints;
  v_new  uuid;
begin
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception 'manifest: sync touchpoints require an external id — that is what makes them idempotent'
      using errcode = 'null_value_not_allowed';
  end if;

  -- The tip of the correction chain for this key: the row nothing supersedes.
  -- touchpoints_external_key guarantees at most one chain per key, so at most
  -- one row can match.
  select t.* into v_live
  from touchpoints t
  where t.source = p_source
    and t.external_id = p_external_id
    and t.person_id = p_person_id
    and not exists (select 1 from touchpoints s where s.supersedes_id = t.id)
  limit 1;

  if found
     and v_live.direction    is not distinct from p_direction
     and v_live.occurred_at  is not distinct from p_occurred_at
     and v_live.substantive  is not distinct from coalesce(p_substantive, false)
     and v_live.subject      is not distinct from p_subject
     and v_live.summary      is not distinct from p_summary
     and v_live.external_url is not distinct from p_external_url
  then
    touchpoint_id := v_live.id;
    action := 'unchanged';
    return next;
    return;
  end if;

  insert into touchpoints (
    person_id, occurred_at, channel, direction, substantive,
    subject, summary, source, external_id, external_url,
    source_id, group_key, supersedes_id
  )
  values (
    p_person_id, p_occurred_at, p_channel, p_direction, coalesce(p_substantive, false),
    p_subject, p_summary, p_source, p_external_id, p_external_url,
    p_source_id, p_group_key,
    case when v_live.id is null then null else v_live.id end
  )
  returning id into v_new;

  touchpoint_id := v_new;
  action := case when v_live.id is null then 'inserted' else 'superseded' end;
  return next;
end;
$$;

comment on function fn_sync_record_touchpoint(touch_source, text, uuid, touch_channel, touch_direction, timestamptz, text, text, boolean, text, uuid, uuid) is
  'Idempotent sync write. Inserts on first sight, supersedes when the facts change, and writes nothing when they have not. Returns which of the three happened.';

-- ---------------------------------------------------------------------------
-- fn_sync_stage_person — park what sync could not resolve
-- ---------------------------------------------------------------------------
-- Sync never creates a person. An address it does not recognise becomes one
-- pending staging record, keyed on the address itself rather than on the
-- message — so a vendor who emails weekly accumulates evidence in a single row
-- the operator dismisses once, instead of generating a new item every week.
--
-- The guard that matters is the WHERE on the update: a record the operator has
-- already rejected is left alone. Without it, dismissing an address would last
-- exactly until its owner sent another email, and the review screen would be
-- unworkable within a month.

create or replace function fn_sync_stage_person(
  p_kind        staging_kind,
  p_source      touch_source,
  p_external_id text,
  p_payload     jsonb default '{}'::jsonb,
  p_note        text default null
)
returns table (staging_id uuid, staged boolean)
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  insert into staging_records (kind, status, payload, source, external_id, note)
  values (
    p_kind,
    'pending',
    p_payload || jsonb_build_object('occurrences', 1),
    p_source,
    lower(btrim(p_external_id)),
    p_note
  )
  on conflict (kind, source, external_id) where external_id is not null
  do update set
    payload = staging_records.payload
              || excluded.payload
              || jsonb_build_object(
                   -- Evidence accrues; the first sighting is not overwritten by
                   -- the latest one.
                   'occurrences', coalesce((staging_records.payload->>'occurrences')::int, 1) + 1,
                   'first_seen', coalesce(
                     staging_records.payload->>'first_seen',
                     excluded.payload->>'first_seen'
                   )
                 ),
    updated_at = now()
  where staging_records.status = 'pending'
  returning id into v_id;

  if v_id is not null then
    staging_id := v_id;
    staged := true;
    return next;
    return;
  end if;

  -- Conflict hit an already-resolved record. Report it so the caller can count
  -- it as skipped rather than new, and so a re-run stays silent.
  select r.id into staging_id
  from staging_records r
  where r.kind = p_kind
    and r.source = p_source
    and r.external_id = lower(btrim(p_external_id));

  staged := false;
  return next;
end;
$$;

comment on function fn_sync_stage_person(staging_kind, touch_source, text, jsonb, text) is
  'Parks an unresolved address or event as one pending staging record, keyed on the identifier so evidence accumulates in place. Never resurrects a record the operator has already rejected.';

-- ---------------------------------------------------------------------------
-- fn_sync_attach_suggestion — "that is Amanda"
-- ---------------------------------------------------------------------------
-- The common resolution on the review screen. Writes the address onto the
-- person and closes the suggestion in one transaction, because the halfway
-- state — a suggestion marked accepted against a person who does not carry the
-- address — would come straight back as a new suggestion on the next run.
--
-- Which field the address lands in is decided here rather than by the caller:
-- the first free one wins, work before personal. If both are taken the call
-- fails rather than overwriting, because an address already on the record is
-- either the same one (the suggestion was stale) or a real conflict worth
-- looking at.

create or replace function fn_sync_attach_suggestion(
  p_staging_id uuid,
  p_person_id  uuid
)
returns table (person_id uuid, field text)
language plpgsql
security invoker
as $$
declare
  v_staging staging_records;
  v_person  people;
  v_address citext;
begin
  select * into v_staging from staging_records where id = p_staging_id;
  if not found then
    raise exception 'manifest: no staging record %', p_staging_id using errcode = 'no_data_found';
  end if;
  if v_staging.status <> 'pending' then
    raise exception 'manifest: staging record % is already %', p_staging_id, v_staging.status
      using errcode = 'restrict_violation';
  end if;

  select * into v_person from people where id = p_person_id;
  if not found then
    raise exception 'manifest: no person %', p_person_id using errcode = 'foreign_key_violation';
  end if;

  v_address := lower(btrim(coalesce(v_staging.payload->>'address', v_staging.external_id)))::citext;
  if v_address is null or v_address = '' then
    raise exception 'manifest: staging record % carries no address to attach', p_staging_id
      using errcode = 'null_value_not_allowed';
  end if;

  if v_person.email_work = v_address or v_person.email_personal = v_address then
    field := 'already_present';
  elsif v_person.email_work is null then
    update people set email_work = v_address where id = p_person_id;
    field := 'email_work';
  elsif v_person.email_personal is null then
    update people set email_personal = v_address where id = p_person_id;
    field := 'email_personal';
  else
    raise exception
      'manifest: % already has both email fields filled (% and %). Clear one first, or reject this suggestion.',
      v_person.full_name, v_person.email_work, v_person.email_personal
      using errcode = 'unique_violation';
  end if;

  update staging_records
     set status = 'accepted',
         matched_person_id = p_person_id,
         resolved_at = now()
   where id = p_staging_id;

  person_id := p_person_id;
  return next;
end;
$$;

comment on function fn_sync_attach_suggestion(uuid, uuid) is
  'Attaches a staged address to an existing person and closes the suggestion atomically. Refuses to overwrite an address already on the record.';

-- ---------------------------------------------------------------------------
-- fn_sync_reject_suggestion
-- ---------------------------------------------------------------------------
-- Permanent by design. fn_sync_stage_person will not reopen it, which is what
-- makes dismissing the newsletter address a one-time cost rather than a weekly
-- one.

create or replace function fn_sync_reject_suggestion(
  p_staging_id uuid,
  p_note       text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_id uuid;
begin
  update staging_records
     set status = 'rejected',
         resolved_at = now(),
         note = coalesce(p_note, note)
   where id = p_staging_id
     and status = 'pending'
  returning id into v_id;

  if v_id is null then
    raise exception 'manifest: staging record % is missing or already resolved', p_staging_id
      using errcode = 'restrict_violation';
  end if;

  return v_id;
end;
$$;

comment on function fn_sync_reject_suggestion(uuid, text) is
  'Rejects a suggestion permanently. Sync will not raise the same address again.';

-- 0017's grant loop ran before these existed.
grant execute on function fn_sync_record_touchpoint(touch_source, text, uuid, touch_channel, touch_direction, timestamptz, text, text, boolean, text, uuid, uuid) to authenticated, service_role;
grant execute on function fn_sync_stage_person(staging_kind, touch_source, text, jsonb, text) to authenticated, service_role;
grant execute on function fn_sync_attach_suggestion(uuid, uuid) to authenticated, service_role;
grant execute on function fn_sync_reject_suggestion(uuid, text) to authenticated, service_role;
