-- 0017_rls_and_grants.sql
-- This database holds private notes about real people, including people who
-- have never spoken to the operator. Access is closed by default and opened
-- only to a named owner.
--
-- The policy loop runs over pg_tables rather than naming each table, so a table
-- added in a later migration cannot be silently left unprotected — a new table
-- without a policy is unreachable rather than public. It is scoped to the
-- `manifest` schema, so it can never touch another system's tables on a shared
-- database.

set search_path = manifest, public, extensions;

-- ---------------------------------------------------------------------------
-- Who may read this system
-- ---------------------------------------------------------------------------
-- Deliberately per-system rather than a single database-wide owner table.
-- Several systems share this database and one auth provider, so being signed in
-- is not the same question as being allowed to read MANIFEST. Access to the
-- rolodex is granted here and nowhere else; another system granting access to
-- itself has no effect on this one.

create table app_owners (
  user_id    uuid primary key,
  label      text,
  created_at timestamptz not null default now()
);

comment on table app_owners is
  'Auth users permitted to read MANIFEST. Scoped to this system: shared auth across systems does not imply shared access.';

-- SECURITY DEFINER so the policy on app_owners itself does not recurse: the
-- function runs as the table owner, for whom RLS is not enforced.
--
-- The explicit search_path is a security requirement, not a convenience. A
-- definer function without one resolves `app_owners` against the caller's
-- search_path, so a caller who can create a schema could shadow the table and
-- authorize themselves.
create or replace function fn_is_owner()
returns boolean
language sql
stable
security definer
set search_path = manifest, public
as $$
  select exists (select 1 from manifest.app_owners where user_id = auth.uid());
$$;

comment on function fn_is_owner() is
  'True when the current JWT belongs to a registered owner of MANIFEST. Used by every RLS policy in this schema.';

-- ---------------------------------------------------------------------------
-- Schema access
-- ---------------------------------------------------------------------------
-- The client roles need USAGE on the schema before any table grant means
-- anything. anon is never granted it: nothing here is reachable without a JWT.

grant usage on schema manifest to authenticated, service_role;
revoke all on schema manifest from anon;

-- ---------------------------------------------------------------------------
-- RLS on every table
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'manifest'
  loop
    execute format('alter table manifest.%I enable row level security;', t);

    -- Owner-only. One policy per command so the shape is obvious in psql, and
    -- so touchpoints can simply be missing its update/delete policies.
    execute format(
      'create policy %I on manifest.%I for select to authenticated using (manifest.fn_is_owner());',
      t || '_owner_select', t);
    execute format(
      'create policy %I on manifest.%I for insert to authenticated with check (manifest.fn_is_owner());',
      t || '_owner_insert', t);

    if t <> 'touchpoints' then
      execute format(
        'create policy %I on manifest.%I for update to authenticated using (manifest.fn_is_owner()) with check (manifest.fn_is_owner());',
        t || '_owner_update', t);
      execute format(
        'create policy %I on manifest.%I for delete to authenticated using (manifest.fn_is_owner());',
        t || '_owner_delete', t);
    end if;

    execute format('revoke all on manifest.%I from anon;', t);
    execute format('grant select, insert, update, delete on manifest.%I to authenticated;', t);
    execute format('grant all on manifest.%I to service_role;', t);
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

revoke update, delete on manifest.touchpoints from authenticated;
revoke update, delete on manifest.touchpoints from anon;

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
    where n.nspname = 'manifest' and c.relkind = 'v'
  loop
    execute format('alter view manifest.%I set (security_invoker = on);', v);
    execute format('revoke all on manifest.%I from anon;', v);
    execute format('grant select on manifest.%I to authenticated;', v);
    execute format('grant select on manifest.%I to service_role;', v);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------
-- PostgREST calls fn_create_active_person and fn_log_bulk_event over RPC, and
-- the views call the rest. EXECUTE is granted to PUBLIC by default; revoking it
-- from anon keeps the pattern consistent with the tables above.

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'manifest'
  loop
    execute format('revoke all on function %s from anon;', f.sig);
    execute format('grant execute on function %s to authenticated, service_role;', f.sig);
  end loop;
end;
$$;
