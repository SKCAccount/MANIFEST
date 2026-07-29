-- prelude.sql — the parts of a Supabase database that migrations assume exist.
--
-- Supabase provisions these before any migration runs. PGlite does not, so the
-- test harness creates them to match. This file is test-infrastructure only and
-- is never applied to a real database.

create schema if not exists auth;

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant all on functions to service_role;

-- Supabase's auth.uid() reads the subject claim off the request JWT. The test
-- harness sets request.jwt.claim.sub directly to impersonate the operator.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.role', true), '');
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;
