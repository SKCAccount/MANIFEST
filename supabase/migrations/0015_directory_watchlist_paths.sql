-- 0015_directory_watchlist_paths.sql
-- The four read surfaces the operator actually lives in: capability search,
-- the watchlist, warm paths, and trip planning.

-- ---------------------------------------------------------------------------
-- v_directory  (active only, strictly)
-- ---------------------------------------------------------------------------
-- Answers "do you know a good CPG accountant" in one query, by filtering
-- professional_function and specialties independently.
--
-- Uncontacted people are excluded without exception. The entire value of a name
-- in the Directory is that the operator can vouch for the person.

set search_path = manifest, public, extensions;

create view v_directory as
select
  p.id                as person_id,
  p.full_name,
  p.preferred_name,
  p.name_pronunciation,
  p.position,
  p.organization_id,
  o.name              as organization_name,
  o.organization_type,
  o.industry_category,
  p.professional_function,
  p.specialties,
  p.relationship_to_me,
  p.tags,
  p.city,
  p.state,
  p.country,
  p.tier,
  p.email_work,
  p.email_personal,
  p.phone_mobile,
  p.phone_office,
  p.linkedin_url,
  p.do_not_contact,
  p.summary,
  r.last_touch_at,
  r.last_substantive_at,
  r.days_overdue,
  fn_person_stage(p.id, now()) as stage,
  s.display_name      as met_at,
  p.met_on
from people p
left join organizations o on o.id = p.organization_id
left join v_person_recency r on r.person_id = p.id
left join sources s on s.id = p.met_at_source_id
where p.contact_status = 'active'
  and p.archived_at is null;

comment on view v_directory is
  'Capability search over active people only. The contact_status filter is written into the view so no caller can forget it.';

-- ---------------------------------------------------------------------------
-- fn_path_to — who can plausibly introduce
-- ---------------------------------------------------------------------------
-- Ranked, best first. A stated introduction outranks every inferred path,
-- including shared organization and shared event, because a stated
-- introduction is evidence and a shared conference badge is a guess.
--
-- Runs against uncontacted targets, which is its highest-value use: the answer
-- to "I have been meaning to meet this person" is a name, not a cold email.

create or replace function fn_path_to(p_target_person_id uuid)
returns table (
  target_person_id    uuid,
  connector_person_id uuid,
  connector_name      text,
  connector_tier      tier,
  path_rank           integer,
  path_reason         text
)
language sql
stable
as $$
  with target as (
    select * from people where id = p_target_person_id
  ),
  candidates as (
    -- 1. Explicit referral recorded on the target's own record.
    select c.id as cid, 1 as rnk,
           'Referred them to you' as reason
    from target t
    join people c on c.id = t.introduced_by_person_id

    union all

    -- 1. Named as the introducer on any introduction involving the target.
    select c.id, 1,
           'Named as introducer on an introduction record'
    from introductions i
    join people c on c.id = i.introducer_person_id
    where i.party_a_person_id = p_target_person_id
       or i.party_b_person_id = p_target_person_id

    union all

    -- 2. Shared current organization.
    select c.id, 2, 'Also at ' || o.name::text
    from target t
    join people c on c.organization_id = t.organization_id and c.id <> t.id
    join organizations o on o.id = t.organization_id
    where t.organization_id is not null

    union all

    -- 3. Shared former organization — target former / connector former.
    select c.id, 3, 'Both formerly at ' || coalesce(ah_c.organization_name, 'the same employer')
    from target t
    join affiliation_history ah_t on ah_t.person_id = t.id and ah_t.organization_id is not null
    join affiliation_history ah_c on ah_c.organization_id = ah_t.organization_id and ah_c.person_id <> t.id
    join people c on c.id = ah_c.person_id

    union all

    -- 3. Target former / connector current.
    select c.id, 3, 'Now at ' || o.name::text || ', where they used to work'
    from target t
    join affiliation_history ah_t on ah_t.person_id = t.id and ah_t.organization_id is not null
    join people c on c.organization_id = ah_t.organization_id and c.id <> t.id
    join organizations o on o.id = ah_t.organization_id

    union all

    -- 3. Target current / connector former.
    select c.id, 3, 'Used to work at ' || o.name::text
    from target t
    join affiliation_history ah_c on ah_c.organization_id = t.organization_id and ah_c.person_id <> t.id
    join people c on c.id = ah_c.person_id
    join organizations o on o.id = t.organization_id
    where t.organization_id is not null

    union all

    -- 4. Shared Met At source.
    select c.id, 4, 'Both met at ' || s.display_name
    from target t
    join people c on c.met_at_source_id = t.met_at_source_id and c.id <> t.id
    join sources s on s.id = t.met_at_source_id
    where t.met_at_source_id is not null

    union all

    -- 5. Shared specialty plus shared city. The weakest signal, and ranked last
    --    for that reason: it is a reason to ask, not evidence of a connection.
    select c.id, 5,
           'Shares ' || array_to_string(
             array(select unnest(c.specialties) intersect select unnest(t.specialties)), ', ')
           || ' and is in ' || t.city
    from target t
    join people c
      on c.id <> t.id
     and c.specialties && t.specialties
     and lower(c.city) = lower(t.city)
    where t.city is not null
  )
  select
    p_target_person_id,
    c.cid,
    pe.full_name,
    pe.tier,
    min(c.rnk)::integer,
    (array_agg(c.reason order by c.rnk asc))[1]
  from candidates c
  join people pe on pe.id = c.cid
  where pe.contact_status = 'active'      -- only people the operator can actually ask
    and pe.do_not_contact = false
    and pe.archived_at is null
    and pe.id <> p_target_person_id
  group by c.cid, pe.full_name, pe.tier
  order by min(c.rnk) asc, pe.tier asc, pe.full_name asc;
$$;

comment on function fn_path_to(uuid) is
  'Active rolodex members who can plausibly introduce the operator to the target, best path first. An explicit referrer outranks every inferred path.';

-- Bounded materialization for the watchlist join: paths to uncontacted targets,
-- which is the set the Watchlist and Geography screens need. Use fn_path_to
-- directly for a single arbitrary target.
create view v_path_to as
select pt.*
from people t
cross join lateral fn_path_to(t.id) pt
where t.contact_status = 'uncontacted';

-- ---------------------------------------------------------------------------
-- v_watchlist  (uncontacted only)
-- ---------------------------------------------------------------------------
-- Days waiting is displayed but never used to rank or flag. Watchlist entries
-- never expire: their value is contingent on an unscheduled trigger, usually
-- geography, so time elapsed carries no information.

create view v_watchlist as
select
  p.id                        as person_id,
  p.full_name,
  p.position,
  p.organization_id,
  o.name                      as organization_name,
  p.professional_function,
  p.specialties,
  p.city,
  p.state,
  p.country,
  p.linkedin_url,
  p.email_work,
  p.email_personal,
  p.phone_mobile,
  p.phone_office,
  p.watchlist_reason,
  p.watchlist_source,
  p.watchlist_priority,
  p.watchlist_added_on,
  ib.full_name                as introduced_by_name,
  p.introduced_by_person_id,
  p.introduced_by_external,

  -- Outbound attempts are logged against the record and change nothing else.
  coalesce(att.outreach_attempts, 0)::integer as outreach_attempts,
  att.last_attempt_at,
  att.last_attempt_channel,

  coalesce(paths.path_count, 0)::integer      as warm_path_count,
  paths.top_paths,

  -- Displayed, never ranked on.
  (current_date - p.watchlist_added_on)       as days_waiting
from people p
left join organizations o on o.id = p.organization_id
left join people ib on ib.id = p.introduced_by_person_id
left join lateral (
  select
    count(*)::integer     as outreach_attempts,
    max(t.occurred_at)    as last_attempt_at,
    (array_agg(t.channel order by t.occurred_at desc))[1] as last_attempt_channel
  from v_contact_touchpoints t
  where t.person_id = p.id and t.direction = 'outbound'
) att on true
left join lateral (
  select
    count(*)::integer as path_count,
    (array_agg(x.connector_name order by x.path_rank asc, x.connector_tier asc))[1:3] as top_paths
  from fn_path_to(p.id) x
) paths on true
where p.contact_status = 'uncontacted';

comment on view v_watchlist is
  'Uncontacted people only. Group by city by default: geography is the usual trigger for working this list. No staleness signal is exposed, by design.';

-- ---------------------------------------------------------------------------
-- v_geography  (both cohorts, labeled)
-- ---------------------------------------------------------------------------
-- The trip-planning surface. On learning about a trip to LA this answers who to
-- see there, and who could introduce the operator to the people he has been
-- meaning to meet.

create view v_geography as
select
  'active'::text          as cohort,
  p.id                    as person_id,
  p.full_name,
  p.position,
  o.name                  as organization_name,
  p.city,
  p.state,
  p.country,
  p.tier,
  p.professional_function,
  p.specialties,
  p.relationship_to_me,
  r.last_touch_at,
  r.last_substantive_at,
  r.days_overdue,
  (r.days_overdue is not null and r.days_overdue > 0) as is_overdue,
  fn_person_stage(p.id, now()) as stage,
  null::text              as watchlist_reason,
  null::watch_priority    as watchlist_priority,
  0                       as warm_path_count,
  null::text[]            as top_paths,
  0                       as outreach_attempts,
  null::timestamptz       as last_attempt_at
from people p
left join organizations o on o.id = p.organization_id
left join v_person_recency r on r.person_id = p.id
where p.contact_status = 'active'
  and p.archived_at is null

union all

select
  'watchlist'::text,
  w.person_id,
  w.full_name,
  w.position,
  w.organization_name,
  w.city,
  w.state,
  w.country,
  null::tier,
  w.professional_function,
  w.specialties,
  '{}'::text[],
  null::timestamptz,
  null::timestamptz,
  null::integer,
  false,
  null::dev_stage,
  w.watchlist_reason,
  w.watchlist_priority,
  w.warm_path_count,
  w.top_paths,
  w.outreach_attempts,
  w.last_attempt_at
from v_watchlist w;
