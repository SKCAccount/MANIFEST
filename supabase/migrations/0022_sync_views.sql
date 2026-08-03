-- 0022_sync_views.sql
-- The two reads Phase 2's screens are built on.
--
-- Both exist as views rather than as queries in the app for the same reason
-- every other view here does: the rules about what counts — which channels are
-- real, which suggestions are still open, what "stale" means — belong next to
-- the data, not repeated in each caller.

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- v_sync_status
-- ---------------------------------------------------------------------------
-- One row per channel, always. The channel list is a literal here rather than
-- being derived from sync_state, because sync_state has no row for a channel
-- that has never run — and "Calendar has never run" is precisely what the
-- status screen most needs to say. Deriving the list from the data would make
-- the never-run case invisible, which is the failure this screen exists to
-- prevent.
--
-- `is_stale` is the one judgement the view makes: a channel whose last
-- successful run is more than six hours old, given hourly cron. Not an error —
-- a laptop that was closed overnight is not a defect — but the thing to look at
-- first when the queue seems wrong.

create view v_sync_status as
with channels (channel, label) as (
  values ('gmail', 'Gmail'), ('gcal', 'Calendar')
),
latest as (
  select distinct on (r.channel) r.*
  from sync_runs r
  order by r.channel, r.started_at desc
),
last_ok as (
  select distinct on (r.channel) r.channel, r.finished_at
  from sync_runs r
  where r.status = 'ok'
  order by r.channel, r.finished_at desc
)
select
  c.channel,
  c.label,
  s.cursor,
  s.detail,

  l.id            as last_run_id,
  l.status        as last_run_status,
  l.provider_kind as last_run_provider,
  l.started_at    as last_run_started_at,
  l.finished_at   as last_run_finished_at,
  l.counts        as last_run_counts,
  l.error         as last_run_error,

  ok.finished_at  as last_success_at,
  (l.id is null)  as never_run,
  (l.status = 'running') as in_flight,

  -- Null rather than true when nothing has ever succeeded: "never run" and
  -- "ran and then went quiet" are different problems with different fixes, and
  -- collapsing them into one boolean would hide that.
  case
    when ok.finished_at is null then null
    else ok.finished_at < now() - interval '6 hours'
  end as is_stale
from channels c
left join sync_state s on s.channel = c.channel
left join latest    l  on l.channel = c.channel
left join last_ok   ok on ok.channel = c.channel;

comment on view v_sync_status is
  'One row per sync channel whether or not it has ever run. The channel list is literal on purpose: a channel missing from sync_state is the case the status screen most needs to report.';

-- ---------------------------------------------------------------------------
-- v_review_queue
-- ---------------------------------------------------------------------------
-- Everything sync could not resolve, with enough context attached that the
-- operator can decide without opening Gmail.
--
-- The two lateral joins are the whole point of the screen. A bare list of
-- unrecognized addresses is tedious to work: for each one the operator has to
-- remember whether they know that person and search the rolodex by hand. So the
-- view does the two lookups that are cheap and almost always sufficient:
--
--   suggested_person  — trigram match on the display name Gmail supplied
--                       against the same normalized name key the dedupe
--                       matcher uses. Catches "amanda.chen@bluepoch.com,
--                       Amanda Chen" against an Amanda Chen already on file
--                       under a personal address.
--
--   domain_organization — the address's domain against organizations.domain.
--                       Does not identify the person, but "this is somebody at
--                       Bluepoch" is most of what the operator needs to decide
--                       whether to bother.
--
-- Both are hints and neither is applied automatically. Sync does not create
-- people, and a name similarity of 0.8 is a prompt, not a fact.

create view v_review_queue as
select
  r.id,
  r.kind,
  r.source,
  r.created_at,
  r.updated_at,
  r.note,

  r.external_id                                     as address,
  r.payload->>'display_name'                        as display_name,
  coalesce((r.payload->>'occurrences')::int, 1)     as occurrences,
  (r.payload->>'first_seen')::timestamptz           as first_seen,
  (r.payload->>'last_seen')::timestamptz            as last_seen,
  r.payload->>'last_subject'                        as last_subject,
  r.payload->>'last_direction'                      as last_direction,
  r.payload->>'permalink'                           as permalink,
  nullif(split_part(r.external_id, '@', 2), '')     as domain,

  m.person_id       as suggested_person_id,
  m.full_name       as suggested_person_name,
  m.score           as suggested_score,

  o.id              as domain_organization_id,
  o.name            as domain_organization_name
from staging_records r

left join lateral (
  select
    p.id as person_id,
    p.full_name,
    round(similarity(p.name_key, fn_normalize_name(r.payload->>'display_name'))::numeric, 2) as score
  from people p
  where nullif(btrim(coalesce(r.payload->>'display_name', '')), '') is not null
    and p.name_key is not null
    and p.archived_at is null
    and p.name_key % fn_normalize_name(r.payload->>'display_name')
  order by similarity(p.name_key, fn_normalize_name(r.payload->>'display_name')) desc
  limit 1
) m on true

left join lateral (
  select org.id, org.name
  from organizations org
  where org.domain is not null
    and org.domain = nullif(split_part(r.external_id, '@', 2), '')::citext
  limit 1
) o on true

where r.status = 'pending'
  and r.kind in ('gmail_suggestion', 'calendar_suggestion');

comment on view v_review_queue is
  'Pending sync suggestions with a proposed person (trigram on the supplied display name) and a proposed organization (address domain). Both are hints for the operator, never applied automatically.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
-- 0017's view loop ran before these existed. Without security_invoker a view
-- executes as its owner and quietly bypasses RLS on its base tables — and
-- v_review_queue reads `people`.

alter view v_sync_status  set (security_invoker = on);
alter view v_review_queue set (security_invoker = on);

revoke all on v_sync_status, v_review_queue from anon;
grant select on v_sync_status, v_review_queue to authenticated, service_role;
