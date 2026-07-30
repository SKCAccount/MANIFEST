-- 0012_value_reciprocity_deals.sql
-- What a relationship is actually worth, measured against what the operator
-- assigned it. Active people only, throughout.

set search_path = manifest, public, extensions;

create or replace function fn_tier_rank(t tier)
returns integer
language sql
immutable
as $$
  select case t when 'A' then 4 when 'B' then 3 when 'C' then 2 when 'D' then 1 end;
$$;

-- The tier a computed value would earn on its own. Used by the queue to spot
-- relationships the operator is underrating.
create or replace function fn_tier_for_value(v numeric)
returns tier
language sql
immutable
as $$
  select case
    when v is null then null
    when v >= 70 then 'A'
    when v >= 45 then 'B'
    when v >= 20 then 'C'
    else 'D'
  end::tier;
$$;

-- ---------------------------------------------------------------------------
-- v_reciprocity
-- ---------------------------------------------------------------------------
-- Direction is from the operator's point of view. net_balance = gave - received,
-- so a negative balance means the operator is in this person's debt.

create view v_reciprocity as
select
  p.id                                                              as person_id,
  count(f.id) filter (where f.direction = 'gave')::integer          as favors_given,
  count(f.id) filter (where f.direction = 'received')::integer      as favors_received,
  (count(f.id) filter (where f.direction = 'gave')
   - count(f.id) filter (where f.direction = 'received'))::integer  as net_balance,
  max(f.occurred_on)                                                as last_favor_on,
  (count(f.id) filter (where f.direction = 'gave')
   - count(f.id) filter (where f.direction = 'received')) <= -2     as is_owed
from people p
left join favors f on f.person_id = p.id
where p.contact_status = 'active'
group by p.id;

comment on view v_reciprocity is
  'net_balance = favors given minus favors received, from the operator''s point of view. is_owed marks people the operator owes (net at or below -2).';

-- ---------------------------------------------------------------------------
-- v_deal_sources
-- ---------------------------------------------------------------------------
-- Zero-producers stay visible on purpose: "this deal source has never sourced a
-- deal" is exactly the thing worth seeing.

create view v_deal_sources as
select
  p.id                                                                     as person_id,
  p.full_name,
  p.organization_id,
  p.tier,
  count(d.id)::integer                                                     as deals_referred,
  count(d.id) filter (where d.stage = 'funded')::integer                   as deals_funded,
  coalesce(sum(d.amount_cents) filter (where d.stage = 'funded'), 0)::bigint       as funded_dollars_cents,
  coalesce(sum(d.commission_earned_cents), 0)::bigint                             as commissions_earned_cents,
  coalesce(sum(d.commission_paid_cents), 0)::bigint                               as commissions_paid_cents,
  case
    when count(d.id) = 0 then null
    else round(count(d.id) filter (where d.stage = 'funded')::numeric / count(d.id), 3)
  end                                                                      as conversion_rate,
  max(d.referred_on)                                                       as last_referral_on
from people p
left join deals d on d.source_person_id = p.id
where p.contact_status = 'active'
group by p.id, p.full_name, p.organization_id, p.tier;

create view v_deal_sources_org as
select
  o.id                                                                     as organization_id,
  o.name,
  count(d.id)::integer                                                     as deals_referred,
  count(d.id) filter (where d.stage = 'funded')::integer                   as deals_funded,
  coalesce(sum(d.amount_cents) filter (where d.stage = 'funded'), 0)::bigint as funded_dollars_cents,
  coalesce(sum(d.commission_earned_cents), 0)::bigint                      as commissions_earned_cents,
  case
    when count(d.id) = 0 then null
    else round(count(d.id) filter (where d.stage = 'funded')::numeric / count(d.id), 3)
  end                                                                      as conversion_rate,
  max(d.referred_on)                                                       as last_referral_on
from organizations o
left join deals d on d.source_organization_id = o.id
group by o.id, o.name;

-- ---------------------------------------------------------------------------
-- v_network_centrality
-- ---------------------------------------------------------------------------
-- Distinct rolodex members reachable through the introduction graph. Chains
-- resolve naturally: Erica introduces Amanda, Amanda introduces someone else,
-- and centrality reflects it.
--
-- Depth is capped at 3. Beyond that every well-connected person reaches the
-- whole graph and the measure stops discriminating.

create view v_network_centrality as
with recursive edges as (
  select i.introducer_person_id as src, i.party_a_person_id as dst
  from introductions i
  where i.introducer_person_id is not null and i.party_a_person_id is not null
  union all
  select i.introducer_person_id, i.party_b_person_id
  from introductions i
  where i.introducer_person_id is not null and i.party_b_person_id is not null
),
reach as (
  select p.id as root, e.dst as node, 1 as depth
  from people p
  join edges e on e.src = p.id
  where p.contact_status = 'active'
  union
  select r.root, e.dst, r.depth + 1
  from reach r
  join edges e on e.src = r.node
  where r.depth < 3
)
select
  p.id as person_id,
  coalesce(c.reach_count, 0)::integer as network_centrality
from people p
left join (
  select root, count(distinct node) filter (where node <> root)::integer as reach_count
  from reach
  group by root
) c on c.root = p.id
where p.contact_status = 'active';

-- ---------------------------------------------------------------------------
-- v_relationship_value  (0..100)
-- ---------------------------------------------------------------------------
-- Each component is normalized against the active population, so the score
-- answers "compared to everyone else in this rolodex" rather than against an
-- absolute scale that would drift as the network grows.
--
-- inbound_initiation_ratio earns its 15 points because it is the one signal the
-- operator's own effort cannot manufacture.

create view v_relationship_value as
with components as (
  select
    p.id as person_id,
    coalesce(ds.funded_dollars_cents, 0)                             as funded_dollars_cents,
    coalesce(ic.intros_received_count, 0)                            as intros_received_count,
    coalesce(tc.inbound_initiation_ratio, 0)                         as inbound_initiation_ratio,
    coalesce(tc.substantive_touches_24mo, 0)                         as substantive_touches_24mo,
    coalesce(nc.network_centrality, 0)                               as network_centrality,
    coalesce(rc.favors_received, 0)                                  as favors_received,
    case when coalesce(rc.is_owed, false) then 1 else 0 end          as reciprocity_deficit_flag
  from people p
  left join v_deal_sources ds on ds.person_id = p.id
  left join v_network_centrality nc on nc.person_id = p.id
  left join v_reciprocity rc on rc.person_id = p.id
  left join (
    select
      i.introducer_person_id as person_id,
      count(*)::integer      as intros_received_count
    from introductions i
    where i.perspective = 'received_by_me' and i.introducer_person_id is not null
    group by i.introducer_person_id
  ) ic on ic.person_id = p.id
  left join (
    select
      t.person_id,
      case
        when count(*) = 0 then 0
        else count(*) filter (where t.direction in ('inbound', 'mutual'))::numeric / count(*)
      end as inbound_initiation_ratio,
      count(*) filter (where t.substantive
                         and t.occurred_at > now() - interval '24 months')::integer
        as substantive_touches_24mo
    from v_contact_touchpoints t
    group by t.person_id
  ) tc on tc.person_id = p.id
  where p.contact_status = 'active'
),
normalized as (
  select
    c.*,
    c.funded_dollars_cents::numeric   / nullif(max(c.funded_dollars_cents)   over (), 0) as n_funded,
    c.intros_received_count::numeric  / nullif(max(c.intros_received_count)  over (), 0) as n_intros,
    c.inbound_initiation_ratio        / nullif(max(c.inbound_initiation_ratio) over (), 0) as n_inbound,
    c.substantive_touches_24mo::numeric / nullif(max(c.substantive_touches_24mo) over (), 0) as n_substantive,
    c.network_centrality::numeric     / nullif(max(c.network_centrality)     over (), 0) as n_centrality,
    c.favors_received::numeric        / nullif(max(c.favors_received)        over (), 0) as n_favors
  from components c
)
select
  n.person_id,
  n.funded_dollars_cents,
  n.intros_received_count,
  round(n.inbound_initiation_ratio, 3) as inbound_initiation_ratio,
  n.substantive_touches_24mo,
  n.network_centrality,
  n.favors_received,
  n.reciprocity_deficit_flag,
  greatest(0, least(100, round(
      30 * coalesce(n.n_funded, 0)
    + 20 * coalesce(n.n_intros, 0)
    + 15 * coalesce(n.n_inbound, 0)
    + 15 * coalesce(n.n_substantive, 0)
    + 10 * coalesce(n.n_centrality, 0)
    + 10 * coalesce(n.n_favors, 0)
    -  8 * n.reciprocity_deficit_flag
  , 1)))::numeric as value_score
from normalized n;

comment on view v_relationship_value is
  'Score 0-100 over the active population. Computed on read rather than snapshotted, per the constraint that nothing time-dependent is stored.';

-- ---------------------------------------------------------------------------
-- v_tier_mismatch
-- ---------------------------------------------------------------------------

create view v_tier_mismatch as
with traj as (
  select
    h.person_id,
    (array_agg(h.to_tier order by h.changed_at asc, h.created_at asc))[1] as first_tier,
    count(*) filter (where h.from_tier is not null)::integer              as tier_changes,
    max(h.changed_at) filter (where h.from_tier is not null)              as last_tier_change_at
  from tier_history h
  group by h.person_id
)
select
  p.id                     as person_id,
  p.full_name,
  p.organization_id,
  p.tier                   as assigned_tier,
  v.value_score,
  fn_tier_for_value(v.value_score) as implied_tier,
  case
    when p.tier in ('C', 'D') and v.value_score > 60 then 'underrated'
    else 'overrated'
  end                      as verdict,
  r.last_substantive_at,
  t.first_tier,
  coalesce(t.tier_changes, 0) as tier_changes,
  t.last_tier_change_at,
  case
    when t.first_tier is null then 'unknown'
    when fn_tier_rank(p.tier) > fn_tier_rank(t.first_tier) then 'improving'
    when fn_tier_rank(p.tier) < fn_tier_rank(t.first_tier) then 'declining'
    else 'flat'
  end                      as trajectory
from people p
join v_relationship_value v on v.person_id = p.id
left join v_person_recency r on r.person_id = p.id
left join traj t on t.person_id = p.id
where p.contact_status = 'active'
  and (
    (p.tier in ('C', 'D') and v.value_score > 60)
    or (
      p.tier = 'A'
      and v.value_score < 20
      and (r.last_substantive_at is null or r.last_substantive_at < now() - interval '12 months')
    )
  );
