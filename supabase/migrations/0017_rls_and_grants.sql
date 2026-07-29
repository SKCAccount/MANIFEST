-- 0017_rls_and_grants.sql
-- This database holds private notes about real people, including people who
-- have never spoken to the operator. Access is closed by default and opened
-- only to a named owner.
--
-- The policy loop runs over pg_tables rather than naming each table, so a table
-- added in a later migration cannot be silently left unprotected — a new table
-- without a policy is unreachable rather than public.

create table app_owners (
  user_id    uuid primary key,
  label      text,
  created_at timestamptz not null default now()
);

comment on table app_owners is
  'The single account this instance belongs to. RLS policies grant access to exactly these auth users.';

-- SECURITY DEFINER so the policy on app_owners itself does not recurse: the
-- function runs as the table owner, for whom RLS is not enforced.
create or replace function fn_is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_owners where user_id = auth.uid());
$$;

comment on function fn_is_owner() is
  'True when the current JWT belongs to a registered owner of this instance. Used by every RLS policy.';

-- ---------------------------------------------------------------------------
-- RLS on every table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t);

    -- Owner-only. One policy per command so the shape is obvious in psql, and
    -- so touchpoints can simply be missing its update/delete policies.
    execute format(
      'create policy %I on public.%I for select to authenticated using (fn_is_owner());',
      t || '_owner_select', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (fn_is_owner());',
      t || '_owner_insert', t);

    if t <> 'touchpoints' then
      execute format(
        'create policy %I on public.%I for update to authenticated using (fn_is_owner()) with check (fn_is_owner());',
        t || '_owner_update', t);
      execute format(
        'create policy %I on public.%I for delete to authenticated using (fn_is_owner());',
        t || '_owner_delete', t);
    end if;

    execute format('revoke all on public.%I from anon;', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
    execute format('grant all on public.%I to service_role;', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- The touchpoint log is append-only
-- ---------------------------------------------------------------------------
-- Belt and braces. Privileges are revoked here, RLS grants no update or delete
-- policy above, and trg_touchpoints_append_only blocks it for every role
-- including service_role. Recency is derived from this table and must never be
-- editable, directly or otherwise.

revoke update, delete on public.touchpoints from authenticated;
revoke update, delete on public.touchpoints from anon;

-- ---------------------------------------------------------------------------
-- Views run with the caller's permissions
-- ---------------------------------------------------------------------------
-- Without security_invoker a view executes as its owner and quietly bypasses
-- RLS on its base tables, which would make every "active only" filter the sole
-- thing standing between a caller and the whole table.

do $$
declare
  v text;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = on);', v);
    execute format('revoke all on public.%I from anon;', v);
    execute format('grant select on public.%I to authenticated;', v);
    execute format('grant select on public.%I to service_role;', v);
  end loop;
end;
$$;

-- Nothing in this schema is reachable without a JWT.
revoke usage on schema public from anon;
