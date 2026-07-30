-- 0014_source_metrics.sql
-- Live event economics (section 4.7).
--
-- Cost per introduction is a leading indicator and is trivially flattered by
-- collecting business cards, so the full ladder is computed and the default
-- ranking is cost per Active-or-better contact.
--
-- Nothing here is snapshotted. Every figure reconstructs from
-- touchpoints.occurred_at, deals.referred_on / closed_on, and tier_history.
-- Editing an event's cost moves every derived metric at once, because there is
-- only one copy of the cost.

-- ---------------------------------------------------------------------------
-- fn_source_metrics
-- ---------------------------------------------------------------------------
-- With horizon_days supplied, every input filters to on or before
-- occurred_on + horizon_days — touchpoints, deals, and tier state resolved from
-- tier_history. That is what makes a two-year-old conference comparable to a
-- six-month-old one: both are measured at the same age, not at today's date,
-- which would systematically favour whichever one has had longer to mature.

set search_path = manifest, public, extensions;

create or replace function fn_source_metrics(p_source_id uuid, p_horizon_days integer default null)
returns table (
  source_id                       uuid,
  horizon_days                    integer,
  cutoff_at                       timestamptz,
  is_mature                       boolean,
  days_since_event                integer,
  cost_total_cents                bigint,
  new_contacts                    integer,
  relationships_touched           integer,
  stage_card                      integer,
  stage_contact                   integer,
  stage_active                    integer,
  stage_producing                 integer,
  active_or_better                integer,
  tier_ab_contacts                integer,
  deals_sourced                   integer,
  deals_funded                    integer,
  funded_dollars_cents            bigint,
  commissions_earned_cents        bigint,
  cost_per_new_contact_cents      bigint,
  cost_per_active_or_better_cents bigint,
  cost_per_producing_cents        bigint,
  return_multiple                 numeric
)
language sql
stable
as $$
  with src as (
    select
      s.id,
      s.occurred_on,
      s.cost_total_cents,
      case
        when p_horizon_days is null then now()
        when s.occurred_on is null then null
        else (s.occurred_on + make_interval(days => p_horizon_days))::timestamptz
      end as cutoff
    from sources s
    where s.id = p_source_id
  ),
  -- Active people whose Met At is this source. Uncontacted people never appear
  -- in any numerator or denominator, without exception.
  new_contacts as (
    select p.id
    from people p
    cross join src
    where p.met_at_source_id = src.id
      and p.contact_status = 'active'
      and src.cutoff is not null
      and coalesce(p.first_contact_at, p.met_on::timestamptz) <= src.cutoff
  ),
  staged as (
    select
      nc.id,
      fn_person_stage(nc.id, src.cutoff) as stage,
      fn_tier_as_of(nc.id, src.cutoff)   as tier_at
    from new_contacts nc
    cross join src
  ),
  -- Distinct people with any touchpoint tagged to this source, including people
  -- who were already in the rolodex. Seeing fifteen existing relationships at a
  -- conference is a legitimate reason to attend; it is tracked separately and
  -- never folded into the new-contact denominator.
  touched as (
    select count(distinct t.person_id)::integer as n
    from v_contact_touchpoints t
    join people p on p.id = t.person_id and p.contact_status = 'active'
    cross join src
    where t.source_id = src.id
      and src.cutoff is not null
      and t.occurred_at <= src.cutoff
  ),
  dealz as (
    select
      count(*)::integer                                                          as sourced,
      count(*) filter (where d.stage = 'funded' and d.closed_on <= fn_local_date(src.cutoff))::integer as funded,
      coalesce(sum(d.amount_cents) filter (
        where d.stage = 'funded' and d.closed_on <= fn_local_date(src.cutoff)), 0)::bigint             as funded_cents,
      coalesce(sum(d.commission_earned_cents) filter (
        where d.stage = 'funded' and d.closed_on <= fn_local_date(src.cutoff)), 0)::bigint            as commission_cents
    from deals d
    join new_contacts nc on nc.id = d.source_person_id
    cross join src
    where coalesce(d.referred_on, fn_local_date(d.created_at)) <= fn_local_date(src.cutoff)
  ),
  rollup as (
    select
      src.id                                                             as source_id,
      src.occurred_on,
      src.cutoff,
      src.cost_total_cents,
      (select count(*)::integer from new_contacts)                       as n_new,
      (select n from touched)                                            as n_touched,
      (select count(*)::integer from staged where stage = 'card')        as n_card,
      (select count(*)::integer from staged where stage = 'contact')     as n_contact,
      (select count(*)::integer from staged where stage = 'active')      as n_active,
      (select count(*)::integer from staged where stage = 'producing')   as n_producing,
      (select count(*)::integer from staged where tier_at in ('A', 'B')) as n_tier_ab,
      (select sourced from dealz)                                        as n_deals,
      (select funded from dealz)                                         as n_funded,
      (select funded_cents from dealz)                                   as funded_cents,
      (select commission_cents from dealz)                               as commission_cents
    from src
  )
  select
    r.source_id,
    p_horizon_days,
    r.cutoff,
    case
      when p_horizon_days is null then true
      when r.occurred_on is null then false
      else (current_date - r.occurred_on) >= p_horizon_days
    end                                                     as is_mature,
    case when r.occurred_on is null then null
         else (current_date - r.occurred_on)::integer end   as days_since_event,
    r.cost_total_cents,
    r.n_new,
    coalesce(r.n_touched, 0),
    r.n_card,
    r.n_contact,
    r.n_active,
    r.n_producing,
    (r.n_active + r.n_producing)                            as active_or_better,
    r.n_tier_ab,
    r.n_deals,
    r.n_funded,
    r.funded_cents,
    r.commission_cents,
    (r.cost_total_cents / nullif(r.n_new, 0))                            as cost_per_new_contact_cents,
    (r.cost_total_cents / nullif(r.n_active + r.n_producing, 0))         as cost_per_active_or_better_cents,
    (r.cost_total_cents / nullif(r.n_producing, 0))                      as cost_per_producing_cents,
    case
      when coalesce(r.cost_total_cents, 0) = 0 then null
      else round(r.commission_cents::numeric / r.cost_total_cents, 3)
    end                                                                  as return_multiple
  from rollup r;
$$;

comment on function fn_source_metrics(uuid, integer) is
  'The metric ladder for one source, at present (horizon null) or at a fixed age. Uncontacted people never appear in any numerator or denominator.';

-- ---------------------------------------------------------------------------
-- v_source_roi — present-day picture
-- ---------------------------------------------------------------------------
-- days_since_event and new_contacts sit next to every ratio so a three-week-old
-- $4,200 event with one attributed contact reads as incomplete rather than as a
-- failure.

create view v_source_roi as
select
  -- source_id arrives from m.*; selecting s.id as well would duplicate it.
  s.event_name,
  s.event_year,
  s.display_name,
  s.kind,
  s.occurred_on,
  s.city,
  s.state,
  s.attended,
  s.cost_pass_cents,
  s.cost_travel_cents,
  s.cost_lodging_cents,
  s.cost_meals_cents,
  s.cost_other_cents,
  m.*,
  (m.days_since_event >= 90)  as mature_90,
  (m.days_since_event >= 180) as mature_180,
  (m.days_since_event >= 365) as mature_365,
  (m.days_since_event >= 730) as mature_730
from sources s
cross join lateral fn_source_metrics(s.id, null) m;

-- ---------------------------------------------------------------------------
-- v_source_cohort — the fair comparison surface
-- ---------------------------------------------------------------------------
-- One row per source per horizon, populated only where the source is at least
-- that old. Events younger than the selected horizon are absent here and the
-- events screen shows them below the fold as immature, rather than scoring them
-- against mature ones.

create view v_source_cohort as
select
  s.event_name,
  s.event_year,
  s.display_name,
  s.kind,
  s.occurred_on,
  m.*
from sources s
cross join (values (90), (180), (365), (730)) as h(horizon)
cross join lateral fn_source_metrics(s.id, h.horizon) m
where m.is_mature;

-- ---------------------------------------------------------------------------
-- v_source_series — the same show, year over year
-- ---------------------------------------------------------------------------
-- The series is simply the distinct event_name, because name and year are
-- separate columns. There is no series key to maintain or mistype.

create view v_source_series as
select
  r.event_name,
  count(*)::integer                              as editions,
  min(r.event_year)                              as first_year,
  max(r.event_year)                              as last_year,
  sum(r.cost_total_cents)::bigint                as cost_total_cents,
  sum(r.new_contacts)::integer                   as new_contacts,
  sum(r.relationships_touched)::integer          as relationships_touched,
  sum(r.stage_card)::integer                     as stage_card,
  sum(r.stage_contact)::integer                  as stage_contact,
  sum(r.stage_active)::integer                   as stage_active,
  sum(r.stage_producing)::integer                as stage_producing,
  sum(r.active_or_better)::integer               as active_or_better,
  sum(r.deals_sourced)::integer                  as deals_sourced,
  sum(r.deals_funded)::integer                   as deals_funded,
  sum(r.funded_dollars_cents)::bigint            as funded_dollars_cents,
  sum(r.commissions_earned_cents)::bigint        as commissions_earned_cents,
  (sum(r.cost_total_cents) / nullif(sum(r.new_contacts), 0))                        as cost_per_new_contact_cents,
  (sum(r.cost_total_cents) / nullif(sum(r.active_or_better), 0))                    as cost_per_active_or_better_cents,
  (sum(r.cost_total_cents) / nullif(sum(r.stage_producing), 0))                     as cost_per_producing_cents,
  case
    when coalesce(sum(r.cost_total_cents), 0) = 0 then null
    else round(sum(r.commissions_earned_cents)::numeric / sum(r.cost_total_cents), 3)
  end                                            as return_multiple
from v_source_roi r
group by r.event_name;
