-- 0011_recency_and_stage.sql
-- Nothing here is stored. Recency and development stage are reconstructed from
-- the append-only logs on every read, which is what makes them impossible to
-- get stale and what makes "as of a past date" a real question with a real
-- answer.

-- Dates are the operator's dates. Rendering is America/New_York, so a
-- touchpoint at 9pm on the 4th is on the 4th, not the 5th.
create or replace function fn_local_date(ts timestamptz)
returns date
language sql
immutable
as $$
  select (ts at time zone 'America/New_York')::date;
$$;

-- Default cadence by tier. D is archived and is never queued.
create or replace function fn_tier_cadence_days(t tier)
returns integer
language sql
immutable
as $$
  select case t when 'A' then 45 when 'B' then 90 when 'C' then 180 else null end;
$$;

create or replace function fn_tier_weight(t tier)
returns numeric
language sql
immutable
as $$
  select case t when 'A' then 3.0 when 'B' then 1.6 when 'C' then 1.0 else 0 end::numeric;
$$;

-- ---------------------------------------------------------------------------
-- fn_tier_as_of — tier is a point-in-time question
-- ---------------------------------------------------------------------------
-- Ranking an event on the tier its contacts hold *today* credits the event with
-- every year of relationship-building that followed it. Horizon-matched metrics
-- resolve tier from tier_history instead.

create or replace function fn_tier_as_of(p_person_id uuid, p_as_of timestamptz default now())
returns tier
language sql
stable
as $$
  select h.to_tier
  from tier_history h
  where h.person_id = p_person_id
    and h.changed_at <= p_as_of
  order by h.changed_at desc, h.created_at desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- fn_person_stage — the four-rung ladder (section 4.6)
-- ---------------------------------------------------------------------------
-- Evaluated in descending order, so Producing wins over Active. Stage moves on
-- its own as a relationship develops, which is what makes event ROI
-- self-updating: a business card that becomes a deal source climbs from Card to
-- Producing with no edit to the event record.
--
-- Returns null for anyone who had not established contact as of the date asked
-- about. That covers uncontacted people (who have no first_contact_at at all)
-- and correctly reports "no stage yet" when asked about an active person as of
-- a date before the relationship existed.
--
-- The ladder is measured from first contact, not from the first row in the log.
-- A watchlist entry with two unanswered outbound attempts that finally replies
-- is a Card — one real interaction — not a Contact. Counting the attempts would
-- credit the relationship for the operator's own unanswered effort.

create or replace function fn_person_stage(p_person_id uuid, p_as_of timestamptz default now())
returns dev_stage
language plpgsql
stable
as $$
declare
  as_of_date   date := fn_local_date(p_as_of);
  since        timestamptz;
  touch_count  integer;
  is_producing boolean;
  is_active    boolean;
begin
  select first_contact_at into since from people where id = p_person_id;

  if since is null or since > p_as_of then
    return null;
  end if;

  select count(*) into touch_count
  from v_contact_touchpoints t
  where t.person_id = p_person_id
    and t.occurred_at >= since
    and t.occurred_at <= p_as_of;

  if touch_count = 0 then
    return null;
  end if;

  -- Producing: has sourced a deal, made an introduction to the operator, or
  -- granted a favor.
  select
    exists (
      select 1 from deals d
      where d.source_person_id = p_person_id
        and coalesce(d.referred_on, fn_local_date(d.created_at)) <= as_of_date
    )
    or exists (
      select 1 from introductions i
      where i.perspective = 'received_by_me'
        and i.introducer_person_id = p_person_id
        and coalesce(i.occurred_on, fn_local_date(i.created_at)) <= as_of_date
    )
    or exists (
      select 1 from favors f
      where f.person_id = p_person_id
        and f.direction = 'received'
        and f.occurred_on <= as_of_date
    )
  into is_producing;

  if is_producing then
    return 'producing';
  end if;

  -- Active: at least one substantive touchpoint in the trailing 12 months.
  select exists (
    select 1 from v_contact_touchpoints t
    where t.person_id = p_person_id
      and t.substantive
      and t.occurred_at >= since
      and t.occurred_at <= p_as_of
      and t.occurred_at > p_as_of - interval '12 months'
  ) into is_active;

  if is_active then
    return 'active';
  end if;

  -- Contact: two or more touchpoints, nothing substantive since.
  if touch_count >= 2 then
    return 'contact';
  end if;

  -- Card: exactly one touchpoint, nothing since first contact.
  return 'card';
end;
$$;

comment on function fn_person_stage(uuid, timestamptz) is
  'Development stage as of any date. Computed from append-only logs, never stored, never manually set. Null when there is no qualifying contact as of that date.';

create view v_person_stage as
select
  p.id as person_id,
  fn_person_stage(p.id, now()) as stage
from people p
where p.contact_status = 'active';

-- ---------------------------------------------------------------------------
-- v_person_recency
-- ---------------------------------------------------------------------------
-- Only substantive touchpoints reset a cadence clock (section 4.5). A
-- conference handshake keeps the timeline honest without pretending the
-- relationship was maintained.

create view v_person_recency as
with agg as (
  select
    t.person_id,
    max(t.occurred_at)                                                        as last_touch_at,
    max(t.occurred_at) filter (where t.substantive)                           as last_substantive_at,
    max(t.occurred_at) filter (where t.direction in ('inbound', 'mutual'))    as last_inbound_at,
    max(t.occurred_at) filter (where t.direction in ('outbound', 'mutual'))   as last_outbound_at,
    count(*) filter (where t.occurred_at > now() - interval '365 days')       as touch_count_365d,
    count(*) filter (where t.substantive
                       and t.occurred_at > now() - interval '365 days')       as substantive_count_365d
  from v_contact_touchpoints t
  group by t.person_id
),
base as (
  select
    p.id as person_id,
    p.tier,
    p.first_contact_at,
    p.cadence_paused_until,
    a.last_touch_at,
    a.last_substantive_at,
    a.last_inbound_at,
    a.last_outbound_at,
    coalesce(a.touch_count_365d, 0)::integer       as touch_count_365d,
    coalesce(a.substantive_count_365d, 0)::integer as substantive_count_365d,
    case
      when p.tier = 'D' then null
      else coalesce(p.cadence_days_override, fn_tier_cadence_days(p.tier))
    end as effective_cadence_days
  from people p
  left join agg a on a.person_id = p.id
  where p.contact_status = 'active'
),
due as (
  select
    b.*,
    case
      when b.effective_cadence_days is null then null
      else coalesce(b.last_substantive_at, b.last_touch_at, b.first_contact_at)
           + make_interval(days => b.effective_cadence_days)
    end as next_due_at
  from base b
)
select
  d.person_id,
  d.tier,
  d.first_contact_at,
  d.last_touch_at,
  d.last_substantive_at,
  d.last_inbound_at,
  d.last_outbound_at,
  d.touch_count_365d,
  d.substantive_count_365d,
  d.effective_cadence_days,
  d.next_due_at,
  case
    when d.next_due_at is null then null
    else floor(extract(epoch from (now() - d.next_due_at)) / 86400)::integer
  end as days_overdue,
  (d.cadence_paused_until is not null and d.cadence_paused_until > now()) as is_paused,
  d.cadence_paused_until,
  -- The one signal the operator's own effort cannot manufacture: they wrote
  -- last and nobody wrote back.
  (
    d.last_inbound_at is not null
    and (d.last_outbound_at is null or d.last_outbound_at < d.last_inbound_at)
  ) as inbound_unanswered
from due d;

comment on view v_person_recency is
  'Active people only. next_due_at runs from the last substantive touch, because only substantive touchpoints reset a cadence clock. Tier D has no cadence and is never due.';
