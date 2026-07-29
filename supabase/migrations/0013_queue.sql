-- 0013_queue.sql
-- The home screen, and the answer to the ten-second test: who is overdue and
-- what do I say to them.

-- ---------------------------------------------------------------------------
-- v_queue
-- ---------------------------------------------------------------------------
-- Excludes do_not_contact, tier D (archived), and anyone paused. Uncontacted
-- people never reach here — v_person_recency is already active-only, and the
-- join enforces it a second time.
--
-- The opener is not decoration. A row that says "overdue by 40 days" and
-- nothing else gets skipped; a row that says "changed jobs three weeks ago"
-- gets acted on.

create view v_queue as
with scored as (
  select
    p.id                          as person_id,
    p.full_name,
    p.preferred_name,
    p.position,
    p.organization_id,
    o.name                        as organization_name,
    p.tier,
    p.city,
    p.state,
    r.days_overdue,
    r.effective_cadence_days,
    r.next_due_at,
    r.last_touch_at,
    r.last_substantive_at,
    r.inbound_unanswered,
    st.summary                    as last_substantive_summary,
    jc.changed_at                 as job_changed_at,
    fu.followup_title,
    fu.due_on                     as followup_due_on,
    rec.net_balance               as reciprocity_balance,
    rec.is_owed                   as reciprocity_owed,
    val.value_score,
    fn_tier_for_value(val.value_score) as implied_tier,
    unsent.content_title          as unsent_content_title,

    -- Section 6.3, term by term.
    round(
      (r.days_overdue::numeric / nullif(r.effective_cadence_days, 0)) * fn_tier_weight(p.tier)
      + case when r.inbound_unanswered then 2.0 else 0 end
      + case when fu.followup_title is not null then 1.5 else 0 end
      + case when jc.changed_at is not null then 1.0 else 0 end
      + case
          when val.value_score is not null
           and fn_tier_rank(fn_tier_for_value(val.value_score)) > fn_tier_rank(p.tier)
          then 0.8 else 0
        end
    , 3) as score
  from people p
  join v_person_recency r on r.person_id = p.id
  left join organizations o on o.id = p.organization_id
  left join v_relationship_value val on val.person_id = p.id
  left join v_reciprocity rec on rec.person_id = p.id

  -- The last thing actually discussed, for the opener.
  left join lateral (
    select t.summary
    from v_contact_touchpoints t
    where t.person_id = p.id and t.substantive and t.summary is not null
    order by t.occurred_at desc
    limit 1
  ) st on true

  -- A job change in the last 60 days is the best available pretext for a warm
  -- touch, so it both scores and supplies the opener.
  left join lateral (
    select ah.created_at as changed_at
    from affiliation_history ah
    where ah.person_id = p.id
      and ah.created_at > now() - interval '60 days'
    order by ah.created_at desc
    limit 1
  ) jc on true

  left join lateral (
    select f.title as followup_title, f.due_on
    from followups f
    where f.person_id = p.id and f.status = 'open' and f.due_on <= current_date
    order by f.due_on asc
    limit 1
  ) fu on true

  -- The newest piece in the library this person has not been sent. The library
  -- is the distinct set of titles already sent to someone, so this needs no
  -- separate content table.
  left join lateral (
    select ct.content_title
    from content_touches ct
    where not exists (
      select 1 from content_touches mine
      where mine.person_id = p.id
        and lower(mine.content_title) = lower(ct.content_title)
    )
    order by ct.sent_on desc
    limit 1
  ) unsent on true

  where p.contact_status = 'active'
    and p.do_not_contact = false
    and p.archived_at is null
    and p.tier <> 'D'
    and not r.is_paused
    and r.days_overdue is not null
    and r.days_overdue > 0
)
select
  s.*,
  case
    when s.job_changed_at is not null      then 'job_change'
    when s.inbound_unanswered              then 'inbound_unanswered'
    when s.followup_title is not null      then 'followup'
    when s.reciprocity_owed                then 'reciprocity'
    when s.unsent_content_title is not null then 'content'
    when s.last_substantive_summary is not null then 'last_conversation'
    else 'overdue'
  end as opener_kind,
  case
    when s.job_changed_at is not null then
      'New role at ' || coalesce(s.organization_name, 'a new employer') || ' — congratulate and catch up.'
    when s.inbound_unanswered then
      'They reached out last and it went unanswered. Reply to that thread.'
    when s.followup_title is not null then
      'Follow-up due ' || to_char(s.followup_due_on, 'Mon FMDD') || ': ' || s.followup_title
    when s.reciprocity_owed then
      'You are ' || abs(s.reciprocity_balance) || ' favors down. Offer something before you ask.'
    when s.unsent_content_title is not null then
      'Send "' || s.unsent_content_title || '" — they have not received it.'
    when s.last_substantive_summary is not null then
      'Last time: ' || s.last_substantive_summary
    else
      'No substantive contact on record. Open with something specific.'
  end as suggested_opener,
  row_number() over (order by s.score desc nulls last, s.days_overdue desc)::integer as queue_rank
from scored s
order by s.score desc nulls last, s.days_overdue desc;

comment on view v_queue is
  'Ordered overdue list. The home screen shows queue_rank <= 15; the view itself is uncapped so Insights and exports can read the tail.';

-- ---------------------------------------------------------------------------
-- v_never_followed_up
-- ---------------------------------------------------------------------------
-- Sits directly beneath the queue. These are people the operator met once and
-- never contacted again — still recoverable, but not for much longer. Capped at
-- 120 days because after that it is no longer a follow-up, it is a re-approach.

create view v_never_followed_up as
select
  p.id                as person_id,
  p.full_name,
  p.position,
  p.organization_id,
  o.name              as organization_name,
  p.tier,
  p.city,
  p.state,
  s.display_name      as met_at,
  p.met_on,
  t.occurred_at       as only_touch_at,
  t.channel           as only_touch_channel,
  t.summary           as only_touch_summary,
  floor(extract(epoch from (now() - t.occurred_at)) / 86400)::integer as days_since
from people p
join lateral (
  select tc.occurred_at, tc.channel, tc.summary
  from v_contact_touchpoints tc
  where tc.person_id = p.id
  order by tc.occurred_at desc
  limit 1
) t on true
left join organizations o on o.id = p.organization_id
left join sources s on s.id = p.met_at_source_id
where p.contact_status = 'active'
  and p.do_not_contact = false
  and p.archived_at is null
  and fn_person_stage(p.id, now()) = 'card'
  and t.occurred_at > now() - interval '120 days'
order by days_since desc;
