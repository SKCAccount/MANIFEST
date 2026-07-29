-- 0016_data_quality.sql
-- The Triage screen's fourth tab. Everything here is a thing the operator can
-- fix in one edit.
--
-- Watchlist age is deliberately absent. A watchlist entry that has sat for two
-- years is not a defect — its value is contingent on a trigger that has no
-- schedule, so elapsed time carries no information about it.

create view v_data_quality as

-- Near-duplicate organization names. "Naturally New York" and "Naturally NY"
-- split a sort, and no unique index can catch that.
select
  'duplicate_organization'::text as issue_kind,
  'warning'::text                as severity,
  'organization'::text           as entity_type,
  a.id                           as entity_id,
  a.name::text                   as entity_label,
  'Looks like a duplicate of "' || b.name::text || '" (similarity '
    || round(similarity(a.name::text, b.name::text)::numeric, 2) || ')' as detail
from organizations a
join organizations b
  on a.id < b.id
 and a.name::text % b.name::text
 and similarity(a.name::text, b.name::text) > 0.55

union all

-- Taxonomy drift: "CPG" versus "C.P.G." inside the same domain.
select
  'taxonomy_drift',
  'warning',
  'taxonomy',
  a.id,
  a.domain || ': ' || a.value,
  'Near-duplicate of "' || b.value || '" in the same domain'
from taxonomies a
join taxonomies b
  on a.domain = b.domain
 and a.id < b.id
 and a.value % b.value
 and similarity(a.value, b.value) > 0.55

union all

-- Region drives mailing-list jurisdiction. Missing it blocks a person from
-- every compliant export.
select
  'missing_region',
  'warning',
  'person',
  p.id,
  p.full_name,
  'No region set; excluded from consent-gated exports'
from people p
where p.contact_status = 'active'
  and p.archived_at is null
  and p.region is null

union all

-- No way to reach them at all.
select
  'missing_contact_info',
  'error',
  'person',
  p.id,
  p.full_name,
  'No email, phone or LinkedIn on record'
from people p
where p.contact_status = 'active'
  and p.archived_at is null
  and p.email_work is null
  and p.email_personal is null
  and p.phone_mobile is null
  and p.phone_office is null
  and p.linkedin_url is null

union all

-- Reachable if a source kind is reclassified into the event family after the
-- fact: the write trigger cannot retroactively fix rows already stored.
select
  'event_missing_cost',
  'error',
  'source',
  s.id,
  s.display_name,
  case
    when s.cost_total_cents is null and s.event_year is null then 'Event source has no cost and no year'
    when s.cost_total_cents is null then 'Event source has no cost breakdown'
    else 'Event source has no year, so it cannot join a series'
  end
from sources s
where fn_source_kind_is_event(s.kind)
  and (s.cost_total_cents is null or s.event_year is null or s.occurred_on is null)

union all

-- Two years of silence is a relationship that has already decayed. This is the
-- one place it is called out as a data problem rather than a queue item,
-- because tier D and paused records never reach the queue at all.
select
  'stale_active_record',
  'info',
  'person',
  p.id,
  p.full_name,
  'No contact in 24 months — confirm the relationship still exists or archive to tier D'
from people p
left join v_person_recency r on r.person_id = p.id
where p.contact_status = 'active'
  and p.archived_at is null
  and (r.last_touch_at is null or r.last_touch_at < now() - interval '24 months')

union all

-- The normalizer returns unrecognized input verbatim rather than inventing a
-- country code. This is where those land.
select
  'unnormalized_phone',
  'warning',
  'person',
  p.id,
  p.full_name,
  'Phone value is not E.164: ' || coalesce(
    nullif(case when p.phone_mobile !~ '^\+[1-9][0-9]{6,14}$' then p.phone_mobile end, ''),
    p.phone_office)
from people p
where (p.phone_mobile is not null and p.phone_mobile !~ '^\+[1-9][0-9]{6,14}$')
   or (p.phone_office is not null and p.phone_office !~ '^\+[1-9][0-9]{6,14}$')

union all

-- An uncontacted record whose only identifier is an organization is thin. Not
-- an error — the constraint deliberately allows it — but worth surfacing.
select
  'thin_watchlist_identifier',
  'info',
  'person',
  p.id,
  p.full_name,
  'Watchlist entry has only an organization, no direct handle'
from people p
where p.contact_status = 'uncontacted'
  and p.organization_id is not null
  and p.linkedin_url is null
  and p.email_work is null
  and p.email_personal is null
  and p.phone_mobile is null
  and p.phone_office is null;

comment on view v_data_quality is
  'Fixable defects only. Watchlist age is intentionally not reported: elapsed time says nothing about a watchlist entry.';
